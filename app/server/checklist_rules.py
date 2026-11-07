"""Проверка чек-листа перед сохранением новой версии. Сообщения для интерфейса, по-русски."""

from __future__ import annotations

import copy
import re
import uuid

from app.scoring import ScoringError, scale_values

_ID = re.compile(r"[A-Za-z0-9_.-]{1,64}")


class ChecklistError(ValueError):
    pass


def _number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def validate_checklist(body: object) -> dict:
    """Возвращает копию чек-листа без служебных полей версии. При ошибке — ChecklistError."""
    if not isinstance(body, dict):
        raise ChecklistError("Чек-лист должен быть объектом.")
    cl = copy.deepcopy(body)
    for key in ("version", "created_at"):
        cl.pop(key, None)
    if not str(cl.get("name") or "").strip():
        raise ChecklistError("Укажите название чек-листа.")
    if cl.get("id") in (None, ""):
        cl["id"] = f"cl-{uuid.uuid4().hex[:8]}"
    if not isinstance(cl["id"], str) or not _ID.fullmatch(cl["id"]):
        raise ChecklistError("id чек-листа: латинские буквы, цифры, точка, дефис или подчёркивание.")

    rounding = cl.get("rounding") or {"digits": 2}
    digits = rounding.get("digits", 2) if isinstance(rounding, dict) else None
    if not isinstance(digits, int) or isinstance(digits, bool) or not 0 <= digits <= 4:
        raise ChecklistError("Округление: число знаков от 0 до 4.")
    cl["rounding"] = {**rounding, "digits": digits}

    guidance = cl.get("guidance") or []
    if isinstance(guidance, str):
        guidance = [guidance]
    if not isinstance(guidance, list) or not all(isinstance(g, str) for g in guidance):
        raise ChecklistError("Общие правила должны быть списком строк.")
    cl["guidance"] = guidance

    sections = cl.get("sections") or []
    if not isinstance(sections, list):
        raise ChecklistError("Секции должны быть списком.")
    section_ids = set()
    for s in sections:
        if not isinstance(s, dict) or not isinstance(s.get("id"), str) or not _ID.fullmatch(s["id"]):
            raise ChecklistError("У каждой секции нужен id из латинских букв и цифр.")
        if s["id"] in section_ids:
            raise ChecklistError(f"Секция {s['id']} повторяется.")
        if not str(s.get("name") or "").strip():
            raise ChecklistError(f"У секции {s['id']} нет названия.")
        section_ids.add(s["id"])
    cl["sections"] = sections

    criteria = cl.get("criteria")
    if not isinstance(criteria, list) or not criteria:
        raise ChecklistError("Нужен хотя бы один критерий.")
    ids, codes = set(), set()
    for c in criteria:
        if not isinstance(c, dict):
            raise ChecklistError("Критерий должен быть объектом.")
        cid = c.get("id")
        if not isinstance(cid, str) or not _ID.fullmatch(cid):
            raise ChecklistError("У каждого критерия нужен id из латинских букв и цифр.")
        if cid in ids:
            raise ChecklistError(f"Критерий {cid} повторяется.")
        ids.add(cid)
        code = c.get("code") or cid
        if not isinstance(code, str) or not _ID.fullmatch(code):
            raise ChecklistError(f"{cid}: код для выгрузки — латинские буквы, цифры, точка, дефис или подчёркивание.")
        if code in codes:
            raise ChecklistError(f"{cid}: код {code} уже есть у другого критерия.")
        codes.add(code)
        if not str(c.get("title") or "").strip():
            raise ChecklistError(f"{cid}: укажите название критерия.")
        if c.get("answer_type") not in ("binary", "scale"):
            raise ChecklistError(f"{cid}: тип ответа binary (да/нет) или scale (шкала).")
        weight = c.get("weight", 0)
        if not _number(weight) or weight < 0:
            raise ChecklistError(f"{cid}: вес — число не меньше нуля.")
        gross = bool(c.get("gross_error"))
        c["gross_error"] = gross
        c["na_allowed"] = bool(c.get("na_allowed"))
        if gross:
            if c["answer_type"] != "binary":
                raise ChecklistError(f"{cid}: грубая ошибка отмечается ответом да/нет.")
            if weight != 0:
                raise ChecklistError(f"{cid}: грубая ошибка отмечается отдельно и должна иметь нулевой вес.")
            if c["na_allowed"]:
                raise ChecklistError(f"{cid}: для грубой ошибки N/A не бывает.")
        if c["na_allowed"] and not str(c.get("na_rule") or "").strip():
            raise ChecklistError(f"{cid}: если N/A разрешён, опишите, когда он ставится.")
        if c["answer_type"] == "scale":
            scale = c.get("scale")
            if not isinstance(scale, dict) or not _number(scale.get("min")) or not _number(scale.get("max")) or scale["min"] >= scale["max"]:
                raise ChecklistError(f"{cid}: у шкалы нужны числа min < max.")
            steps = scale.get("steps") or []
            if not isinstance(steps, list) or any(not isinstance(s, dict) or not _number(s.get("value")) for s in steps):
                raise ChecklistError(f"{cid}: ступени шкалы — список с числовым value.")
            values = [s["value"] for s in steps]
            if len(set(values)) != len(values):
                raise ChecklistError(f"{cid}: ступени шкалы повторяются.")
            if any(not scale["min"] <= v <= scale["max"] for v in values):
                raise ChecklistError(f"{cid}: ступени шкалы должны быть в пределах от {scale['min']} до {scale['max']}.")
            try:
                top = scale_values(c)[0]
            except (ScoringError, KeyError, ValueError):
                raise ChecklistError(f"{cid}: шкала задана неверно.") from None
            if top <= 0:
                raise ChecklistError(f"{cid}: верхняя ступень шкалы должна быть больше нуля.")
        else:
            c["scale"] = None
        if section_ids and c.get("section_id") not in section_ids:
            raise ChecklistError(f"{cid}: укажите одну из секций чек-листа.")
    return cl
