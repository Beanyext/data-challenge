"""Ответы API в форме, которую ждёт интерфейс (reports/задачи.md и web/README.md).

Итог, секции и грубая ошибка считаются только модулем app.scoring. Решения проверяющего
накладываются поверх исходных ответов модели, исходные ответы и исходный итог остаются видны."""

from __future__ import annotations

from app.scoring import NA, ScoringError, apply_decisions, normalize_answer, score
from app.server.store import Store

FRAGMENT_PAD = 2


def criterion_by_id(checklist: dict) -> dict:
    return {c["id"]: c for c in checklist["criteria"]}


def evaluation_view(store: Store, ev: dict, with_appeals: bool = True) -> dict:
    checklist = store.get_checklist(ev["checklist_id"], ev["checklist_version"]) or {"criteria": [], "sections": []}
    base = {
        "id": ev["id"], "conversation_id": ev["conversation_id"], "checklist_id": ev["checklist_id"],
        "checklist_version": ev["checklist_version"], "checklist": checklist, "job_id": ev["job_id"],
        "status": ev["status"], "created_at": ev["created_at"], "finished_at": ev["finished_at"],
    }
    result = ev["result"] or {}
    empty = {"total": None, "gross_error": False, "original_total": None, "original_gross_error": False,
             "criteria": [], "sections": [], "needs_review_count": 0, "complete": False}
    if ev["status"] == "pending":
        return {**base, **empty}
    if ev["status"] == "error" or "criteria" not in result:
        return {**base, **empty, "status": "error", "error": result.get("error") or "оценка не выполнена"}

    items = {c["criterion_id"]: c for c in result["criteria"]}
    original = {cid: it["answer"] for cid, it in items.items() if it.get("answer") is not None}
    decisions = store.decisions_for(ev["id"])
    final = apply_decisions(original, decisions)
    s_orig = score(checklist, original)
    s_final = score(checklist, final)
    by_score = {x["criterion_id"]: x for x in s_final["criteria"]}
    last_decision = {}
    for d in decisions:
        last_decision[d["criterion_id"]] = d

    criteria = []
    for c in checklist["criteria"]:
        it = items.get(c["id"], {})
        sc = by_score[c["id"]]
        dec = last_decision.get(c["id"])
        criteria.append({
            "criterion_id": c["id"], "code": c.get("code") or c["id"], "title": c.get("title"),
            "section_id": c.get("section_id"),
            "answer": sc["answer"], "original_answer": original.get(c["id"]),
            "points": sc["score"], "raw_points": sc["points"], "weight": sc["weight"],
            "effective_weight": sc["effective_weight"], "applicable": sc["applicable"], "gross_error": sc["gross_error"],
            "explanation": it.get("explanation", ""), "evidence": it.get("evidence") or [],
            "checked_range": it.get("checked_range"), "na_reason": it.get("na_reason"),
            "needs_review": bool(it.get("needs_review")) and dec is None, "problems": it.get("problems") or [],
            "decision": None if dec is None else {k: dec[k] for k in ("appeal_id", "status", "answer", "reason", "decided_at")},
            "review_reason": None if dec is None else dec["reason"],
        })
    sections = [{**s, "effective_weight": s["max"]} for s in s_final["sections"]]
    calls = [
        {k: c.get(k) for k in ("model", "input_tokens", "output_tokens", "cache_creation_input_tokens",
                               "cache_read_input_tokens", "seconds", "cost_usd", "stop_reason")}
        for c in result.get("calls") or []
    ]
    view = {
        **base, "status": "done", "model": result.get("model"), "provider": result.get("provider"),
        "attempts": result.get("attempts"), "cost_usd": result.get("cost_usd"), "evaluated_at": result.get("evaluated_at"),
        "total": s_final["total"], "gross_error": s_final["gross_error"],
        "original_total": s_orig["total"], "original_gross_error": s_orig["gross_error"],
        "complete": s_final["complete"], "missing": s_final["missing"],
        "points": s_final["points"], "weight_sum": s_final["weight_sum"],
        "sections": sections, "criteria": criteria,
        "needs_review_count": sum(1 for c in criteria if c["needs_review"]), "calls": calls,
    }
    if with_appeals:
        view["appeals"] = store.list_appeals(evaluation_id=ev["id"])
    return view


