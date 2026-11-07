"""Файл сдачи результатов организаторам: results/<набор>/results.json в формате JSON 1.0.

Формат и правила: reports/условие.md, раздел «Сдача результатов». Коды критериев берутся из настроек
чек-листа (поле code), а не из кода: новый критерий выгружается без правок здесь. Номера реплик
у нас считаются с 0, в файле сдачи с 1."""

from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path

from app.scoring import NA, NO, YES, ScoringError, normalize_answer, scale_values, score

SCHEMA_VERSION = "1.0"
TEAM_NAME = "SeeUSoon"
MODES = ("local", "external_api", "hybrid")

# Каналы с реальными записями: репозиторий открытый, поэтому в rationale только пересказ.
REAL_CHANNELS = ("voice call",)
# Столько слов подряд из транскрипта считаем дословной цитатой.
QUOTE_WORDS = 4

NO_RATIONALE = "Объяснения от модели нет, оценку нужно проверить человеку."

_TURN_REF = re.compile(r"\[(\d+)(?:\s*[-–—]\s*(\d+))?\]")
_QUOTED = re.compile(r"«[^»]*»|“[^”]*”|„[^“”]*[“”]|\"[^\"]*\"")
_WORD = re.compile(r"\w+")


class ExportError(ValueError):
    """Настройки или данные не позволяют собрать файл сдачи."""


def criterion_code(criterion: dict) -> str:
    code = criterion.get("code")
    if not isinstance(code, str) or not code.strip():
        raise ExportError(f"у критерия {criterion.get('id')} нет поля code: задайте код для файла сдачи в настройках чек-листа")
    return code.strip()


def checklist_codes(checklist: dict) -> dict[str, dict]:
    """{код: критерий}. Коды обязательны и не повторяются."""
    out: dict[str, dict] = {}
    for c in checklist["criteria"]:
        code = criterion_code(c)
        if code in out:
            raise ExportError(f"код {code!r} у двух критериев: {out[code].get('id')} и {c.get('id')}")
        out[code] = c
    return out


def to_value(criterion: dict, answer):
    """Наш ответ в значение файла сдачи: yes = true, no = false, na = null, шкала = число до учёта веса."""
    a = normalize_answer(criterion, answer)
    if a == NA:
        return None
    if a == YES:
        return True
    if a == NO:
        return False
    return a


def from_value(value):
    """Обратно в наш ответ, чтобы пересчитать итог при проверке файла."""
    if value is None:
        return NA
    if value is True:
        return YES
    if value is False:
        return NO
    return value


def shift_turn_refs(text: str) -> str:
    """[5] и [3–11] в тексте объяснения: номера реплик с 0 переводятся в счёт с 1, как в evidence_turns."""

    def repl(m: re.Match) -> str:
        first = int(m.group(1)) + 1
        return f"[{first}]" if m.group(2) is None else f"[{first}–{int(m.group(2)) + 1}]"

    return _TURN_REF.sub(repl, text)


def _norm_word(word: str) -> str:
    return word.lower().replace("ё", "е")


def redact_quotes(text: str, transcript: list[dict], n: int = QUOTE_WORDS) -> tuple[str, int]:
    """Убирает дословные цитаты: текст в кавычках и любые n слов подряд, совпавшие с репликой транскрипта.

    Возвращает новый текст и число замен. Каждая убранная цитата заменяется на «…»."""
    count = 0
    text, k = _QUOTED.subn("«…»", text)
    count += k
    grams: set[tuple[str, ...]] = set()
    for turn in transcript:
        words = [_norm_word(w) for w in _WORD.findall(str(turn.get("text") or ""))]
        grams.update(tuple(words[i : i + n]) for i in range(len(words) - n + 1))
    matches = list(_WORD.finditer(text))
    words = [_norm_word(m.group()) for m in matches]
    covered = [False] * len(words)
    for i in range(len(words) - n + 1):
        if tuple(words[i : i + n]) in grams:
            for j in range(i, i + n):
                covered[j] = True
    if not any(covered):
        return text, count
    out, pos, i = [], 0, 0
    while i < len(words):
        if covered[i]:
            j = i
            while j + 1 < len(words) and covered[j + 1]:
                j += 1
            out.append(text[pos : matches[i].start()])
            out.append("…")
            pos = matches[j].end()
            count += 1
            i = j + 1
        else:
            i += 1
    out.append(text[pos:])
    return "".join(out), count


