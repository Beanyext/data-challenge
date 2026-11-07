"""Оценка одного диалога: запрос, проверка ответа, один повтор с перечнем ошибок."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from app.evaluator.prompt import answers_by_criterion, build_system_prompt, build_user_message, output_schema
from app.evaluator.providers import MockProvider
from app.evaluator.validate import to_criteria, validate


def _retry_note(raw: dict, errors: dict[str, list[str]]) -> str:
    listed = "\n".join(f"- {cid}: {'; '.join(msgs)}" for cid, msgs in errors.items())
    return (
        "\n\nТвой предыдущий ответ:\n"
        f"{json.dumps(raw, ensure_ascii=False)}\n\n"
        f"В нём ошибки:\n{listed}\n\n"
        "Исправь эти критерии, сверяясь с транскриптом. Верные критерии оставь без изменений."
    )


def evaluate_dialog(record: dict, checklist: dict, provider, max_attempts: int = 2) -> dict:
    """Результат по контракту из reports/задачи.md, без баллов: их считает модуль подсчёта."""
    if isinstance(provider, MockProvider):
        provider.record, provider.checklist = record, checklist
    system = build_system_prompt(checklist)
    schema = output_schema(checklist)
    user = build_user_message(record)
    calls: list[dict] = []
    raw: dict = {}
    errors: dict[str, list[str]] = {}
    for attempt in range(max_attempts):
        message = user if attempt == 0 else user + _retry_note(raw, errors)
        raw, usage = provider.complete(system, message, schema)
        raw = answers_by_criterion(raw)
        calls.append(usage)
        errors = validate(raw, record, checklist)
        if not errors:
            break
    costs = [c.get("cost_usd") for c in calls]
    return {
        "conversation_id": record.get("conversation_id"),
        "channel": record.get("channel"),
        "language": record.get("language"),
        "checklist_id": checklist.get("id"),
        "checklist_version": checklist.get("version"),
        "provider": provider.name,
        "model": calls[-1].get("model"),
        "attempts": len(calls),
        "cost_usd": None if any(c is None for c in costs) else round(sum(costs), 6),
        "evaluated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "calls": calls,
        "criteria": to_criteria(raw, record, checklist, errors),
    }