def dialog_row(store: Store, entry: dict, latest: dict | None) -> dict:
    record = entry["record"]
    transcript = record.get("transcript") or []
    first_client = next((str(t.get("text") or "") for t in transcript if t.get("speaker") == "client"), "")
    row = {
        "conversation_id": record["conversation_id"], "channel": record.get("channel"), "language": record.get("language"),
        "group_id": entry.get("group_id"), "turns": len(transcript), "title": first_client[:90],
        "has_audio": bool(record.get("audio_url")), "evaluation_id": None, "status": "new",
        "total": None, "original_total": None, "gross_error": False, "needs_review": False,
        "checklist_id": None, "checklist_version": None, "model": None, "open_appeals": 0,
    }
    if latest is None:
        return row
    view = evaluation_view(store, latest, with_appeals=False)
    row.update({
        "evaluation_id": latest["id"],
        "status": {"pending": "pending", "error": "error"}.get(view["status"], "evaluated"),
        "total": view["total"], "original_total": view["original_total"], "gross_error": view["gross_error"],
        "needs_review": view["needs_review_count"] > 0, "checklist_id": view["checklist_id"],
        "checklist_version": view["checklist_version"], "model": view.get("model"),
        "open_appeals": len(store.list_appeals(status="open", evaluation_id=latest["id"])),
    })
    if view["status"] == "error":
        row["error"] = view.get("error")
    return row


def public_dialog(entry: dict) -> dict:
    """Диалог для интерфейса. Подписанный адрес страницы записи наружу не отдаётся."""
    record = {k: v for k, v in entry["record"].items() if k != "audio_url"}
    record["has_audio"] = bool(entry["record"].get("audio_url"))
    record["group_id"] = entry.get("group_id")
    return record


def appeal_view(store: Store, appeal: dict) -> dict:
    """Апелляция для проверяющего: спорная оценка, комментарий и фрагмент диалога."""
    ev = store.get_evaluation(appeal["evaluation_id"])
    out = dict(appeal)
    if ev is None:
        return out
    view = evaluation_view(store, ev, with_appeals=False)
    item = next((c for c in view["criteria"] if c["criterion_id"] == appeal["criterion_id"]), None)
    out["conversation_id"] = ev["conversation_id"]
    out["criterion_title"] = item["title"] if item else None
    out["criterion"] = item
    out["total"] = view["total"]
    out["original_total"] = view["original_total"]
    entry = store.get_dialog(ev["conversation_id"])
    transcript = (entry or {}).get("record", {}).get("transcript") or []
    turns = sorted({e["turn"] for e in (item or {}).get("evidence", []) if isinstance(e.get("turn"), int)})
    rng = (item or {}).get("checked_range")
    if rng:
        turns += [rng["from"], rng["to"]]
    if transcript and turns:
        lo, hi = max(0, min(turns) - FRAGMENT_PAD), min(len(transcript) - 1, max(turns) + FRAGMENT_PAD)
    else:
        lo, hi = 0, min(len(transcript) - 1, 2 * FRAGMENT_PAD)
    out["fragment"] = [
        {"turn": i, "speaker": transcript[i].get("speaker"), "timestamp": transcript[i].get("timestamp"),
         "text": transcript[i].get("text")}
        for i in range(lo, hi + 1)
    ] if transcript else []
    return out


def allowed_answer(criterion: dict, answer):
    """Ответ проверяющего в виде контракта. Неверный — ScoringError."""
    return normalize_answer(criterion, answer)


__all__ = ["NA", "ScoringError", "allowed_answer", "appeal_view", "criterion_by_id", "dialog_row", "evaluation_view", "public_dialog"]
