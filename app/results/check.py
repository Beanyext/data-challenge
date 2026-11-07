"""Проверка файла сдачи перед push: формат 1.0, все ID набора ровно по разу, итог сходится с ответами."""

from __future__ import annotations

import json
import math
from fractions import Fraction
from pathlib import Path

from app.results.export import MODES, SCHEMA_VERSION, criterion_code, from_value, is_mock_model, leaks_quote, transcript_grams
from app.scoring import ScoringError, normalize_answer, score


def _is_number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _extra_fields(value: dict, allowed: set[str], where: str) -> list[str]:
    return [f"{where}: есть поля вне формата сдачи"] if value.keys() - allowed else []


def _check_value(c: dict, value) -> str | None:
    if value is None:
        return None if c.get("na_allowed") and not c.get("gross_error") else "null (N/A) для этого критерия не разрешён"
    if c.get("gross_error") or c.get("answer_type") != "scale":
        return None if isinstance(value, bool) else f"ожидается true/false, получено {value!r}"
    if not _is_number(value):
        return f"ожидается число шкалы, получено {value!r}"
    try:
        normalize_answer(c, value)
    except ScoringError as e:
        return str(e)
    return None


def check_results(doc: object, records: list[dict], checklist: dict, expected: int | None = None, *, allow_mock: bool = False) -> list[str]:
    """Список ошибок. Пустой список — файл можно сдавать."""
    errs: list[str] = []
    if not isinstance(doc, dict):
        return ["корень файла должен быть объектом"]
    errs += _extra_fields(doc, {"schema_version", "team_name", "model", "results"}, "корень файла")
    if doc.get("schema_version") != SCHEMA_VERSION:
        errs.append(f"schema_version должен быть {SCHEMA_VERSION!r}")
    if not isinstance(doc.get("team_name"), str) or not doc["team_name"].strip():
        errs.append("нет team_name")
    model = doc.get("model")
    if isinstance(model, dict):
        errs += _extra_fields(model, {"mode", "name"}, "model")
    if (not isinstance(model, dict) or model.get("mode") not in MODES
            or not isinstance(model.get("name"), str) or not model["name"].strip()):
        errs.append(f"model должен быть {{mode: {'|'.join(MODES)}, name: непустая строка}}")
    elif not allow_mock and is_mock_model(model["name"]):
        errs.append("model.name указывает тестовый режим: такие результаты сдавать нельзя")
    results = doc.get("results")
    if not isinstance(results, list):
        return errs + ["results должен быть массивом"]

    by_id = {r["conversation_id"]: r for r in records}
    if expected is not None and len(results) != expected:
        errs.append(f"записей {len(results)}, нужно ровно {expected}")
    seen: set[str] = set()
    crit_by_code = {criterion_code(c): c for c in checklist["criteria"]}
    for k, r in enumerate(results):
        where = f"results[{k}]"
        if not isinstance(r, dict):
            errs.append(f"{where}: не объект")
            continue
        allowed = {"conversation_id", "status", "criteria", "score"}
        if r.get("status") == "error":
            allowed.add("error")
        errs += _extra_fields(r, allowed, where)
        cid = r.get("conversation_id")
        if not isinstance(cid, str) or not cid.strip():
            errs.append(f"{where}: conversation_id должен быть непустой строкой")
            continue
        where = f"{where} {cid}"
        if cid not in by_id:
            errs.append(f"{where}: такого conversation_id нет в наборе")
            continue
        if cid in seen:
            errs.append(f"{where}: повтор conversation_id")
        seen.add(cid)
        status = r.get("status")
        if status == "error":
            if (r.get("criteria") != [] or r.get("score") is not None
                    or not isinstance(r.get("error"), str) or not r["error"].strip()):
                errs.append(f"{where}: у ошибки должны быть criteria: [], score: null и причина в error")
            continue
        if status != "ok":
            errs.append(f"{where}: status должен быть ok или error")
            continue
        errs += _check_ok(where, r, by_id[cid], checklist, crit_by_code)
    missing = [cid for cid in by_id if cid not in seen]
    if missing:
        errs.append(f"нет записей для {len(missing)} диалогов набора, например {missing[0]}")
    return errs


def _check_ok(where: str, r: dict, record: dict, checklist: dict, crit_by_code: dict) -> list[str]:
    errs: list[str] = []
    items = r.get("criteria")
    if not isinstance(items, list):
        return [f"{where}: criteria должен быть массивом"]
    codes = [i.get("criterion_id") if isinstance(i, dict) else None for i in items]
    if (any(not isinstance(code, str) or not code.strip() for code in codes)
            or sorted(codes) != sorted(crit_by_code) or len(set(codes)) != len(codes)):
        errs.append(f"{where}: нужны все критерии ровно по разу: {', '.join(crit_by_code)}")
    n_turns = len(record.get("transcript") or [])
    grams = transcript_grams(record.get("transcript") or [])
    answers = {}
    for i in items:
        if isinstance(i, dict):
            errs += _extra_fields(i, {"criterion_id", "value", "rationale", "evidence_turns"}, f"{where} критерий")
        if not isinstance(i, dict) or not isinstance(i.get("criterion_id"), str) or i["criterion_id"] not in crit_by_code:
            continue
        c = crit_by_code[i["criterion_id"]]
        problem = _check_value(c, i.get("value"))
        if problem:
            errs.append(f"{where} {c['id']}: {problem}")
        else:
            answers[c["id"]] = from_value(i.get("value"))
        if not isinstance(i.get("rationale"), str) or not i["rationale"].strip():
            errs.append(f"{where} {c['id']}: пустой rationale")
        elif leaks_quote(i["rationale"], grams):
            errs.append(f"{where} {c['id']}: в rationale дословная цитата из транскрипта")
        turns = i.get("evidence_turns")
        if not isinstance(turns, list) or any(not isinstance(t, int) or isinstance(t, bool) or not 1 <= t <= n_turns for t in turns):
            errs.append(f"{where} {c['id']}: evidence_turns — номера реплик от 1 до {n_turns}")
    sc = r.get("score")
    if isinstance(sc, dict):
        errs += _extra_fields(sc, {"final_score", "critical_flag"}, f"{where} score")
    if not isinstance(sc, dict) or not _is_number(sc.get("final_score")) or not isinstance(sc.get("critical_flag"), bool):
        return errs + [f"{where}: score должен быть {{final_score: число, critical_flag: true/false}}"]
    final = sc["final_score"]
    if not 0 <= final <= 100 or Fraction(str(final)) * 100 % 1 != 0:
        errs.append(f"{where}: final_score от 0 до 100 и не больше двух знаков после точки")
    if len(answers) == len(checklist["criteria"]):
        expected = score(checklist, answers)
        if expected["total"] != final:
            errs.append(f"{where}: final_score {final}, а по ответам выходит {expected['total']}")
        if expected["gross_error"] != sc["critical_flag"]:
            errs.append(f"{where}: critical_flag не совпадает с value грубого нарушения")
    return errs


def load_results_file(path: str | Path) -> dict:
    """Строгое чтение: UTF-8 без BOM, обычный JSON без NaN."""
    raw = Path(path).read_bytes()
    if raw.startswith(b"\xef\xbb\xbf"):
        raise ValueError("файл начинается с BOM: нужен UTF-8 без BOM")

    def no_constants(name):
        raise ValueError(f"в файле {name}: так нельзя в JSON")

    return json.loads(raw.decode("utf-8"), parse_constant=no_constants)
