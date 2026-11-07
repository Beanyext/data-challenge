"""Подсчёт итога на проверочных примерах из reports/чек-лист.md."""

import copy
import json
from fractions import Fraction
from pathlib import Path

import pytest

from app.scoring import ScoringError, apply_decisions, compute, normalize_answer, round_half_up, score

ROOT = Path(__file__).resolve().parents[1]
CHECKLIST = json.loads((ROOT / "app/checklists/freedom_chat_v1.json").read_text(encoding="utf-8"))
CRIT = {c["id"]: c for c in CHECKLIST["criteria"]}

A = {"c01": "yes", "c02": "yes", "c03": "yes", "c04": 20, "c05": "yes", "c06": 10, "c07": "yes", "c08": "no"}
B = {**A, "c02": "na"}
C = {"c01": "yes", "c02": "yes", "c03": "na", "c04": 15, "c05": "yes", "c06": 7, "c07": "no", "c08": "no"}
D = {**C, "c04": 10}
E = {"c01": "no", "c02": "na", "c03": "na", "c04": "na", "c05": "no", "c06": 0, "c07": "na", "c08": "no"}
F = {**A, "c08": "yes"}


@pytest.mark.parametrize(
    "answers, points, weights, total",
    [
        (A, 100, 100, 100.00),
        (B, 85, 85, 100.00),
        (C, 65.5, 80, 81.88),
        (D, 60.5, 80, 75.63),
        (E, 0, 40, 0.00),
        (F, 100, 100, 100.00),
    ],
    ids=["A", "B", "C", "D", "E", "F"],
)
def test_examples(answers, points, weights, total):
    r = score(CHECKLIST, answers)
    assert (r["points"], r["weight_sum"], r["total"]) == (points, weights, total)
    assert r["complete"] and not r["missing"]


def test_gross_error_marked_separately():
    assert score(CHECKLIST, F)["gross_error"] is True
    assert score(CHECKLIST, A)["gross_error"] is False


def test_appeal_changes_total_example_g():
    final = apply_decisions(C, [{"criterion_id": "c07", "answer": "yes"}])
    r = score(CHECKLIST, final)
    assert (r["points"], r["weight_sum"], r["total"]) == (70.5, 80, 88.13)
    assert C["c07"] == "no", "исходные ответы не меняются"


def test_confirmed_decision_keeps_answer():
    assert apply_decisions(C, [{"criterion_id": "c07", "answer": None}]) == C


def test_sections_example_c_exact():
    sections = {s["id"]: s for s in compute(CHECKLIST, C)["sections"]}
    assert (sections["s1"]["score"], sections["s1"]["max"]) == (Fraction("31.25"), Fraction("31.25"))
    assert (sections["s2"]["score"], sections["s2"]["max"]) == (Fraction("18.75"), Fraction(25))
    assert (sections["s3"]["score"], sections["s3"]["max"]) == (Fraction("31.875"), Fraction("43.75"))
    assert sections["s4"]["score"] is None and sections["s4"]["gross_error"] is False
    assert sum(sections[s]["score"] for s in ("s1", "s2", "s3")) == compute(CHECKLIST, C)["total"]


def test_effective_weights_example_c():
    rows = {c["criterion_id"]: c for c in score(CHECKLIST, C)["criteria"]}
    assert rows["c01"]["effective_weight"] == 12.5
    assert rows["c06"]["points"] == 10.5 and rows["c06"]["score"] == 13.13
    assert rows["c03"]["applicable"] is False and rows["c03"]["effective_weight"] is None
    assert rows["c08"]["gross_error"] is True and rows["c08"]["score"] is None


def test_half_rounds_up_unlike_builtin_round():
    assert round(75.625, 2) == 75.62
    assert round_half_up(Fraction("75.625")) == 75.63


def test_no_applicable_weighted_criteria_gives_no_total():
    checklist = copy.deepcopy(CHECKLIST)
    for c in checklist["criteria"]:
        if not c["gross_error"]:
            c["na_allowed"] = True
    answers = {c["id"]: "na" for c in checklist["criteria"] if not c["gross_error"]} | {"c08": "yes"}
    r = score(checklist, answers)
    assert r["total"] is None and r["gross_error"] is True


def test_single_criterion_checklist():
    checklist = {"id": "one", "version": 1, "sections": [], "criteria": [copy.deepcopy(CRIT["c06"])]}
    assert score(checklist, {"c06": 4})["total"] == 40.0


def test_missing_and_invalid_answers_are_reported_not_raised():
    answers = {**A, "c01": "na", "c04": 12}
    del answers["c05"]
    r = score(CHECKLIST, answers)
    assert r["complete"] is False
    assert sorted(r["missing"]) == ["c01", "c04", "c05"]
    assert set(r["problems"]) == {"c01", "c04"}
    assert r["weight_sum"] == 55  # остались c02, c03, c06, c07: 15 + 20 + 15 + 5


@pytest.mark.parametrize(
    "cid, raw, expected",
    [("c01", "YES", "yes"), ("c02", " na ", "na"), ("c04", "15", 15), ("c04", 15.0, 15), ("c06", 7, 7)],
)
def test_normalize_answer(cid, raw, expected):
    assert normalize_answer(CRIT[cid], raw) == expected


@pytest.mark.parametrize(
    "cid, raw",
    [("c01", "na"), ("c08", "na"), ("c04", 12), ("c06", "много"), ("c01", True), ("c01", 1), ("c04", None)],
)
def test_normalize_answer_rejects(cid, raw):
    with pytest.raises(ScoringError):
        normalize_answer(CRIT[cid], raw)


def test_new_criterion_from_settings_counts_without_code_changes():
    checklist = copy.deepcopy(CHECKLIST)
    checklist["criteria"].append(
        {"id": "c09", "section_id": "s3", "title": "Новый", "description": "", "answer_type": "scale",
         "scale": {"min": 0, "max": 5}, "weight": 20, "na_allowed": False, "gross_error": False}
    )
    r = score(checklist, {**C, "c09": 5})
    assert (r["points"], r["weight_sum"], r["total"]) == (85.5, 100, 85.5)


def test_negative_weight_is_rejected():
    checklist = copy.deepcopy(CHECKLIST)
    checklist["criteria"][0]["weight"] = -5
    with pytest.raises(ScoringError):
        score(checklist, A)
