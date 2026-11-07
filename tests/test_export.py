import copy
import json
from pathlib import Path

import pytest

from app.export.cli import main as export_main
from app.export.results import (
    ExportError,
    build_entry,
    build_results,
    dump_results,
    redact_quotes,
    shift_turn_refs,
    validate_results,
)

ROOT = Path(__file__).resolve().parents[1]
CHECKLIST_PATH = ROOT / "app/checklists/freedom_chat_v1.json"
CHECKLIST = json.loads(CHECKLIST_PATH.read_text(encoding="utf-8"))
CODES = ["contact", "discovery", "identification", "consultation", "empathy", "dialogue", "closure", "critical"]

CHAT = {
    "conversation_id": "t-chat-1",
    "channel": "agent chat",
    "language": "RU",
    "transcript": [
        {"timestamp": "00:00", "speaker": "client", "text": "Где посмотреть тариф?"},
        {"timestamp": "00:02", "speaker": "bot", "text": "Здравствуйте! Я бот-помощник."},
        {"timestamp": "00:10", "speaker": "system", "text": "Эскалация на оператора."},
        {"timestamp": "01:00", "speaker": "operator", "text": "Здравствуйте, меня зовут Ирина. Тариф указан в разделе Кабинет."},
        {"timestamp": "01:20", "speaker": "client", "text": "Нашёл, спасибо."},
        {"timestamp": "01:40", "speaker": "operator", "text": "Рада помочь! Хорошего дня."},
    ],
}
CALL = {**copy.deepcopy(CHAT), "conversation_id": "t-call-1", "channel": "voice call"}

# Ответы из примера в приложении организаторов: итог 85.38.
EXAMPLE = {"c01": "yes", "c02": "na", "c03": "na", "c04": 15, "c05": "yes", "c06": 7, "c07": "yes", "c08": "no"}


def evaluation(record=CHAT, answers=EXAMPLE, checklist=CHECKLIST, explanation="Выполнено, основание — реплика [3].", models=("claude-opus-5-5",)):
    criteria = []
    for c in checklist["criteria"]:
        answer = answers.get(c["id"], "yes")
        criteria.append(
            {
                "criterion_id": c["id"],
                "answer": answer,
                "explanation": explanation,
                "evidence": [{"turn": 3, "quote": "меня зовут Ирина"}],
                "checked_range": None,
                "na_reason": "Условие неприменимости выполнено." if answer == "na" else None,
                "needs_review": False,
                "problems": [],
            }
        )
    return {
        "conversation_id": record["conversation_id"],
        "checklist_id": checklist["id"],
        "checklist_version": checklist["version"],
        "model": models[-1],
        "calls": [{"model": m} for m in models],
        "criteria": criteria,
    }


def test_codes_come_from_checklist_settings():
    assert [c["code"] for c in CHECKLIST["criteria"]] == CODES


def test_organizers_example_scores_85_38():
    entry, removed = build_entry(CHAT, evaluation(), CHECKLIST)
    assert entry["status"] == "ok" and removed == 0
    assert [c["criterion_id"] for c in entry["criteria"]] == CODES
    assert [c["value"] for c in entry["criteria"]] == [True, None, None, 15, True, 7, True, False]
    assert entry["score"] == {"final_score": 85.38, "critical_flag": False}


def test_whole_file_passes_validation():
    doc, report = build_results([CHAT], {CHAT["conversation_id"]: evaluation()}, CHECKLIST)
    assert doc["schema_version"] == "1.0" and doc["team_name"] == "SeeUSoon"
    assert doc["model"] == {"mode": "external_api", "name": "claude-opus-5-5"}
    assert report == {"dialogs": 1, "ok": 1, "errors": {}, "quotes_removed": 0, "unused_evaluations": []}
    assert validate_results(doc, CHECKLIST, [CHAT]) == []


