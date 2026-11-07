"""Замер точности: ответы модели против эталонной разметки reports/gold.json.

Главная цифра — доля совпавших ответов по критериям: так сравнивают организаторы.
Ещё ошибка итогового балла, разрезы по критериям, языкам и каналам, отдельно настроечная
и отложенная части. Расхождения по отложенной части не печатаются без --show-holdout:
на ней запрос не настраиваем.

    python -m app.accuracy --evals outputs/eval/<папка> [--split tune|holdout|all] [--log имя-эксперимента]
"""

from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from app.evaluator.dialog import load_records
from app.results.export import load_evaluations
from app.scoring import ScoringError, normalize_answer, score


def _same(c: dict, a, b) -> bool:
    try:
        return normalize_answer(c, a) == normalize_answer(c, b)
    except ScoringError:
        return False


def compare(gold: dict, evaluations: dict, records: dict, checklist: dict, split: str) -> dict:
    parts = ["tune", "holdout"] if split == "all" else [split]
    rows = []  # по паре (диалог, критерий)
    dialogs = []
    for part in parts:
        for cid in gold["split"][part]:
            label = gold["labels"].get(cid)
            if not label or len(label.get("answers", {})) < len(checklist["criteria"]):
                continue
            ev = evaluations.get(cid)
            model = {} if not ev or ev.get("error") else {c["criterion_id"]: c["answer"] for c in ev["criteria"]}
            rec = records[cid]
            g_total = score(checklist, label["answers"])["total"]
            m_score = score(checklist, model) if model else None
            dialogs.append({"id": cid, "part": part, "gold_total": g_total,
                            "model_total": m_score["total"] if m_score and m_score["complete"] else None})
            for c in checklist["criteria"]:
                rows.append({
                    "id": cid, "part": part, "criterion": c["id"], "language": rec.get("language"), "channel": rec.get("channel"),
                    "gold": label["answers"][c["id"]], "model": model.get(c["id"]),
                    "ok": c["id"] in model and _same(c, label["answers"][c["id"]], model[c["id"]]),
                    "unsure": c["id"] in (label.get("unsure") or []),
                })
    return {"rows": rows, "dialogs": dialogs}


def _rate(rows: list[dict]) -> tuple[float | None, int]:
    return (sum(r["ok"] for r in rows) / len(rows) if rows else None), len(rows)


def report(res: dict, checklist: dict, show_holdout: bool) -> dict:
    rows, dialogs = res["rows"], res["dialogs"]
    out: dict = {}
    for part in ("tune", "holdout"):
        pr = [r for r in rows if r["part"] == part]
        if not pr:
            continue
        pd = [d for d in dialogs if d["part"] == part]
        errs = [abs(d["gold_total"] - d["model_total"]) for d in pd if d["model_total"] is not None and d["gold_total"] is not None]
        rate, n = _rate(pr)
        sure_rate, sure_n = _rate([r for r in pr if not r["unsure"]])
        out[part] = {
            "dialogs": len(pd), "pairs": n, "agreement": rate, "agreement_without_unsure": sure_rate, "pairs_without_unsure": sure_n,
            "total_mae": sum(errs) / len(errs) if errs else None, "not_evaluated": sum(d["model_total"] is None for d in pd),
            "by_criterion": {c["id"]: _rate([r for r in pr if r["criterion"] == c["id"]])[0] for c in checklist["criteria"]},
            "by_language": {k: _rate([r for r in pr if r["language"] == k])[0] for k in sorted({r["language"] for r in pr})},
            "by_channel": {k: _rate([r for r in pr if r["channel"] == k])[0] for k in sorted({r["channel"] for r in pr})},
        }
        if part == "tune" or show_holdout:
            out[part]["mismatches"] = [f"{r['id']} {r['criterion']}: разметка {r['gold']}, модель {r['model']}{' (сомневаюсь)' if r['unsure'] else ''}"
                                       for r in pr if not r["ok"]]
    return out


def _pct(x) -> str:
    return "—" if x is None else f"{100 * x:.1f}%"


def print_report(rep: dict) -> None:
    for part, r in rep.items():
        name = "Настроечная" if part == "tune" else "Отложенная"
        print(f"\n{name} часть: {r['dialogs']} диалогов, {r['pairs']} ответов по критериям")
        print(f"  Совпадение по критериям: {_pct(r['agreement'])}  (без пометок «сомневаюсь»: {_pct(r['agreement_without_unsure'])} из {r['pairs_without_unsure']})")
        mae = "—" if r["total_mae"] is None else f"{r['total_mae']:.2f}"
        print(f"  Средняя ошибка итогового балла: {mae}  не оценено: {r['not_evaluated']}")
        print("  По критериям: " + "  ".join(f"{k} {_pct(v)}" for k, v in r["by_criterion"].items()))
        print("  По языкам: " + "  ".join(f"{k} {_pct(v)}" for k, v in r["by_language"].items())
              + " | По каналам: " + "  ".join(f"{k} {_pct(v)}" for k, v in r["by_channel"].items()))
        for m in r.get("mismatches", []):
            print(f"    {m}")


def _git_sha() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return ""


def log_experiment(path: Path, name: str, model: str, rep: dict) -> None:
    """Строка в reports/experiments.csv на каждую часть. Столбцы общие с журналом команды."""
    new = not path.exists()
    with path.open("a", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["when", "git", "name", "model", "metric", "mean", "std", "split", "folds", "rows", "features", "seconds"])
        for part, r in rep.items():
            w.writerow([datetime.now().isoformat(timespec="seconds"), _git_sha(), name, model, "criterion_agreement",
                        f"{r['agreement']:.4f}" if r["agreement"] is not None else "", "", part, "", r["pairs"], "", ""])


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Точность оценки против разметки reports/gold.json")
    p.add_argument("--evals", nargs="+", required=True, help="папки с оценками, более поздняя важнее")
    p.add_argument("--data", default="data/raw/dev.json")
    p.add_argument("--checklist", default="app/checklists/freedom_chat_v1.json")
    p.add_argument("--gold", default="reports/gold.json")
    p.add_argument("--split", choices=["tune", "holdout", "all"], default="tune")
    p.add_argument("--show-holdout", action="store_true", help="печатать расхождения и по отложенной части")
    p.add_argument("--log", metavar="ИМЯ", help="дописать строку в reports/experiments.csv")
    p.add_argument("--json", action="store_true", help="вывести отчёт в JSON")
    args = p.parse_args(argv)

    checklist = json.loads(Path(args.checklist).read_text(encoding="utf-8"))
    gold = json.loads(Path(args.gold).read_text(encoding="utf-8"))
    records = {r["conversation_id"]: r for r in load_records(args.data)}
    evaluations = load_evaluations(args.evals, checklist)
    rep = report(compare(gold, evaluations, records, checklist, args.split), checklist, args.show_holdout)
    if not rep:
        print("Нет размеченных диалогов в выбранной части")
        return 1
    if args.json:
        print(json.dumps(rep, ensure_ascii=False, indent=2))
    else:
        print_report(rep)
    if args.log:
        models = sorted({c.get("model") for ev in evaluations.values() if not ev.get("error") for c in ev.get("calls") or [] if c.get("model")})
        log_experiment(Path("reports/experiments.csv"), args.log, ", ".join(models), rep)
        print(f"\nЗаписано в reports/experiments.csv: {args.log}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