def evidence_turns(item: dict, n_turns: int) -> list[int]:
    """Номера подтверждающих реплик с 1. Для пропущенного действия — проверенный участок целиком."""
    turns = {ev["turn"] + 1 for ev in item.get("evidence") or [] if isinstance(ev, dict) and isinstance(ev.get("turn"), int)}
    rng = item.get("checked_range")
    if not turns and isinstance(rng, dict) and isinstance(rng.get("from"), int) and isinstance(rng.get("to"), int):
        turns = set(range(rng["from"] + 1, rng["to"] + 2))
    return sorted(t for t in turns if 1 <= t <= n_turns)


def error_entry(conversation_id: str, reason: str) -> dict:
    return {"conversation_id": conversation_id, "status": "error", "criteria": [], "score": None, "error": reason}


def build_entry(record: dict, evaluation: dict | None, checklist: dict) -> tuple[dict, int]:
    """Запись одного диалога и число убранных цитат. Неоценённый диалог становится записью с ошибкой, а не нулём."""
    cid = record["conversation_id"]
    if evaluation is None:
        return error_entry(cid, "диалог не оценён: нет результата оценки"), 0
    if evaluation.get("error"):
        return error_entry(cid, f"оценка не удалась: {evaluation['error']}"), 0
    version = (evaluation.get("checklist_id"), evaluation.get("checklist_version"))
    if version != (checklist.get("id"), checklist.get("version")):
        return error_entry(cid, f"оценка сделана по чек-листу {version[0]} версии {version[1]}, а выгружается версия {checklist.get('version')}: нужна переоценка"), 0
    items = {c.get("criterion_id"): c for c in evaluation.get("criteria") or [] if isinstance(c, dict)}
    transcript = record.get("transcript") or []
    redact = record.get("channel") in REAL_CHANNELS
    criteria, answers, removed = [], {}, 0
    for c in checklist["criteria"]:
        item = items.get(c["id"])
        if item is None:
            return error_entry(cid, f"нет ответа по критерию {c['id']}"), 0
        try:
            value = to_value(c, item.get("answer"))
        except ScoringError as e:
            return error_entry(cid, f"недопустимый ответ модели: {e}"), 0
        answers[c["id"]] = item.get("answer")
        rationale = str(item.get("explanation") or "").strip() or str(item.get("na_reason") or "").strip() or NO_RATIONALE
        rationale = shift_turn_refs(rationale)
        if redact:
            rationale, k = redact_quotes(rationale, transcript)
            removed += k
        criteria.append(
            {
                "criterion_id": criterion_code(c),
                "value": value,
                "rationale": rationale,
                "evidence_turns": evidence_turns(item, len(transcript)),
            }
        )
    result = score(checklist, answers)
    entry = {
        "conversation_id": cid,
        "status": "ok",
        "criteria": criteria,
        "score": {"final_score": result["total"], "critical_flag": bool(result["gross_error"])},
    }
    return entry, removed


def used_models(evaluations: list[dict]) -> list[str]:
    """Фактически отвечавшие модели, включая запасную при отказе основной."""
    names: set[str] = set()
    for ev in evaluations:
        for call in ev.get("calls") or []:
            if call.get("model"):
                names.add(str(call["model"]))
        if ev.get("model"):
            names.add(str(ev["model"]))
    return sorted(names)


