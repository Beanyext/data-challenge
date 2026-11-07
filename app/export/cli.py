"""Выгрузка файла сдачи results/<набор>/results.json и его проверка.

Примеры (из корня репозитория):
    python -m app.export --set dev --data data/raw/dev.json --evals outputs/eval/<папка> [ещё папки]
    python -m app.export --set prod --data data/raw/prod.json --evals outputs/eval/<папка>
    python -m app.export --check results/dev/results.json --set dev --data data/raw/dev.json

Если диалог есть в нескольких папках оценок, берётся из последней. Файл пишется, только если
проходит проверку формата. Неоценённый диалог попадает в файл со status error, а не с нулём."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from app.evaluator.dialog import load_records
from app.export.results import (
    MODES,
    TEAM_NAME,
    ExportError,
    build_results,
    load_evaluations,
    validate_results,
    write_results,
)

PROD_COUNT = 10


def _print_problems(problems: list[str]) -> None:
    print(f"Файл не годится, нарушений: {len(problems)}", file=sys.stderr)
    for p in problems[:50]:
        print(f"- {p}", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Файл сдачи результатов в формате организаторов (JSON 1.0)")
    parser.add_argument("--set", choices=["dev", "prod"], required=True, help="набор: dev или prod")
    parser.add_argument("--data", required=True, help="диалоги набора: ответ API организаторов")
    parser.add_argument("--evals", nargs="+", help="папки прогонов оценки outputs/eval/<папка>")
    parser.add_argument("--check", metavar="FILE", help="только проверить готовый файл")
    parser.add_argument("--checklist", default="app/checklists/freedom_chat_v1.json")
    parser.add_argument("--team", default=TEAM_NAME, help=f"название команды, по умолчанию {TEAM_NAME}")
    parser.add_argument("--mode", choices=MODES, default="external_api")
    parser.add_argument("--out", help="куда писать, по умолчанию results/<набор>/results.json")
    parser.add_argument("--count", type=int, help=f"сколько записей должно быть, для prod по умолчанию {PROD_COUNT}")
    args = parser.parse_args(argv)

    records = load_records(args.data)
    checklist = json.loads(Path(args.checklist).read_text(encoding="utf-8"))
    exact = args.count if args.count is not None else (PROD_COUNT if args.set == "prod" else None)

    try:
        if args.check:
            doc = json.loads(Path(args.check).read_text(encoding="utf-8"))
            problems = validate_results(doc, checklist, records, exact)
            if problems:
                _print_problems(problems)
                return 2
            errors = [r for r in doc["results"] if r.get("status") == "error"]
            print(f"Файл годится: {args.check}. Записей {len(doc['results'])}, с ошибкой {len(errors)}.")
            return 0

        if not args.evals:
            parser.error("нужны папки с оценками --evals или проверка готового файла --check")
        evaluations = load_evaluations(args.evals)
        default_model = os.environ.get("CQA_MODEL", "claude-opus-5-5")
        doc, report = build_results(records, evaluations, checklist, args.team, args.mode, default_model)
        problems = validate_results(doc, checklist, records, exact)
    except ExportError as e:
        print(f"Ошибка: {e}", file=sys.stderr)
        return 2
    if problems:
        _print_problems(problems)
        print("Файл не записан.", file=sys.stderr)
        return 2

    out = Path(args.out or f"results/{args.set}/results.json")
    write_results(out, doc)
    print(f"Записано: {out}")
    print(
        f"Диалогов {report['dialogs']}, ok {report['ok']}, с ошибкой {len(report['errors'])}, "
        f"убрано цитат из объяснений звонков {report['quotes_removed']}. Модель: {doc['model']['name']}."
    )
    for cid, reason in report["errors"].items():
        print(f"- {cid}: {reason}")
    if report["errors"]:
        print("Диалоги с ошибкой стоит переоценить и выгрузить заново, если есть время.")
    if report["unused_evaluations"]:
        print(f"Оценки не из этого набора пропущены: {', '.join(report['unused_evaluations'][:10])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