def test_turns_counted_from_one():
    ev = evaluation()
    ev["criteria"][0]["evidence"] = [{"turn": 3, "quote": "x"}, {"turn": 0, "quote": "y"}, {"turn": 3, "quote": "z"}]
    ev["criteria"][7]["evidence"] = []
    ev["criteria"][7]["checked_range"] = {"from": 3, "to": 5}
    ev["criteria"][1]["evidence"] = [{"turn": 99, "quote": "нет такой"}]
    entry, _ = build_entry(CHAT, ev, CHECKLIST)
    turns = {c["criterion_id"]: c["evidence_turns"] for c in entry["criteria"]}
    assert turns["contact"] == [1, 4]
    assert turns["critical"] == [4, 5, 6]
    assert turns["discovery"] == []


def test_turn_references_in_rationale_shifted():
    assert shift_turn_refs("Основание — реплика [3] и участок [2–4], [5-7].") == "Основание — реплика [4] и участок [3–5], [6–8]."
    assert shift_turn_refs("[Имя скрыто] без номеров") == "[Имя скрыто] без номеров"
    entry, _ = build_entry(CHAT, evaluation(), CHECKLIST)
    assert entry["criteria"][0]["rationale"] == "Выполнено, основание — реплика [4]."


@pytest.mark.parametrize(
    "ev, reason",
    [
        (None, "не оценён"),
        ({"conversation_id": "t-chat-1", "error": "EvaluationError: модель отказалась"}, "модель отказалась"),
        (evaluation(answers={**EXAMPLE, "c01": "na"}), "недопустимый ответ"),
        ({**evaluation(), "checklist_version": 0}, "нужна переоценка"),
    ],
)
def test_failures_become_error_entries_not_zeros(ev, reason):
    doc, report = build_results([CHAT], {} if ev is None else {"t-chat-1": ev}, CHECKLIST)
    entry = doc["results"][0]
    assert entry["status"] == "error" and entry["criteria"] == [] and entry["score"] is None
    assert reason in entry["error"] and report["ok"] == 0
    assert validate_results(doc, CHECKLIST, [CHAT]) == []


def test_missing_criterion_in_evaluation_is_error():
    ev = evaluation()
    ev["criteria"] = ev["criteria"][:-1]
    entry, _ = build_entry(CHAT, ev, CHECKLIST)
    assert entry["status"] == "error" and "c08" in entry["error"]


def broken(mutate):
    doc, _ = build_results([CHAT], {"t-chat-1": evaluation()}, CHECKLIST)
    doc = copy.deepcopy(doc)
    mutate(doc)
    return validate_results(doc, CHECKLIST, [CHAT])


@pytest.mark.parametrize(
    "mutate, expected",
    [
        (lambda d: d["results"].append(copy.deepcopy(d["results"][0])), "повторяется"),
        (lambda d: d["results"][0]["criteria"].pop(), "ровно по разу"),
        (lambda d: d["results"][0]["criteria"][0].update(value=None), "не разрешён"),
        (lambda d: d["results"][0]["criteria"][3].update(value=12), "нет среди ступеней"),
        (lambda d: d["results"][0]["criteria"][4].update(value=1), "true или false"),
        (lambda d: d["results"][0]["score"].update(final_score=90.0), "по ответам выходит 85.38"),
        (lambda d: d["results"][0]["score"].update(critical_flag=True), "critical_flag не совпадает"),
        (lambda d: d["results"][0]["criteria"][0].update(evidence_turns=[0]), "с 1"),
        (lambda d: d["results"][0]["criteria"][0].update(evidence_turns=[True]), "с 1"),
        (lambda d: d["results"][0]["criteria"][0].update(evidence_turns=[7]), "6 реплик"),
        (lambda d: d["results"][0]["criteria"][0].update(rationale=" "), "нет rationale"),
        (lambda d: d["results"][0].update(conversation_id="чужой"), "нет в наборе"),
        (lambda d: d.update(model={"mode": "cloud", "name": "x"}), "mode"),
        (lambda d: d.update(schema_version="2.0"), "schema_version"),
        (lambda d: d["results"].clear(), "нет записей"),
    ],
)
def test_validation_catches_format_errors(mutate, expected):
    problems = broken(mutate)
    assert any(expected in p for p in problems), problems


