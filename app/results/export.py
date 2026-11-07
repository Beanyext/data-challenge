"""Сборка results.json из сохранённых оценок модуля app.evaluator."""

from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path

from app.scoring import NA, NO, YES, ScoringError, normalize_answer, scale_values, score

SCHEMA_VERSION = "1.0"
MODES = ("local", "external_api", "hybrid")
QUOTE_WORDS = 6  # столько слов подряд из транскрипта уже считается цитатой

_QUOTED = re.compile(r"«[^»]*»|“[^”]*”|„[^“”]*[“”]|\"[^\"]*\"")
_WORD = re.compile(r"\w+")
_TURN_REF = re.compile(r"\[(\d{1,4})\]")


def criterion_code(criterion: dict) -> str:
    """Код критерия в файле сдачи: поле code из настроек, без него — id."""
    return criterion.get("code") or criterion["id"]


def to_value(answer):
    if answer == NA:
        return None
    if answer == YES:
        return True
    if answer == NO:
        return False
    return answer


def from_value(value):
    if value is None:
        return NA
    if value is True:
        return YES
    if value is False:
        return NO
    return value


def _words(text: object) -> list[str]:
    return _WORD.findall(str(text or "").lower().replace("ё", "е"))


def transcript_grams(transcript: list[dict], n: int = QUOTE_WORDS) -> set[tuple[str, ...]]:
    grams: set[tuple[str, ...]] = set()
    for turn in transcript:
        w = _words(turn.get("text"))
        grams.update(tuple(w[i : i + n]) for i in range(len(w) - n + 1))
    return grams


def leaks_quote(text: str, grams: set[tuple[str, ...]], n: int = QUOTE_WORDS) -> bool:
    """В тексте есть кусок из n слов подряд, дословно взятый из транскрипта."""
    w = _words(text)
    return any(tuple(w[i : i + n]) in grams for i in range(len(w) - n + 1))


def _answer_words(criterion: dict, answer) -> str:
    if answer == NA:
        return "N/A"
    if answer == YES:
        return "нарушение найдено" if criterion.get("gross_error") else "да"
    if answer == NO:
        return "нарушений нет" if criterion.get("gross_error") else "нет"
    top = scale_values(criterion)[0]
    return f"{answer} из {int(top) if top.denominator == 1 else float(top)}"


def rationale(explanation: str, criterion: dict, answer, grams: set) -> tuple[str, bool]:
    """Объяснение пересказом. Кавычки с текстом убираются; если цитата всё равно осталась,
    ставится короткий шаблон. Ссылки вида [9] модель пишет по нашей нумерации с 0,
    в файле сдачи они переводятся в нумерацию организаторов с 1, как evidence_turns.
    Второе значение — пришлось ли заменить текст шаблоном."""
    text = _QUOTED.sub("«…»", " ".join(str(explanation or "").split()))[:600]
    text = _TURN_REF.sub(lambda m: f"[{int(m.group(1)) + 1}]", text)
    if text and not leaks_quote(text, grams):
        return text, False
    return f"{criterion['title']} — {_answer_words(criterion, answer)}. Подробное обоснование со ссылками на реплики есть в интерфейсе.", True


def evidence_turns(item: dict, n_turns: int) -> list[int]:
    """Номера реплик с 1, как требуют организаторы. У нас turn считается с 0."""
    turns = sorted({e["turn"] + 1 for e in item.get("evidence") or [] if isinstance(e.get("turn"), int) and 0 <= e["turn"] < n_turns})
    if turns:
        return turns
    rng = item.get("checked_range")
    if isinstance(rng, dict) and isinstance(rng.get("from"), int) and isinstance(rng.get("to"), int):
        lo, hi = max(0, rng["from"]), min(n_turns - 1, rng["to"])
        if lo <= hi:
            return list(range(lo + 1, hi + 2)) if hi - lo < 5 else [lo + 1, hi + 1]
    return []


def _error(cid: str, reason: str) -> dict:
    return {"conversation_id": cid, "status": "error", "criteria": [], "score": None, "error": reason[:300]}


