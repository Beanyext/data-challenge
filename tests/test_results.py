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
    assert evidence_turns({"evidence": [{"turn": 99}], "checked_range": None}, 12) == []


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
