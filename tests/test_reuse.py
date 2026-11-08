"""Переоценка после смены версии: модель проверяет только новые и изменённые критерии. Без сети."""

import copy
import json
from pathlib import Path

import pytest

from app.evaluator import reuse
from app.evaluator.evaluate import evaluate_dialog
from app.evaluator.providers import MockProvider

ROOT = Path(__file__).resolve().parents[1]
V1 = json.loads((ROOT / "app/checklists/freedom_chat_v1.json").read_text(encoding="utf-8"))
NEW = {"id": "c09", "section_id": "s3", "title": "Следующий шаг", "description": "Оператор назвал клиенту следующий шаг.",
       "answer_type": "binary", "scale": None, "weight": 5, "na_allowed": False, "na_rule": None, "notes": None, "gross_error": False}
RECORD = {"conversation_id": "r-1", "channel": "agent chat", "language": "RU", "transcript": [
    {"timestamp": "00:00", "speaker": "client", "text": "Где посмотреть тариф?"},
    {"timestamp": "01:00", "speaker": "operator", "text": "Здравствуйте, меня зовут Ирина. Тариф в разделе «Кабинет»."},
    {"timestamp": "01:40", "speaker": "operator", "text": "Рада помочь! Хорошего дня."}]}


def version(base, n, change):
    cl = copy.deepcopy(base)
    cl["version"] = n
    change(cl)
    return cl


class CountingMock(MockProvider):
    def __init__(self):
        super().__init__()
        self.asked = []

    def complete(self, system, user, schema):
        self.asked.append([c["id"] for c in self.checklist["criteria"]])
        return super().complete(system, user, schema)


@pytest.fixture
def first():
    return evaluate_dialog(RECORD, V1, MockProvider())


def test_new_criterion_only_goes_to_model(first):
    v2 = version(V1, 2, lambda cl: cl["criteria"].append(NEW))
    p = CountingMock()
    out = reuse.evaluate_with_reuse(RECORD, v2, p, first, V1, "ev-1")
    assert p.asked == [["c09"]]
    assert [c["criterion_id"] for c in out["criteria"]] == [c["id"] for c in v2["criteria"]]
    assert out["evaluated_criteria"] == ["c09"] and len(out["reused_criteria"]) == 8
    assert all(c.get("reused_from") == "ev-1" for c in out["criteria"][:8])
    assert out["criteria"][0]["explanation"] == first["criteria"][0]["explanation"]


def test_weight_change_and_removal_need_no_model(first):
    def change(cl):
        cl["criteria"] = [c for c in cl["criteria"] if c["id"] != "c05"]
        cl["criteria"][0]["weight"] = 25
        cl["criteria"][1]["section_id"] = "s3"
    v2 = version(V1, 2, change)
    p = CountingMock()
    out = reuse.evaluate_with_reuse(RECORD, v2, p, first, V1, "ev-1")
    assert p.asked == [] and out["calls"] == [] and out["cost_usd"] == 0.0
    assert "c05" not in {c["criterion_id"] for c in out["criteria"]}


def test_changed_wording_is_asked_again(first):
    v2 = version(V1, 2, lambda cl: cl["criteria"][3].update(description=cl["criteria"][3]["description"] + " Уточнение."))
    p = CountingMock()
    reuse.evaluate_with_reuse(RECORD, v2, p, first, V1, "ev-1")
    assert p.asked == [[V1["criteria"][3]["id"]]]


def test_answer_marked_for_review_is_not_reused(first):
    prev = copy.deepcopy(first)
    prev["criteria"][2]["needs_review"] = True
    v2 = version(V1, 2, lambda cl: None)
    p = CountingMock()
    reuse.evaluate_with_reuse(RECORD, v2, p, prev, V1, "ev-1")
    assert p.asked == [[V1["criteria"][2]["id"]]]


def test_empty_and_missing_text_are_the_same():
    a = {"title": "T", "notes": None, "na_rule": ""}
    b = {"title": "T ", "notes": "", "na_rule": None}
    assert reuse.same_meaning(a, b)


# --- через сервер -------------------------------------------------------------

fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from app.server.main import create_app  # noqa: E402
from test_server import chat, upload, wait_job  # noqa: E402


@pytest.fixture
def client(tmp_path):
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<!doctype html><title>CQA</title>", encoding="utf-8")
    app = create_app(db_path=tmp_path / "cqa.sqlite3", provider="mock", web_dir=web, data_dir=tmp_path / "raw", env_file=None)
    with TestClient(app) as c:
        yield c


def run(c, ids, reuse_flag=None):
    body = {"conversation_ids": ids, "checklist_id": "freedom-chat"}
    if reuse_flag is not None:
        body["reuse"] = reuse_flag
    r = c.post("/api/evaluations", json=body)
    assert r.status_code == 200, r.text
    job = wait_job(c, r.json()["id"])
    return c.get(f"/api/evaluations/{job['evaluation_ids'][0]}").json(), c.get(f"/api/dialogs/{ids[0]}/evaluations").json()


def test_server_reuses_only_when_asked(client):
    upload(client, [chat("t-1")])
    run(client, ["t-1"])
    cl = copy.deepcopy(V1)
    cl["criteria"].append(NEW)
    assert client.post("/api/checklists", json=cl).json()["version"] == 2
    view, history = run(client, ["t-1"], reuse_flag=True)
    assert view["checklist_version"] == 2 and len(view["criteria"]) == 9
    store = client.app.state.store
    result = store.get_evaluation(history[0]["id"])["result"]
    assert result["evaluated_criteria"] == ["c09"] and result["reused_from"] == history[1]["id"]
    # обычная «Оценить» по той же версии — полная оценка, без переиспользования
    _, history = run(client, ["t-1"])
    assert "reused_from" not in store.get_evaluation(history[0]["id"])["result"]


def test_interface_files_are_revalidated(client):
    assert client.get("/").headers.get("cache-control") == "no-cache"
    assert "no-cache" not in (client.get("/api/health").headers.get("cache-control") or "")


def test_price_forecast_ignores_partial_reevaluations(tmp_path):
    from app.server.store import Store
    st = Store(tmp_path / "db.sqlite3")
    st.seed_checklist(V1)
    st.create_job("j", V1, [("e1", "a"), ("e2", "b")])
    st.finish_evaluation("e1", "j", {"provider": "anthropic", "cost_usd": 0.04, "calls": [{"seconds": 10}], "criteria": []})
    st.finish_evaluation("e2", "j", {"provider": "anthropic", "cost_usd": 0.0, "calls": [], "criteria": [], "reused_from": "e1"})
    assert st.evaluation_stats()["based_on"] == 1
