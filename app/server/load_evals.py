"""Загрузка сохранённых оценок в базу сервера без вызова модели.

Нужна, чтобы подготовить ноутбук к показу бесплатно: оценки DEV, уже сделанные командой
`python -m app.evaluator.cli`, попадают в интерфейс как есть: те же ответы, объяснения и стоимость.
Новые диалоги на показе всё равно оцениваются вживую.

    python -m app.server.load_evals --evals outputs/eval/<папка> [--data data/raw/dev.json] [--db outputs/server/cqa.sqlite3]

Сервер можно не останавливать: база общая, интерфейс увидит оценки после обновления страницы.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from app.evaluator.dialog import load_records
from app.server.main import DEFAULT_CHECKLIST, ROOT
from app.server.store import Store, new_id


def load(store: Store, evals_dir: str | Path, records: list[dict] | None = None, group_id: str = "DEV",
         replace: bool = False) -> dict:
    """Возвращает счётчики: загружено, пропущено (уже есть оценка), без диалога, с ошибкой, чужая версия чек-листа."""
    store.seed_checklist(json.loads(DEFAULT_CHECKLIST.read_text(encoding="utf-8")))
    for r in records or []:
        store.upsert_dialog(r, group_id)
    stats = {"loaded": 0, "skipped_existing": 0, "no_dialog": 0, "errors": 0, "unknown_checklist": 0}
    by_checklist: dict[tuple[str, int], list[tuple[str, dict]]] = {}
    for f in sorted(Path(evals_dir).glob("*.json")):
        if f.name == "summary.json":
            continue
        res = json.loads(f.read_text(encoding="utf-8"))
        cid = res.get("conversation_id")
        if res.get("error") or "criteria" not in res:
            stats["errors"] += 1
        elif not cid or store.get_dialog(cid) is None:
            stats["no_dialog"] += 1
        elif not replace and store.latest_evaluation(cid) is not None:
            stats["skipped_existing"] += 1
        else:
            key = (res.get("checklist_id") or "freedom-chat", int(res.get("checklist_version") or 1))
            by_checklist.setdefault(key, []).append((cid, res))
    for (cl_id, version), items in by_checklist.items():
        checklist = store.get_checklist(cl_id, version)
        if checklist is None:
            stats["unknown_checklist"] += len(items)
            continue
        job_id = new_id("job")
        pairs = [(new_id("ev"), cid, res) for cid, res in items]
        store.create_job(job_id, checklist, [(ev_id, cid) for ev_id, cid, _ in pairs])
        store.job_running(job_id)
        for ev_id, _, res in pairs:
            store.finish_evaluation(ev_id, job_id, res)
        stats["loaded"] += len(pairs)
    return stats


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Загрузить сохранённые оценки в базу сервера без вызова модели")
    p.add_argument("--evals", required=True, help="папка с оценками outputs/eval/<папка>")
    p.add_argument("--data", help="набор диалогов (ответ API организаторов), если диалоги ещё не импортированы")
    p.add_argument("--group", default="DEV", help="group_id для диалогов из --data")
    p.add_argument("--db", default=str(ROOT / "outputs" / "server" / "cqa.sqlite3"))
    p.add_argument("--replace", action="store_true", help="добавить оценку, даже если у диалога уже есть оценка")
    args = p.parse_args(argv)
    if not Path(args.evals).is_dir():
        print(f"Нет папки {args.evals}", file=sys.stderr)
        return 1
    stats = load(Store(args.db), args.evals, load_records(args.data) if args.data else None, args.group, args.replace)
    print(json.dumps(stats, ensure_ascii=False))
    return 0 if stats["loaded"] or stats["skipped_existing"] else 1


if __name__ == "__main__":
    sys.exit(main())
