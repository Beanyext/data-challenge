"""Переоценка после смены версии чек-листа: модель проверяет только новые и изменённые критерии.

Ответ модели по критерию зависит от его текста, типа ответа, шкалы и условий N/A, но не от веса
и не от раздела. Если у критерия эти поля не изменились с версии, по которой диалог уже оценён,
ответ, объяснение и ссылки на реплики берутся из прошлой оценки. Если изменился только вес или
критерий удалён, модель не вызывается совсем: баллы пересчитывает модуль подсчёта.
"""

from __future__ import annotations

from datetime import datetime, timezone

from app.evaluator.evaluate import evaluate_dialog

# Поля, от которых зависит ответ модели. Вес и раздел влияют только на подсчёт баллов.
MEANING = ("title", "description", "answer_type", "scale", "na_allowed", "na_rule", "notes", "gross_error")


def _norm(value):
    if isinstance(value, str):
        return value.strip() or None
    return value


def same_meaning(a: dict, b: dict) -> bool:
    return all(_norm(a.get(k)) == _norm(b.get(k)) for k in MEANING)


def plan(checklist: dict, prev_checklist: dict, prev_result: dict) -> tuple[dict[str, dict], list[dict]]:
    """Какие ответы взять из прошлой оценки, а какие критерии отдать модели."""
    old = {c["id"]: c for c in prev_checklist.get("criteria", [])}
    items = {i.get("criterion_id"): i for i in (prev_result or {}).get("criteria", []) if isinstance(i, dict)}
    reuse: dict[str, dict] = {}
    fresh: list[dict] = []
    for c in checklist["criteria"]:
        o, item = old.get(c["id"]), items.get(c["id"])
        if o and item and same_meaning(c, o) and item.get("answer") is not None and not item.get("needs_review"):
            reuse[c["id"]] = item
        else:
            fresh.append(c)
    return reuse, fresh


def evaluate_with_reuse(record: dict, checklist: dict, provider, prev_result: dict, prev_checklist: dict, prev_id: str) -> dict:
    reuse, fresh = plan(checklist, prev_checklist, prev_result)
    if fresh:
        part = evaluate_dialog(record, {**checklist, "criteria": fresh}, provider)
        new = {i["criterion_id"]: i for i in part["criteria"]}
        calls, attempts, model, cost = part["calls"], part["attempts"], part["model"], part["cost_usd"]
    else:
        new, calls, attempts, model, cost = {}, [], 0, prev_result.get("model"), 0.0
    criteria = [{**reuse[c["id"]], "reused_from": prev_id} if c["id"] in reuse else new[c["id"]] for c in checklist["criteria"]]
    return {
        "conversation_id": record.get("conversation_id"),
        "channel": record.get("channel"),
        "language": record.get("language"),
        "checklist_id": checklist.get("id"),
        "checklist_version": checklist.get("version"),
        "provider": provider.name,
        "model": model,
        "attempts": attempts,
        "cost_usd": cost,
        "evaluated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "calls": calls,
        "criteria": criteria,
        "reused_from": prev_id,
        "reused_from_version": prev_checklist.get("version"),
        "reused_criteria": [c["id"] for c in checklist["criteria"] if c["id"] in reuse],
        "evaluated_criteria": [c["id"] for c in fresh],
    }
