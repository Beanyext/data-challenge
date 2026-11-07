"""Выгрузка results.json по формату организаторов 1.0. Диалоги и оценки выдуманы."""

import copy
import json
from pathlib import Path

import pytest

from app.results.__main__ import main as results_main
from app.results.check import check_results, load_results_file
from app.results.export import build_entry, build_results, evidence_turns, load_evaluations, write_json

ROOT = Path(__file__).resolve().parents[1]
CHECKLIST = json.loads((ROOT / "app/checklists/freedom_chat_v1.json").read_text(encoding="utf-8"))
CODES = ["contact", "discovery", "identification", "consultation", "empathy", "dialogue", "closure", "critical"]
# Пример из приложения организаторов: итог 85.38
EXAMPLE = {"c01": "yes", "c02": "na", "c03": "na", "c04": 15, "c05": "yes", "c06": 7, "c07": "yes", "c08": "no"}


def record(cid="demo-001", n=12):
    texts = ["Где мой тариф в приложении", "Здравствуйте я бот помощник компании", "Эскалация на оператора"]
    texts += [f"Реплика номер {k} про тариф и вкладку кабинет" for k in range(3, n)]
    speakers = ["client", "bot", "system"] + ["operator" if k % 2 else "client" for k in range(3, n)]
    return {"conversation_id": cid, "channel": "agent chat", "language": "RU", "audio_url": None,
            "transcript": [{"timestamp": f"00:{k:02d}", "speaker": s, "text": t} for k, (s, t) in enumerate(zip(speakers, texts))]}


def evaluation(cid="demo-001", answers=EXAMPLE, provider="anthropic", version=None, explanation=None):
    return {
        "conversation_id": cid, "checklist_id": CHECKLIST["id"], "checklist_version": version or CHECKLIST["version"],
        "provider": provider, "model": "claude-opus-5-5", "calls": [{"model": "claude-opus-5-5"}],
        "criteria": [
            {"criterion_id": k, "answer": v, "explanation": explanation or f"{k} — пересказ оценки своими словами.",
             "evidence": [{"turn": 3, "quote": "x"}], "checked_range": None}
            for k, v in answers.items()
        ],
    }


def test_organizers_example():
    entry, notes = build_entry(record(), evaluation(), CHECKLIST)
    assert entry["status"] == "ok" and not notes
    assert [c["criterion_id"] for c in entry["criteria"]] == CODES
    assert [c["value"] for c in entry["criteria"]] == [True, None, None, 15, True, 7, True, False]
    assert entry["score"] == {"final_score": 85.38, "critical_flag": False}
    assert all(c["evidence_turns"] == [4] for c in entry["criteria"])


def test_evidence_turns_count_from_one():
    assert evidence_turns({"evidence": [{"turn": 0}, {"turn": 3}, {"turn": 3}]}, 12) == [1, 4]
    assert evidence_turns({"evidence": [], "checked_range": {"from": 2, "to": 4}}, 12) == [3, 4, 5]
    assert evidence_turns({"evidence": [], "checked_range": {"from": 0, "to": 10}}, 12) == [1, 11]
    with pytest.raises(ValueError):
        evidence_turns({"evidence": [{"turn": 99}], "checked_range": None}, 12)


@pytest.mark.parametrize("invalid", [
    {"evidence": [{"turn": True}]}, {"evidence": [{"turn": False}]},
    {"evidence": [{"turn": "0"}]}, {"evidence": [{"turn": 0.5}]},
    {"evidence": [{"turn": -1}]}, {"evidence": [{"turn": 12}]},
    {"evidence": [{"turn": 0}, {"turn": 99}]}, {"evidence": [None]},
    {"evidence": {}}, {"evidence": None},
    {"evidence": [], "checked_range": {"from": False, "to": 2}},
    {"evidence": [], "checked_range": {"from": 0, "to": True}},
    {"evidence": [], "checked_range": {"from": -1, "to": 2}},
    {"evidence": [], "checked_range": {"from": 0, "to": 12}},
    {"evidence": [], "checked_range": {"from": 3, "to": 2}},
    {"evidence": [], "checked_range": {"from": "0", "to": 2}},
    {"evidence": [], "checked_range": []},
    {"evidence": [{"turn": 0}], "checked_range": {"from": -1, "to": 2}},
])
def test_invalid_evidence_is_explicit_error_not_invented_proof(invalid):
    with pytest.raises(ValueError):
        evidence_turns(invalid, 12)
    ev = evaluation()
    ev["criteria"][0].update(invalid)
    entry, notes = build_entry(record(), ev, CHECKLIST)
    assert entry["conversation_id"] == "demo-001"
    assert entry["status"] == "error" and entry["criteria"] == [] and entry["score"] is None
    assert "доказательства" in entry["error"] and not notes