def test_prod_needs_exactly_ten():
    doc, _ = build_results([CHAT], {"t-chat-1": evaluation()}, CHECKLIST)
    assert any("ровно 10" in p for p in validate_results(doc, CHECKLIST, [CHAT], exact_count=10))


def test_quotes_removed_only_for_real_calls():
    text = "Нет. Оператор написал «Рада помочь» и меня зовут Ирина тариф указан, но не попрощался."
    redacted, k = redact_quotes(text, CALL["transcript"])
    assert "Рада помочь" not in redacted and "меня зовут Ирина" not in redacted
    assert "Оператор написал" in redacted and k == 2
    call_entry, removed = build_entry(CALL, evaluation(CALL, explanation=text), CHECKLIST)
    assert removed > 0 and "Ирина" not in call_entry["criteria"][0]["rationale"]
    chat_entry, removed = build_entry(CHAT, evaluation(explanation=text), CHECKLIST)
    assert removed == 0 and "Ирина" in chat_entry["criteria"][0]["rationale"]


def test_new_criterion_from_settings_needs_no_code_changes():
    checklist = copy.deepcopy(CHECKLIST)
    checklist["version"] = 2
    checklist["criteria"].append(
        {"id": "c09", "code": "politeness", "section_id": "s3", "title": "Вежливость", "answer_type": "binary",
         "scale": None, "weight": 5, "na_allowed": False, "na_rule": None, "gross_error": False}
    )
    doc, _ = build_results([CHAT], {"t-chat-1": evaluation(checklist=checklist)}, checklist)
    assert doc["results"][0]["criteria"][-1]["criterion_id"] == "politeness"
    assert validate_results(doc, checklist, [CHAT]) == []
    del checklist["criteria"][-1]["code"]
    with pytest.raises(ExportError, match="c09"):
        build_results([CHAT], {}, checklist)


def test_all_used_models_listed():
    doc, _ = build_results([CHAT], {"t-chat-1": evaluation(models=("claude-opus-5-5", "claude-opus-5"))}, CHECKLIST)
    assert doc["model"]["name"] == "claude-opus-5, claude-opus-5-5"


def test_dump_is_plain_utf8_json():
    doc, _ = build_results([CHAT], {"t-chat-1": evaluation()}, CHECKLIST)
    text = dump_results(doc)
    assert "SeeUSoon" in text and "Выполнено" in text and "\\u" not in text
    assert json.loads(text) == doc


def write_run(tmp_path, records, evaluations):
    data = tmp_path / "data.json"
    data.write_text(json.dumps({"isSuccess": True, "data": {"records": records}}, ensure_ascii=False), encoding="utf-8")
    run = tmp_path / "eval"
    run.mkdir()
    for ev in evaluations:
        (run / f"{ev['conversation_id']}.json").write_text(json.dumps(ev, ensure_ascii=False), encoding="utf-8")
    (run / "summary.json").write_text(json.dumps({"dialogs": len(evaluations)}), encoding="utf-8")
    return data, run


def test_cli_writes_and_checks_file(tmp_path, capsys):
    data, run = write_run(tmp_path, [CHAT, CALL], [evaluation(), {"conversation_id": "t-call-1", "error": "сбой сети"}])
    out = tmp_path / "results" / "dev" / "results.json"
    args = ["--set", "dev", "--data", str(data), "--checklist", str(CHECKLIST_PATH)]
    assert export_main(args + ["--evals", str(run), "--out", str(out)]) == 0
    doc = json.loads(out.read_text(encoding="utf-8"))
    assert [r["status"] for r in doc["results"]] == ["ok", "error"]
    assert "t-call-1: оценка не удалась: сбой сети" in capsys.readouterr().out
    assert export_main(args + ["--check", str(out)]) == 0


def test_cli_refuses_prod_without_ten_records(tmp_path, capsys):
    data, run = write_run(tmp_path, [CHAT], [evaluation()])
    out = tmp_path / "prod.json"
    code = export_main(["--set", "prod", "--data", str(data), "--checklist", str(CHECKLIST_PATH), "--evals", str(run), "--out", str(out)])
    assert code == 2 and not out.exists()
    assert "ровно 10" in capsys.readouterr().err