def build_results(
    records: list[dict],
    evaluations: dict[str, dict],
    checklist: dict,
    team_name: str = TEAM_NAME,
    mode: str = "external_api",
    default_model: str = "claude-opus-5-5",
) -> tuple[dict, dict]:
    """Файл сдачи по всем диалогам набора в их исходном порядке и сводка: сколько ok, ошибок, убранных цитат."""
    checklist_codes(checklist)
    if mode not in MODES:
        raise ExportError(f"mode должен быть одним из {', '.join(MODES)}")
    ids = [r.get("conversation_id") for r in records]
    if len(set(ids)) != len(ids):
        raise ExportError("в наборе повторяются conversation_id")
    entries, removed, errors = [], 0, {}
    for record in records:
        entry, k = build_entry(record, evaluations.get(record["conversation_id"]), checklist)
        entries.append(entry)
        removed += k
        if entry["status"] == "error":
            errors[entry["conversation_id"]] = entry["error"]
    included = [evaluations[e["conversation_id"]] for e in entries if e["status"] == "ok"]
    models = used_models(included) or [default_model]
    doc = {
        "schema_version": SCHEMA_VERSION,
        "team_name": team_name,
        "model": {"mode": mode, "name": ", ".join(models)},
        "results": entries,
    }
    report = {
        "dialogs": len(entries),
        "ok": len(entries) - len(errors),
        "errors": errors,
        "quotes_removed": removed,
        "unused_evaluations": sorted(set(evaluations) - set(ids)),
    }
    return doc, report


def _check_value(criterion: dict, value) -> str | None:
    if value is None:
        return None if criterion.get("na_allowed") and not criterion.get("gross_error") else "null (N/A) для этого критерия не разрешён"
    if criterion.get("answer_type") == "scale":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return f"ожидается ступень шкалы, получено {value!r}"
        if value not in [float(v) for v in scale_values(criterion)]:
            return f"{value!r} нет среди ступеней шкалы"
        return None
    return None if isinstance(value, bool) else f"ожидается true или false, получено {value!r}"