def test_critical_flag_follows_gross_error():
    entry, _ = build_entry(record(), evaluation(answers={**EXAMPLE, "c08": "yes"}), CHECKLIST)
    assert entry["score"] == {"final_score": 85.38, "critical_flag": True}


@pytest.mark.parametrize(
    "ev, reason",
    [
        (None, "не оценён"),
        ({"conversation_id": "demo-001", "error": "BadRequestError: 400\nподробности"}, "ответ модели"),
        (evaluation(answers={**EXAMPLE, "c01": "na"}), "c01"),
    ],
)
def test_failed_dialog_is_error_not_zero(ev, reason):
    entry, _ = build_entry(record(), ev, CHECKLIST)
    assert entry["status"] == "error" and entry["criteria"] == [] and entry["score"] is None
    assert reason in entry["error"] and "\n" not in entry["error"]


def test_quotes_removed_from_rationale():
    quoted = "Контакт — да. Оператор написал «Реплика номер 3 про тариф и вкладку кабинет» и представился."
    entry, notes = build_entry(record(), evaluation(explanation=quoted), CHECKLIST)
    assert "«…»" in entry["criteria"][0]["rationale"] and "вкладку кабинет" not in entry["criteria"][0]["rationale"]
    assert not notes
    copied = "Оператор: реплика номер 3 про тариф и вкладку кабинет."
    entry, notes = build_entry(record(), evaluation(explanation=copied), CHECKLIST)
    assert "Подробное обоснование" in entry["criteria"][0]["rationale"] and len(notes) == 8


def test_turn_refs_in_rationale_count_from_one():
    text = "Завершение — нет. Основание — реплики [0] и [11]."
    entry, _ = build_entry(record(), evaluation(explanation=text), CHECKLIST)
    assert entry["criteria"][0]["rationale"] == "Завершение — нет. Основание — реплики [1] и [12]."


def test_mock_results_are_refused():
    with pytest.raises(ValueError, match="тестовый режим"):
        build_results([record()], {"demo-001": evaluation(provider="mock")}, CHECKLIST, "Команда")
    with pytest.raises(ValueError, match="названия команды"):
        build_results([record()], {"demo-001": evaluation()}, CHECKLIST, " ")


def good_doc():
    recs = [record("a"), record("b")]
    doc, report = build_results(recs, {"a": evaluation("a"), "b": None}, CHECKLIST, "Команда")
    assert report["ok"] == 1 and report["errors"] == ["b"]
    return doc, recs


def test_valid_doc_passes_check():
    doc, recs = good_doc()
    assert check_results(doc, recs, CHECKLIST, expected=2) == []
    assert doc["model"] == {"mode": "external_api", "name": "claude-opus-5-5"}


@pytest.mark.parametrize("name", [123, True, {}, [], None, "", " "])
def test_model_name_is_a_native_nonempty_string(name):
    doc, recs = good_doc()
    doc["model"]["name"] = name
    assert any("model" in error for error in check_results(doc, recs, CHECKLIST))


@pytest.mark.parametrize("name", ["mock", "Mock", "demo", "mock-test", "demo: synthetic", "claude-opus-5-5, mock"])
def test_mock_model_names_require_explicit_rehearsal(name):
    doc, recs = good_doc()
    doc["model"]["name"] = name
    assert any("тестов" in error for error in check_results(doc, recs, CHECKLIST))
    assert check_results(doc, recs, CHECKLIST, allow_mock=True) == []
    ev = evaluation()
    ev.update(model=name, calls=[{"model": name}])
    with pytest.raises(ValueError, match="тестовый режим"):
        build_results([record()], {"demo-001": ev}, CHECKLIST, "Synthetic team")


