"""Оценка диалогов из файла.

Примеры (из корня репозитория):
    python -m app.evaluator.cli --data data/raw/dev.json --ids p1-ru-001 --provider mock
    python -m app.evaluator.cli --data data/raw/dev.json --limit 5 --provider anthropic

Настройки через переменные окружения или файл .env в корне (он не попадает в git):
    ANTHROPIC_API_KEY  ключ Claude API
    CQA_MODEL          модель, по умолчанию claude-opus-5-5
    CQA_EFFORT         глубина рассуждений: low, medium, high, xhigh, max; по умолчанию high
    CQA_FALLBACKS      0 отключает повтор на другой модели при отказе
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

from app.evaluator.dialog import load_records
from app.evaluator.evaluate import evaluate_dialog
from app.evaluator.providers import AnthropicProvider, MockProvider


def load_env(path: Path) -> None:
    """Простое чтение .env: строки КЛЮЧ=значение. Уже заданные переменные не перезаписываются."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Оценка диалогов по чек-листу")
    parser.add_argument("--data", required=True, help="файл с диалогами: ответ API организаторов или список записей")
    parser.add_argument("--checklist", default="app/checklists/freedom_chat_v1.json")
    parser.add_argument("--ids", nargs="*", help="какие диалоги оценить, по умолчанию все")
    parser.add_argument("--limit", type=int, help="оценить только первые N")
    parser.add_argument("--provider", choices=["anthropic", "mock"], default="anthropic")
    parser.add_argument("--workers", type=int, default=4, help="сколько диалогов оценивать одновременно")
    parser.add_argument("--out", help="папка для результатов, по умолчанию outputs/eval/<время>")
    args = parser.parse_args(argv)

    load_env(Path(".env"))
    records = load_records(args.data)
    if args.ids:
        wanted = set(args.ids)
        records = [r for r in records if r.get("conversation_id") in wanted]
        missing = wanted - {r.get("conversation_id") for r in records}
        if missing:
            print(f"Нет таких диалогов: {', '.join(sorted(missing))}", file=sys.stderr)
            return 2
    if args.limit:
        records = records[: args.limit]
    checklist = json.loads(Path(args.checklist).read_text(encoding="utf-8"))
    out = Path(args.out or f"outputs/eval/{datetime.now():%Y%m%d-%H%M%S}-{args.provider}")
    out.mkdir(parents=True, exist_ok=True)

    def run(record: dict) -> dict:
        provider = MockProvider() if args.provider == "mock" else AnthropicProvider()
        try:
            result = evaluate_dialog(record, checklist, provider)
        except Exception as exc:  # одна ошибка не должна останавливать весь набор
            result = {"conversation_id": record.get("conversation_id"), "error": f"{type(exc).__name__}: {exc}"}
        (out / f"{record.get('conversation_id')}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        status = result.get("error") or f"попыток {result['attempts']}, на проверку {sum(c['needs_review'] for c in result['criteria'])}"
        print(f"{record.get('conversation_id')}: {status}", flush=True)
        return result

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        results = list(pool.map(run, records))

    ok = [r for r in results if "error" not in r]
    costs = [r["cost_usd"] for r in ok if r.get("cost_usd") is not None]
    summary = {
        "dialogs": len(results),
        "failed": len(results) - len(ok),
        "criteria_needing_review": sum(c["needs_review"] for r in ok for c in r["criteria"]),
        "retries": sum(r["attempts"] - 1 for r in ok),
        "models": sorted({r["model"] for r in ok}),
        "cost_usd_total": round(sum(costs), 4) if costs else None,
        "cost_usd_per_dialog": round(sum(costs) / len(costs), 4) if costs else None,
    }
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))
    print(f"Результаты: {out}")
    return 0 if not summary["failed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
