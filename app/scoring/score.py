"""Подсчёт итога по правилам чек-листа: вес, шкала, N/A, секции, грубая ошибка, округление.

Чистые функции: без модели, базы и сети. Внутри всё считается точно, дробями (Fraction),
а округляется только результат, половина вверх. Обычный round() в Python округляет половину
к чётному и на 75.625 даёт 75.62 вместо 75.63.

Порядок расчёта (reports/чек-лист.md):
1. Баллы критерия до перераспределения: «да» = вес, «нет» = 0, шкала = ступень / верхняя ступень × вес.
2. Критерии с N/A и грубые ошибки в итог не входят. Сумма весов считается по оставшимся.
3. Итог = сумма баллов / сумма весов × 100. Нет применимых критериев с весом: итога нет (None).
4. Действующий вес критерия = вес × 100 / сумма весов.
5. Грубая ошибка отмечается отдельно и итог не меняет.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction

YES, NO, NA = "yes", "no", "na"


class ScoringError(ValueError):
    """Ответ не подходит критерию или в чек-листе ошибка."""


def _frac(value) -> Fraction:
    if isinstance(value, bool):
        raise ScoringError("логическое значение вместо числа")
    if isinstance(value, Fraction):
        return value
    return Fraction(str(value))


def _is_scale(criterion: dict) -> bool:
    return criterion.get("answer_type") == "scale" and not criterion.get("gross_error")


def _weight(criterion: dict) -> Fraction:
    weight = _frac(criterion.get("weight") or 0)
    if weight < 0:
        raise ScoringError(f"{criterion.get('id')}: вес не может быть отрицательным")
    return weight


def scale_values(criterion: dict) -> list[Fraction]:
    """Допустимые ступени шкалы, от большей к меньшей. Без списка ступеней — все целые от min до max."""
    scale = criterion.get("scale") or {}
    steps = scale.get("steps")
    if steps:
        values = {_frac(s["value"]) for s in steps}
    else:
        values = {Fraction(v) for v in range(int(scale["min"]), int(scale["max"]) + 1)}
    if not values:
        raise ScoringError(f"{criterion.get('id')}: у шкалы нет ступеней")
    return sorted(values, reverse=True)


def normalize_answer(criterion: dict, answer):
    """Приводит ответ к виду контракта: yes, no, na или число ступени. Неверный ответ — ScoringError."""
    cid = criterion.get("id")
    if isinstance(answer, str):
        answer = answer.strip().lower()
        if answer == NA:
            if criterion.get("na_allowed") and not criterion.get("gross_error"):
                return NA
            raise ScoringError(f"{cid}: N/A для этого критерия не разрешён")
    if _is_scale(criterion):
        try:
            value = _frac(answer)
        except (ValueError, TypeError, ZeroDivisionError):
            raise ScoringError(f"{cid}: ожидается ступень шкалы, получено {answer!r}") from None
        if value not in scale_values(criterion):
            raise ScoringError(f"{cid}: {answer!r} нет среди ступеней шкалы")
        return int(value) if value.denominator == 1 else float(value)
    if answer in (YES, NO):
        return answer
    raise ScoringError(f"{cid}: ожидается yes или no, получено {answer!r}")


def criterion_points(criterion: dict, answer) -> Fraction | None:
    """Баллы до перераспределения. None — критерий в итог не входит: N/A или грубая ошибка."""
    if criterion.get("gross_error") or answer == NA:
        return None
    weight = _weight(criterion)
    if _is_scale(criterion):
        top = scale_values(criterion)[0]
        if top <= 0:
            raise ScoringError(f"{criterion.get('id')}: верхняя ступень шкалы должна быть больше нуля")
        return _frac(answer) / top * weight
    return weight if answer == YES else Fraction(0)


def compute(checklist: dict, answers: dict) -> dict:
    """Точный расчёт в дробях. answers: {id критерия: ответ}.

    Нет ответа или ответ неверный: критерий попадает в missing и в итог не входит,
    а результат помечается как неполный. Так ошибка одного ответа не роняет весь расчёт."""
    rows, missing, problems = [], [], {}
    for c in checklist["criteria"]:
        cid = c["id"]
        raw = answers.get(cid)
        answer = None
        if raw is None:
            missing.append(cid)
        else:
            try:
                answer = normalize_answer(c, raw)
            except ScoringError as e:
                missing.append(cid)
                problems[cid] = str(e)
        pts = None if answer is None else criterion_points(c, answer)
        rows.append({"criterion": c, "answer": answer, "points": pts})

    applicable = [r for r in rows if r["points"] is not None]
    weight_sum = sum((_weight(r["criterion"]) for r in applicable), Fraction(0))
    for r in rows:
        if r["points"] is None or weight_sum == 0:
            r["effective_weight"] = r["score"] = None
        else:
            r["effective_weight"] = _weight(r["criterion"]) * 100 / weight_sum
            r["score"] = r["points"] * 100 / weight_sum

    points_sum = sum((r["points"] for r in applicable), Fraction(0))
    total = points_sum * 100 / weight_sum if weight_sum > 0 else None
    gross_rows = [r for r in rows if r["criterion"].get("gross_error")]

    sections = []
    for s in checklist.get("sections") or []:
        members = [r for r in rows if r["criterion"].get("section_id") == s["id"]]
        scored = [r for r in members if r["score"] is not None]
        gross = [r for r in members if r["criterion"].get("gross_error")]
        sections.append(
            {
                "id": s["id"],
                "name": s.get("name"),
                "score": sum((r["score"] for r in scored), Fraction(0)) if scored else None,
                "max": sum((r["effective_weight"] for r in scored), Fraction(0)) if scored else None,
                "gross_error": any(r["answer"] == YES for r in gross) if gross else None,
            }
        )

    return {
        "total": total,
        "points": points_sum,
        "weight_sum": weight_sum,
        "gross_error": any(r["answer"] == YES for r in gross_rows),
        "missing": missing,
        "problems": problems,
        "rows": rows,
        "sections": sections,
    }


def round_half_up(value: Fraction, digits: int = 2) -> float:
    exact = Decimal(value.numerator) / Decimal(value.denominator)
    return float(exact.quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP))


def score(checklist: dict, answers: dict) -> dict:
    """Итог в виде для сервера и интерфейса: числа округлены по настройке чек-листа.

    points у критерия — баллы до перераспределения, score — после, effective_weight — действующий вес."""
    exact = compute(checklist, answers)
    digits = int((checklist.get("rounding") or {}).get("digits", 2))

    def rnd(v):
        return None if v is None else round_half_up(v, digits)

    return {
        "total": rnd(exact["total"]),
        "gross_error": exact["gross_error"],
        "complete": not exact["missing"],
        "missing": exact["missing"],
        "problems": exact["problems"],
        "points": rnd(exact["points"]),
        "weight_sum": rnd(exact["weight_sum"]),
        "sections": [
            {**s, "score": rnd(s["score"]), "max": rnd(s["max"])} for s in exact["sections"]
        ],
        "criteria": [
            {
                "criterion_id": r["criterion"]["id"],
                "answer": r["answer"],
                "applicable": r["points"] is not None,
                "gross_error": bool(r["criterion"].get("gross_error")),
                "weight": rnd(_weight(r["criterion"])),
                "points": rnd(r["points"]),
                "effective_weight": rnd(r["effective_weight"]),
                "score": rnd(r["score"]),
            }
            for r in exact["rows"]
        ],
    }


def apply_decisions(answers: dict, decisions: list[dict]) -> dict:
    """Финальные ответы: исходные с поправками проверяющего, по порядку решений.

    Исходный словарь не меняется: исходная оценка хранится отдельно от решений."""
    final = dict(answers)
    for d in decisions:
        if d.get("answer") is not None:
            final[d["criterion_id"]] = d["answer"]
    return final