def build_entry(record: dict, evaluation: dict | None, checklist: dict) -> tuple[dict, list[str]]:
    """Запись одного диалога и заметки о замене объяснений шаблоном."""
    cid = record["conversation_id"]
    if evaluation is None:
        return _error(cid, "Диалог не оценён: нет результата оценки."), []
    if evaluation.get("error"):
        return _error(cid, f"Не удалось получить ответ модели: {str(evaluation['error']).splitlines()[0]}"), []
    by_id = {c["criterion_id"]: c for c in evaluation.get("criteria") or []}
    answers, problems = {}, []
    for c in checklist["criteria"]:
        item = by_id.get(c["id"])
        try:
            answers[c["id"]] = normalize_answer(c, item.get("answer") if item else None)
        except ScoringError:
            problems.append(c["id"])
    if problems:
        return _error(cid, f"Нет допустимого ответа модели по критериям: {', '.join(problems)}."), []
    sc = score(checklist, answers)
    if sc["total"] is None:
        return _error(cid, "Итог не рассчитан: нет применимых критериев с весом."), []

    transcript = record.get("transcript") or []
    grams = transcript_grams(transcript)
    notes, criteria = [], []
    for c in checklist["criteria"]:
        item = by_id[c["id"]]
        text, replaced = rationale(item.get("explanation", ""), c, answers[c["id"]], grams)
        if replaced:
            notes.append(f"{cid} {c['id']}: объяснение заменено шаблоном (цитата или пусто)")
        criteria.append(
            {
                "criterion_id": criterion_code(c),
                "value": to_value(answers[c["id"]]),
                "rationale": text,
                "evidence_turns": evidence_turns(item, len(transcript)),
            }
        )
    entry = {
        "conversation_id": cid,
        "status": "ok",
        "criteria": criteria,
        "score": {"final_score": sc["total"], "critical_flag": sc["gross_error"]},
    }
    return entry, notes


def load_evaluations(dirs: list[str | Path], checklist: dict) -> dict[str, dict]:
    """Оценки из папок модуля оценки. Более поздняя папка важнее; оценка по другому чек-листу не берётся.
    Успешная оценка всегда важнее ошибки."""
    found: dict[str, dict] = {}
    for d in dirs:
        for f in sorted(Path(d).glob("*.json")):
            if f.name == "summary.json":
                continue
            ev = json.loads(f.read_text(encoding="utf-8"))
            cid = ev.get("conversation_id")
            if not cid:
                continue
            if not ev.get("error") and (ev.get("checklist_id"), ev.get("checklist_version")) != (checklist.get("id"), checklist.get("version")):
                continue
            if ev.get("error") and cid in found and not found[cid].get("error"):
                continue
            found[cid] = ev
    return found


def build_results(records: list[dict], evaluations: dict[str, dict], checklist: dict, team_name: str,
                  mode: str = "external_api", allow_mock: bool = False) -> tuple[dict, dict]:
    """Документ сдачи и отчёт: сколько ok, сколько ошибок, какие объяснения заменены."""
    if not str(team_name or "").strip():
        raise ValueError("нет названия команды: --team или CQA_TEAM_NAME в .env")
    if mode not in MODES:
        raise ValueError(f"mode должен быть одним из {MODES}")
    used = [evaluations.get(r["conversation_id"]) for r in records]
    if not allow_mock and any(ev and ev.get("provider") == "mock" for ev in used):
        raise ValueError("среди оценок есть тестовый режим без модели: такие результаты сдавать нельзя")
    results, notes = [], []
    for record, ev in zip(records, used):
        entry, n = build_entry(record, ev, checklist)
        results.append(entry)
        notes += n
    models = sorted({c.get("model") for ev in used if ev and not ev.get("error") for c in ev.get("calls") or [] if c.get("model")})
    name = ", ".join(models) or os.environ.get("CQA_MODEL", "claude-opus-5-5")
    doc = {"schema_version": SCHEMA_VERSION, "team_name": team_name.strip(), "model": {"mode": mode, "name": name}, "results": results}
    report = {
        "records": len(results),
        "ok": sum(r["status"] == "ok" for r in results),
        "errors": [r["conversation_id"] for r in results if r["status"] == "error"],
        "rationale_replaced": notes,
        "models": models,
    }
    return doc, report


def write_json(doc: dict, path: str | Path) -> Path:
    """UTF-8 без BOM, без NaN; запись через временный файл."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(doc, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    fd, tmp = tempfile.mkstemp(prefix=".results-", suffix=".json", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return path