@pytest.mark.parametrize("name", ["mockingbird-local", "demographic-encoder", "synthetic-demo-finetune"])
def test_genuine_names_are_not_blocked_by_substrings(name):
    doc, recs = good_doc()
    doc["model"]["name"] = name
    assert check_results(doc, recs, CHECKLIST) == []


def _broken(fn):
    doc, recs = good_doc()
    fn(doc)
    return check_results(doc, recs, CHECKLIST, expected=2)


@pytest.mark.parametrize(
    "fn, message",
    [
        (lambda d: d["results"].append(copy.deepcopy(d["results"][0])), "повтор"),
        (lambda d: d["results"].pop(), "нет записей"),
        (lambda d: d["results"][0]["score"].update(final_score=90.0), "по ответам выходит 85.38"),
        (lambda d: d["results"][0]["score"].update(critical_flag=True), "critical_flag"),
        (lambda d: d["results"][0]["criteria"][5].update(value=True), "ожидается число"),
        (lambda d: d["results"][0]["criteria"][0].update(value=None), "null"),
        (lambda d: d["results"][0]["criteria"].pop(), "ровно по разу"),
        (lambda d: d["results"][0]["criteria"][0].update(evidence_turns=[0]), "от 1 до 12"),
        (lambda d: d["results"][0]["criteria"][0].update(rationale="ок: реплика номер 3 про тариф и вкладку"), "цитата"),
        (lambda d: d["results"][1].update(score=0), "у ошибки"),
        (lambda d: d["results"][0].update(conversation_id="zzz"), "нет в наборе"),
        (lambda d: d.update(schema_version="2.0"), "schema_version"),
        (lambda d: d["model"].update(mode="cloud"), "model"),
        (lambda d: d["results"][0]["score"].update(final_score=85.384), "двух знаков"),
    ],
)
def test_check_catches(fn, message):
    errors = _broken(fn)
    assert any(message in e for e in errors), errors


def test_file_is_utf8_without_bom(tmp_path):
    doc, _ = good_doc()
    path = write_json(doc, tmp_path / "results" / "dev" / "results.json")
    assert load_results_file(path) == doc
    assert not path.read_bytes().startswith(b"\xef\xbb\xbf")
    bom = tmp_path / "bom.json"
    bom.write_bytes(b"\xef\xbb\xbf" + path.read_bytes())
    with pytest.raises(ValueError, match="BOM"):
        load_results_file(bom)
    nan = tmp_path / "nan.json"
    nan.write_text('{"x": NaN}', encoding="utf-8")
    with pytest.raises(ValueError):
        load_results_file(nan)


def test_load_evaluations_prefers_later_and_ok(tmp_path):
    first, second = tmp_path / "1", tmp_path / "2"
    first.mkdir(), second.mkdir()
    (first / "a.json").write_text(json.dumps(evaluation("a", answers={**EXAMPLE, "c06": 4})), encoding="utf-8")
    (second / "a.json").write_text(json.dumps(evaluation("a")), encoding="utf-8")
    (first / "b.json").write_text(json.dumps(evaluation("b")), encoding="utf-8")
    (second / "b.json").write_text(json.dumps({"conversation_id": "b", "error": "сбой"}), encoding="utf-8")
    (second / "c.json").write_text(json.dumps(evaluation("c", version=99)), encoding="utf-8")
    (second / "summary.json").write_text("{}", encoding="utf-8")
    found = load_evaluations([first, second], CHECKLIST)
    assert set(found) == {"a", "b"}
    assert {c["criterion_id"]: c["answer"] for c in found["a"]["criteria"]}["c06"] == 7
    assert "error" not in found["b"]


