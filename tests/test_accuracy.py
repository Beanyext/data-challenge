"""Замер точности на выдуманной разметке и оценках."""

import json
from pathlib import Path

from app.accuracy import compare, evaluations_from_results, report
from app.results.export import build_results, write_json

ROOT = Path(__file__).resolve().parents[1]
CHECKLIST = json.loads((ROOT / "app/checklists/freedom_chat_v1.json").read_text(encoding="utf-8"))
GOLD_ANS = {"c01": "yes", "c02": "na", "c03": "na", "c04": 15, "c05": "yes", "c06": 7, "c07": "yes", "c08": "no"}


def ev(cid, **changes):
    answers = {**GOLD_ANS, **changes}
    return {"conversation_id": cid, "criteria": [{"criterion_id": k, "answer": str(v)} for k, v in answers.items()]}


def setup():
    gold = {"split": {"tune": ["a", "b"], "holdout": ["h"]},
            "labels": {"a": {"answers": GOLD_ANS, "unsure": ["c06"]}, "b": {"answers": GOLD_ANS}, "h": {"answers": GOLD_ANS}}}
    records = {k: {"conversation_id": k, "language": "RU" if k != "b" else "KZ", "channel": "agent chat"} for k in "abh"}
    evals = {"a": ev("a", c06=4), "b": ev("b"), "h": ev("h", c07="no")}
    return gold, evals, records


def test_agreement_and_mae():
    gold, evals, records = setup()
    rep = report(compare(gold, evals, records, CHECKLIST, "all"), CHECKLIST, show_holdout=False)
    t = rep["tune"]
    assert t["pairs"] == 16 and t["agreement"] == 15 / 16
    assert t["agreement_without_unsure"] == 1.0 and t["pairs_without_unsure"] == 15
    assert t["by_criterion"]["c06"] == 0.5 and t["by_language"] == {"KZ": 1.0, "RU": 7 / 8}
    assert t["total_mae"] > 0 and t["mismatches"] == ["a c06: разметка 7, модель 4 (сомневаюсь)"]
    assert rep["holdout"]["agreement"] == 7 / 8 and "mismatches" not in rep["holdout"]


def test_missing_evaluation_counts_as_miss():
    gold, evals, records = setup()
    del evals["b"]
    rep = report(compare(gold, evals, records, CHECKLIST, "tune"), CHECKLIST, show_holdout=False)
    assert rep["tune"]["agreement"] == 7 / 16 and rep["tune"]["not_evaluated"] == 1


def test_results_file_gives_same_numbers_as_evaluations(tmp_path):
    """Замер по файлу сдачи из git совпадает с замером по папкам оценок, ошибка оценки остаётся промахом."""
    gold, evals, records = setup()
    evals["b"] = {"conversation_id": "b", "error": "модель не ответила"}
    recs = [{**records[k], "transcript": [{"timestamp": "00:00", "speaker": "operator", "text": "Здравствуйте"}]} for k in "abh"]
    for e in evals.values():
        for c in e.get("criteria", []):
            c.update(explanation="Пересказ оценки.", evidence=[{"turn": 0, "quote": "Здравствуйте"}])
    doc, _ = build_results(recs, evals, CHECKLIST, team_name="Тест")
    write_json(doc, tmp_path / "results.json")
    from_file = evaluations_from_results(tmp_path / "results.json", CHECKLIST)
    a = report(compare(gold, evals, records, CHECKLIST, "all"), CHECKLIST, show_holdout=True)
    b = report(compare(gold, from_file, records, CHECKLIST, "all"), CHECKLIST, show_holdout=True)
    assert a == b and b["tune"]["not_evaluated"] == 1 and b["holdout"]["agreement"] == 7 / 8