def validate_results(doc: object, checklist: dict, records: list[dict] | None = None, exact_count: int | None = None) -> list[str]:
    """Все нарушения формата 1.0. Пустой список значит, что файл можно сдавать."""
    problems: list[str] = []
    if not isinstance(doc, dict):
        return ["файл должен быть одним JSON-объектом"]
    if doc.get("schema_version") != SCHEMA_VERSION:
        problems.append(f"schema_version должен быть {SCHEMA_VERSION!r}")
    if not isinstance(doc.get("team_name"), str) or not doc["team_name"].strip():
        problems.append("нет team_name")
    model = doc.get("model")
    if not isinstance(model, dict) or model.get("mode") not in MODES or not isinstance(model.get("name"), str) or not model["name"].strip():
        problems.append(f"model должен быть объектом с mode из {', '.join(MODES)} и непустым name")
    results = doc.get("results")
    if not isinstance(results, list):
        return problems + ["results должен быть массивом"]

    codes = checklist_codes(checklist)
    gross_codes = [code for code, c in codes.items() if c.get("gross_error")]
    by_id = {r.get("conversation_id"): r for r in records or []}
    seen: set = set()
    for i, entry in enumerate(results):
        where = f"results[{i}]"
        if not isinstance(entry, dict):
            problems.append(f"{where}: ожидается объект")
            continue
        cid = entry.get("conversation_id")
        where = f"{where} ({cid})"
        if not isinstance(cid, str) or not cid:
            problems.append(f"{where}: нет conversation_id")
        elif cid in seen:
            problems.append(f"{where}: conversation_id повторяется")
        seen.add(cid)
        if records is not None and cid not in by_id:
            problems.append(f"{where}: такого диалога нет в наборе")
        status = entry.get("status")
        if status == "error":
            if entry.get("criteria") != [] or entry.get("score") is not None:
                problems.append(f"{where}: при status error criteria должен быть [] и score null")
            if not isinstance(entry.get("error"), str) or not entry["error"].strip():
                problems.append(f"{where}: при status error нужна причина в error")
            continue
        if status != "ok":
            problems.append(f"{where}: status должен быть ok или error")
            continue
        crits = entry.get("criteria")
        if not isinstance(crits, list):
            problems.append(f"{where}: criteria должен быть массивом")
            continue
        got = [c.get("criterion_id") for c in crits if isinstance(c, dict)]
        if sorted(got) != sorted(codes) or len(got) != len(crits):
            problems.append(f"{where}: нужны все критерии ровно по разу ({', '.join(codes)}), получено {got}")
        n_turns = len(by_id[cid].get("transcript") or []) if cid in by_id else None
        values = {}
        for c in crits:
            if not isinstance(c, dict) or c.get("criterion_id") not in codes:
                continue
            code = c["criterion_id"]
            bad = _check_value(codes[code], c.get("value"))
            if bad:
                problems.append(f"{where} {code}: {bad}")
            else:
                values[code] = c.get("value")
            if not isinstance(c.get("rationale"), str) or not c["rationale"].strip():
                problems.append(f"{where} {code}: нет rationale")
            turns = c.get("evidence_turns")
            if not isinstance(turns, list) or any(isinstance(t, bool) or not isinstance(t, int) or t < 1 for t in turns):
                problems.append(f"{where} {code}: evidence_turns — список номеров реплик с 1")
            elif n_turns is not None and any(t > n_turns for t in turns):
                problems.append(f"{where} {code}: в диалоге {n_turns} реплик, номер {max(turns)} больше")
        sc = entry.get("score")
        if not isinstance(sc, dict):
            problems.append(f"{where}: score должен быть объектом")
            continue
        final = sc.get("final_score")
        if isinstance(final, bool) or not isinstance(final, (int, float)) or not 0 <= final <= 100 or round(final, 2) != final:
            problems.append(f"{where}: final_score — число от 0 до 100 с двумя знаками")
        if not isinstance(sc.get("critical_flag"), bool):
            problems.append(f"{where}: critical_flag должен быть true или false")
        elif gross_codes and all(g in values for g in gross_codes) and sc["critical_flag"] != any(values[g] is True for g in gross_codes):
            problems.append(f"{where}: critical_flag не совпадает с value критерия {', '.join(gross_codes)}")
        if len(values) == len(codes):
            expected = score(checklist, {codes[k]["id"]: from_value(v) for k, v in values.items()})["total"]
            if expected != final:
                problems.append(f"{where}: final_score {final}, а по ответам выходит {expected}")
    if records is not None:
        missing = [cid for cid in by_id if cid not in seen]
        if missing:
            problems.append(f"нет записей для {len(missing)} диалогов набора: {', '.join(missing[:10])}")
    if exact_count is not None and len(results) != exact_count:
        problems.append(f"записей {len(results)}, а нужно ровно {exact_count}")
    return problems


def dump_results(doc: dict) -> str:
    """JSON в UTF-8 без NaN и комментариев, как требуют организаторы."""
    return json.dumps(doc, ensure_ascii=False, indent=2, allow_nan=False) + "\n"


def write_results(path: str | Path, doc: dict) -> None:
    """Запись через временный файл и замену: при сбое старый файл остаётся целым."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".results-", suffix=".json", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(dump_results(doc))
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def load_evaluations(dirs: list[str | Path]) -> dict[str, dict]:
    """Оценки из папок прогонов outputs/eval/<папка>/<id>.json. Если диалог есть в нескольких, берётся из последней."""
    out: dict[str, dict] = {}
    for d in dirs:
        d = Path(d)
        if not d.is_dir():
            raise ExportError(f"нет папки с оценками: {d}")
        for f in sorted(d.glob("*.json")):
            if f.name == "summary.json":
                continue
            ev = json.loads(f.read_text(encoding="utf-8"))
            if isinstance(ev, dict) and ev.get("conversation_id"):
                out[ev["conversation_id"]] = ev
    return out