def test_cli_build_and_check(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    data = tmp_path / "set.json"
    data.write_text(json.dumps({"isSuccess": True, "data": {"records": [record("a"), record("b")]}}), encoding="utf-8")
    evals = tmp_path / "evals"
    evals.mkdir()
    (evals / "a.json").write_text(json.dumps(evaluation("a")), encoding="utf-8")
    (evals / "b.json").write_text(json.dumps(evaluation("b", answers={**EXAMPLE, "c04": 20})), encoding="utf-8")
    out = tmp_path / "results" / "dev" / "results.json"
    checklist = str(ROOT / "app/checklists/freedom_chat_v1.json")
    args = ["--data", str(data), "--checklist", checklist]
    assert results_main(["build", *args, "--evals", str(evals), "--out", str(out), "--team", "Команда", "--expect", "2"]) == 0
    assert results_main(["check", str(out), *args, "--expect", "2"]) == 0
    assert results_main(["check", str(out), *args, "--expect", "10"]) == 1
    assert "Проверка пройдена" in capsys.readouterr().out
    (evals / "b.json").write_text(json.dumps(evaluation("b", provider="mock")), encoding="utf-8")
    assert results_main(["build", *args, "--evals", str(evals), "--out", str(tmp_path / "x.json"), "--team", "К"]) == 1
    assert not (tmp_path / "x.json").exists()


@pytest.mark.parametrize("field, value", [
    ("conversation_id", []), ("conversation_id", {}),
    ("criterion_id", []), ("criterion_id", {}),
])
def test_cli_check_rejects_structured_ids_without_traceback(tmp_path, monkeypatch, capsys, field, value):
    monkeypatch.chdir(tmp_path)
    doc, records = good_doc()
    if field == "conversation_id":
        doc["results"][0][field] = value
    else:
        doc["results"][0]["criteria"][0][field] = value
    data, results = tmp_path / "synthetic-data.json", tmp_path / "synthetic-results.json"
    data.write_text(json.dumps(records), encoding="utf-8")
    results.write_text(json.dumps(doc), encoding="utf-8")
    assert results_main(["check", str(results), "--data", str(data), "--checklist",
                         str(ROOT / "app/checklists/freedom_chat_v1.json"), "--expect", "2"]) == 1
    output = capsys.readouterr()
    assert "ПРОВЕРКА НЕ ПРОЙДЕНА" in output.out
    assert "Traceback" not in output.out + output.err
    assert check_results(doc, records, CHECKLIST, expected=2)


@pytest.mark.parametrize("value", [123, True, [], {}, None, "", " "])
def test_error_reason_must_be_a_native_nonempty_string(tmp_path, monkeypatch, capsys, value):
    monkeypatch.chdir(tmp_path)
    doc, records = good_doc()
    doc["results"][1]["error"] = value
    data, results = tmp_path / "synthetic-data.json", tmp_path / "synthetic-results.json"
    data.write_text(json.dumps(records), encoding="utf-8")
    results.write_text(json.dumps(doc), encoding="utf-8")
    assert results_main(["check", str(results), "--data", str(data), "--checklist",
                         str(ROOT / "app/checklists/freedom_chat_v1.json"), "--expect", "2"]) == 1
    assert "ПРОВЕРКА НЕ ПРОЙДЕНА" in capsys.readouterr().out
    assert any("причина в error" in error for error in check_results(doc, records, CHECKLIST))


@pytest.mark.parametrize("location", ["document", "model", "ok", "error", "criterion", "score"])
@pytest.mark.parametrize("field, value", [
    ("transcript", "SYNTHETIC_PRIVATE_DIALOGUE_MUST_NOT_ECHO"),
    ("api_key", "SYNTHETIC_CREDENTIAL_MUST_NOT_ECHO"),
    ("audio_url", "https://synthetic.invalid/private?sig=SYNTHETIC_URL_MUST_NOT_ECHO"),
])
def test_extra_fields_are_rejected_without_echoing_private_values(tmp_path, monkeypatch, capsys, location, field, value):
    monkeypatch.chdir(tmp_path)
    doc, records = good_doc()
    targets = {"document": doc, "model": doc["model"], "ok": doc["results"][0], "error": doc["results"][1],
               "criterion": doc["results"][0]["criteria"][0], "score": doc["results"][0]["score"]}
    targets[location][field] = value
    errors = check_results(doc, records, CHECKLIST)
    assert any("поля вне формата" in error for error in errors)
    assert value not in "\n".join(errors)
    data, results = tmp_path / "synthetic-data.json", tmp_path / "synthetic-results.json"
    data.write_text(json.dumps(records), encoding="utf-8")
    results.write_text(json.dumps(doc), encoding="utf-8")
    assert results_main(["check", str(results), "--data", str(data), "--checklist",
                         str(ROOT / "app/checklists/freedom_chat_v1.json"), "--expect", "2"]) == 1
    output = capsys.readouterr()
    assert "ПРОВЕРКА НЕ ПРОЙДЕНА" in output.out
    assert value not in output.out + output.err


def test_cli_mock_build_and_check_require_rehearsal_opt_in(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    data, out, evs = tmp_path / "synthetic.json", tmp_path / "results.json", tmp_path / "evals"
    data.write_text(json.dumps([record()]), encoding="utf-8")
    evs.mkdir()
    ev = evaluation(provider="mock")
    ev.update(model="mock", calls=[{"model": "mock"}])
    (evs / "evaluation.json").write_text(json.dumps(ev), encoding="utf-8")
    args = ["--data", str(data), "--checklist", str(ROOT / "app/checklists/freedom_chat_v1.json"), "--expect", "1"]
    build = ["build", *args, "--evals", str(evs), "--out", str(out), "--team", "Synthetic team"]
    assert results_main(build) == 1 and not out.exists()
    assert results_main([*build, "--allow-mock"]) == 0
    output = capsys.readouterr().out
    assert "УЧЕБНАЯ" in output and "не предназначены для сдачи" in output
    assert results_main(["check", str(out), *args]) == 1
    assert "ПРОВЕРКА НЕ ПРОЙДЕНА" in capsys.readouterr().out
    assert results_main(["check", str(out), *args, "--allow-mock"]) == 0
    assert "УЧЕБНАЯ" in capsys.readouterr().out


def test_cli_mock_control_is_explicitly_a_rehearsal(tmp_path, monkeypatch, capsys):
    from app.results import __main__ as cli
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "fetch_group", lambda _: {"isSuccess": True, "data": {"records": [record()]}})
    out = tmp_path / "synthetic-control.json"
    assert results_main(["control", "--group-id", "SYNTHETIC", "--provider", "mock", "--expect", "1", "--out", str(out),
                         "--team", "Synthetic team", "--checklist", str(ROOT / "app/checklists/freedom_chat_v1.json")]) == 0
    output = capsys.readouterr().out
    assert "УЧЕБНАЯ" in output and "не предназначены для сдачи" in output
    assert "git add" not in output and "git push" not in output
    doc = load_results_file(out)
    assert check_results(doc, [record()], CHECKLIST)
    assert check_results(doc, [record()], CHECKLIST, allow_mock=True) == []


@pytest.mark.parametrize('flags', [
    {'needs_review': True},
    {'problems': ['synthetic invalid evidence']},
    {'needs_review': True, 'problems': ['synthetic empty explanation']},
])
def test_unresolved_validation_is_explicit_error_not_success(flags):
    ev = evaluation()
    ev['criteria'][0].update(flags)
    doc, report = build_results([record()], {'demo-001': ev}, CHECKLIST, 'Synthetic team')
    row = doc['results'][0]
    assert row['conversation_id'] == 'demo-001'
    assert row['status'] == 'error' and row['criteria'] == [] and row['score'] is None
    assert 'c01' in row['error']
    assert report['ok'] == 0 and report['errors'] == ['demo-001']
    assert check_results(doc, [record()], CHECKLIST, expected=1) == []


def test_cli_keeps_unresolved_validation_id_and_successful_neighbor(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    data = tmp_path / 'synthetic.json'
    data.write_text(json.dumps([record('a'), record('b')]), encoding='utf-8')
    evs = tmp_path / 'evals'
    evs.mkdir()
    invalid = evaluation('b')
    invalid['criteria'][0].update(needs_review=True, problems=['synthetic unresolved evidence'])
    for ev in (evaluation('a'), invalid):
        (evs / f"{ev['conversation_id']}.json").write_text(json.dumps(ev), encoding='utf-8')
    out = tmp_path / 'results.json'
    assert results_main(['build', '--data', str(data), '--evals', str(evs), '--checklist', str(ROOT / 'app/checklists/freedom_chat_v1.json'), '--team', 'Synthetic team', '--expect', '2', '--out', str(out)]) == 0
    rows = json.loads(out.read_text())['results']
    assert [(row['conversation_id'], row['status']) for row in rows] == [('a', 'ok'), ('b', 'error')]
    assert rows[1]['score'] is None and rows[1]['criteria'] == []
