"""Проверка ответа модели по транскрипту: ссылки на реплики и цитаты должны существовать."""

from __future__ import annotations

import re

from app.evaluator.dialog import clean_text
from app.evaluator.prompt import answer_options

_ELLIPSIS = re.compile(r"\.\.\.|…")
_EDGES = " \"'«»“”„.,;:!?"


def _norm(text: object) -> str:
    return " ".join(clean_text(text).lower().replace("ё", "е").split()).strip(_EDGES)


def quote_found(quote: str, turn_text: str) -> bool:
    """Цитата есть в реплике без учёта регистра и пробелов. Пропуск через многоточие допустим."""
    target = _norm(turn_text)
    parts = [_norm(p) for p in _ELLIPSIS.split(quote)]
    parts = [p for p in parts if p]
    return bool(parts) and all(p in target for p in parts)


def validate(raw: dict, record: dict, checklist: dict) -> dict[str, list[str]]:
    """Ошибки по каждому критерию. Пустой словарь значит, что ответ годится."""
    transcript = record["transcript"]
    n = len(transcript)
    errors: dict[str, list[str]] = {}
    for c in checklist["criteria"]:
        problems: list[str] = []
        item = raw.get(c["id"]) if isinstance(raw, dict) else None
        if not isinstance(item, dict):
            errors[c["id"]] = ["нет ответа по критерию"]
            continue
        answer = str(item.get("answer"))
        if answer not in answer_options(c):
            problems.append(f"недопустимый ответ {answer!r}, можно: {', '.join(answer_options(c))}")
        evidence = item.get("evidence") or []
        for ev in evidence:
            turn = ev.get("turn") if isinstance(ev, dict) else None
            if not isinstance(turn, int) or not 0 <= turn < n:
                problems.append(f"реплики [{turn}] нет, номера от 0 до {n - 1}")
            elif not quote_found(str(ev.get("quote") or ""), transcript[turn].get("text")):
                problems.append(f"цитаты нет в реплике [{turn}]: нужен точный фрагмент её текста")
        rng = item.get("checked_range") or []
        if rng and not (len(rng) == 2 and all(isinstance(x, int) for x in rng) and 0 <= rng[0] <= rng[1] < n):
            problems.append(f"checked_range {rng} должен быть [первая, последняя] в пределах 0..{n - 1}")
        if answer == "na":
            if not str(item.get("na_reason") or "").strip():
                problems.append("при na нужна причина в na_reason")
        elif not evidence and not rng:
            problems.append("нужна цитата или проверенный участок checked_range")
        if not str(item.get("explanation") or "").strip():
            problems.append("нет объяснения")
        if problems:
            errors[c["id"]] = problems
    return errors


def to_criteria(raw: dict, record: dict, checklist: dict, errors: dict[str, list[str]]) -> list[dict]:
    """Ответ модели в формате контракта. Неверные ссылки отбрасываются, критерий помечается для проверки."""
    transcript = record["transcript"]
    n = len(transcript)
    out = []
    for c in checklist["criteria"]:
        item = raw.get(c["id"]) if isinstance(raw, dict) else None
        item = item if isinstance(item, dict) else {}
        answer = str(item.get("answer", ""))
        if answer not in ("yes", "no", "na"):
            try:
                number = float(answer)
                answer = int(number) if number.is_integer() else number
            except ValueError:
                answer = None
        evidence = []
        for ev in item.get("evidence") or []:
            turn = ev.get("turn") if isinstance(ev, dict) else None
            if isinstance(turn, int) and 0 <= turn < n and quote_found(str(ev.get("quote") or ""), transcript[turn].get("text")):
                evidence.append({"turn": turn, "quote": ev["quote"], "timestamp": transcript[turn].get("timestamp")})
        rng = item.get("checked_range") or []
        valid_rng = len(rng) == 2 and all(isinstance(x, int) for x in rng) and 0 <= rng[0] <= rng[1] < n
        out.append(
            {
                "criterion_id": c["id"],
                "answer": answer,
                "explanation": str(item.get("explanation") or ""),
                "evidence": evidence,
                "checked_range": {"from": rng[0], "to": rng[1]} if valid_rng else None,
                "na_reason": (str(item.get("na_reason") or "") or None) if answer == "na" else None,
                "needs_review": c["id"] in errors,
                "problems": errors.get(c["id"], []),
            }
        )
    return out
