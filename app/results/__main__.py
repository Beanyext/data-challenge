"""Сборка, проверка и контрольный прогон файлов сдачи. Справка: python -m app.results -h"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

from app.data_api import DataApiError, fetch_group, save_group
from app.evaluator import cli as evaluator_cli
from app.evaluator.dialog import load_records
from app.results.check import check_results, load_results_file
from app.results.export import build_results, load_evaluations, write_json

DEFAULT_CHECKLIST = "app/checklists/freedom_chat_v1.json"


def _checklist(path: str) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _print_check(errors: list[str], path: Path, allow_mock: bool = False) -> int:
    if errors:
        print(f"ПРОВЕРКА НЕ ПРОЙДЕНА: {path}, ошибок {len(errors)}")
        for e in errors[:40]:
            print(f"  - {e}")
        return 1
    if allow_mock:
        print(f"УЧЕБНАЯ ПРОВЕРКА пройдена: {path}. Результаты не предназначены для сдачи.")
    else:
        print(f"Проверка пройдена: {path}")
    return 0


def cmd_build(args) -> int:
    checklist = _checklist(args.checklist)
    records = load_records(args.data)
    evaluations = load_evaluations(args.evals, checklist)
    doc, report = build_results(records, evaluations, checklist, args.team or os.environ.get("CQA_TEAM_NAME", ""),
                                args.mode, allow_mock=args.allow_mock)
    errors = check_results(doc, records, checklist, args.expect, allow_mock=args.allow_mock)
    out = Path(args.out)
    if errors and not args.force:
        _print_check(errors, out)
        print("Файл не записан. Исправьте ошибки или запустите с --force, чтобы посмотреть черновик.")
        return 1
    write_json(doc, out)
    print(json.dumps({k: v for k, v in report.items() if k != "rationale_replaced"}, ensure_ascii=False))
    if report["rationale_replaced"]:
        print(f"Объяснений заменено шаблоном: {len(report['rationale_replaced'])}")
    return _print_check(check_results(load_results_file(out), records, checklist, args.expect, allow_mock=args.allow_mock), out, args.allow_mock)


def cmd_check(args) -> int:
    checklist = _checklist(args.checklist)
    records = load_records(args.data)
    path = Path(args.path)
    try:
        doc = load_results_file(path)
    except (ValueError, UnicodeDecodeError) as e:
        print(f"ПРОВЕРКА НЕ ПРОЙДЕНА: {path}: {e}")
        return 1
    return _print_check(check_results(doc, records, checklist, args.expect, allow_mock=args.allow_mock), path, args.allow_mock)


def cmd_control(args) -> int:
    """Контрольный час: получить набор, оценить, повторить неудачные, собрать и проверить файл."""
    started = datetime.now()
    evaluator_cli.load_env(Path(".env"))
    try:
        doc = fetch_group(args.group_id)
    except DataApiError as e:
        print(f"Набор не получен: {e}")
        return 1
    data_path = save_group(doc, Path("data/raw") / f"{args.group_id}.json")
    records = doc["data"]["records"]
    print(f"Набор {args.group_id}: {len(records)} диалогов, сохранён в {data_path}")
    if args.expect is not None and len(records) != args.expect:
        print(f"Внимание: в наборе {len(records)} диалогов, ожидалось {args.expect}")

    stamp = started.strftime("%Y%m%d-%H%M%S")
    dirs = [Path(f"outputs/eval/{stamp}-{args.group_id}")]
    base = ["--data", str(data_path), "--checklist", args.checklist, "--provider", args.provider, "--workers", str(args.workers)]
    evaluator_cli.main(base + ["--out", str(dirs[0])])
    checklist = _checklist(args.checklist)
    for attempt in range(1, args.retries + 1):
        found = load_evaluations(dirs, checklist)
        failed = [r["conversation_id"] for r in records if r["conversation_id"] not in found or found[r["conversation_id"]].get("error")]
        if not failed:
            break
        print(f"Повтор {attempt} для {len(failed)} диалогов: {', '.join(failed)}")
        dirs.append(Path(f"outputs/eval/{stamp}-{args.group_id}-retry{attempt}"))
        evaluator_cli.main(base + ["--out", str(dirs[-1]), "--ids", *failed])

    build_args = argparse.Namespace(
        checklist=args.checklist, data=str(data_path), evals=[str(d) for d in dirs], out=args.out, team=args.team,
        mode=args.mode, expect=args.expect if args.expect is not None else len(records), force=False, allow_mock=args.provider == "mock",
    )
    code = cmd_build(build_args)
    minutes = (datetime.now() - started).total_seconds() / 60
    print(f"Заняло {minutes:.1f} мин.")
    if code == 0 and args.provider != "mock":
        print(f"Дальше: git add {args.out} && git commit -m \"Результаты {args.group_id}\" && git push")
    return code


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m app.results", description="Файлы сдачи results.json в формате организаторов 1.0")
    sub = p.add_subparsers(dest="cmd", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--checklist", default=DEFAULT_CHECKLIST)

    b = sub.add_parser("build", parents=[common], help="собрать файл из сохранённых оценок и проверить его")
    b.add_argument("--data", required=True, help="набор: ответ API организаторов")
    b.add_argument("--evals", nargs="+", required=True, help="папки с оценками, более поздняя важнее")
    b.add_argument("--out", required=True)
    b.add_argument("--team", help="название команды, иначе CQA_TEAM_NAME из окружения или .env")
    b.add_argument("--mode", default="external_api")
    b.add_argument("--expect", type=int, help="сколько записей должно быть")
    b.add_argument("--force", action="store_true", help="записать даже с ошибками проверки (черновик)")
    b.add_argument("--allow-mock", action="store_true", help="учебная сборка; результат не предназначен для сдачи")
    b.set_defaults(func=cmd_build)

    c = sub.add_parser("check", parents=[common], help="проверить готовый файл")
    c.add_argument("path")
    c.add_argument("--data", required=True)
    c.add_argument("--expect", type=int)
    c.add_argument("--allow-mock", action="store_true", help="учебная проверка; результат не предназначен для сдачи")
    c.set_defaults(func=cmd_check)

    k = sub.add_parser("control", parents=[common], help="контрольный час: получить набор по group_id, оценить, собрать, проверить")
    k.add_argument("--group-id", required=True)
    k.add_argument("--out", default="results/prod/results.json")
    k.add_argument("--team")
    k.add_argument("--mode", default="external_api")
    k.add_argument("--expect", type=int, default=10)
    k.add_argument("--workers", type=int, default=5)
    k.add_argument("--retries", type=int, default=2, help="сколько раз переоценить диалоги с ошибкой")
    k.add_argument("--provider", choices=["anthropic", "mock"], default="anthropic")
    k.set_defaults(func=cmd_control)

    args = p.parse_args(argv)
    evaluator_cli.load_env(Path(".env"))
    if getattr(args, "team", None) is None:
        args.team = os.environ.get("CQA_TEAM_NAME", "")
    try:
        return args.func(args)
    except ValueError as e:
        print(f"Ошибка: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
