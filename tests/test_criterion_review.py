"""Совет по формулировке критерия. Модель подменена: платных вызовов и сети нет."""

import json
from pathlib import Path

import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from app.server import criterion_review as cr  # noqa: E402
from app.server.main import create_app  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
CHECKLIST = json.loads((ROOT / "app/checklists/freedom_chat_v1.json").read_text(encoding="utf-8"))
NEW = {"id": "c09", "title": "Следующий шаг", "description": "Оператор качественно объяснил клиенту следующий шаг.",
       "answer_type": "binary", "weight": 5, "na_allowed": True, "na_rule": "", "notes": None, "gross_error": False}


class FakeProvider:
    def __init__(self, answer):
        self.answer = answer
        self.calls = []

    def complete(self, system, user, schema):
        self.calls.append((system, user, schema))
        return self.answer, {"model": "fake", "cost_usd": 0.01, "seconds": 1.5}


def test_prompt_has_criterion_and_neighbours_as_data():
    p = FakeProvider({"verdict": "improve", "summary": "s", "issues": [], "suggestion": {}})
    cr.review_criterion(NEW, CHECKLIST, p, "en")
    system, user, schema = p.calls[0]
    assert "английском" in system
    assert "<criterion>" in user and "Следующий шаг" in user
    assert "Установление контакта" in user  # соседние критерии для проверки повторов
    assert schema is cr.REVIEW_SCHEMA


def test_schema_size_does_not_depend_on_checklist():
    """Ловушка из AGENTS.md: схема не должна расти с числом критериев."""
    assert "c01" not in json.dumps(cr.REVIEW_SCHEMA)


def test_normalize_keeps_unknown_values_out():
    raw = {"verdict": "great", "summary": "ok", "issues": [{"field": "zzz", "problem": "p", "fix": "f"}, "bad", {"problem": ""}],
           "suggestion": {"title": "", "description": "Новое правило", "na_rule": "Когда шага нет", "notes": "x"}}
    out = cr.normalize(raw, {**cr.clean_criterion(NEW), "na_allowed": False})
    assert out["verdict"] == "improve"
    assert out["issues"] == [{"field": "description", "problem": "p", "fix": "f"}]
    assert out["suggestion"]["title"] == "Следующий шаг"  # пустое поле модели не стирает текст пользователя
    assert out["suggestion"]["na_rule"] == ""  # N/A запрещён — условие не предлагаем


def test_empty_criterion_is_rejected():
    with pytest.raises(cr.ReviewError):
        cr.clean_criterion({"title": " ", "description": ""})


def test_rule_review_finds_obvious_problems():
    out = cr.rule_review(NEW, CHECKLIST)
    fields = [i["field"] for i in out["issues"]]
    assert "na_rule" in fields and "description" in fields
    assert out["verdict"] == "improve" and out["model"] == "mock"


@pytest.fixture
def client(tmp_path):
    app = create_app(db_path=tmp_path / "cqa.sqlite3", provider="mock", web_dir=False, data_dir=tmp_path / "raw", env_file=None)
    with TestClient(app) as c:
        yield c


def test_route_in_test_mode(client):
    r = client.post("/api/checklists/review-criterion", json={"criterion": NEW, "checklist": CHECKLIST, "locale": "kk"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) >= {"verdict", "summary", "issues", "suggestion", "model"}
    # совет ничего не сохраняет
    assert client.get("/api/checklists/freedom-chat").json()["version"] == 1


def test_route_rejects_empty_and_foreign_origin(client):
    assert client.post("/api/checklists/review-criterion", json={"criterion": {"title": ""}}).status_code == 400
    r = client.post("/api/checklists/review-criterion", json={"criterion": NEW}, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403


def test_route_model_failure_is_reported(tmp_path, monkeypatch):
    class Broken:
        def __init__(self, **kw):
            pass

        def complete(self, *a):
            raise RuntimeError("network down sk-secret")

    import app.server.main as main
    monkeypatch.setattr(main, "AnthropicProvider", Broken)
    app = create_app(db_path=tmp_path / "cqa.sqlite3", provider="anthropic", web_dir=False, data_dir=tmp_path / "raw", env_file=None)
    with TestClient(app) as c:
        r = c.post("/api/checklists/review-criterion", json={"criterion": NEW})
    assert r.status_code == 502
    assert "sk-secret" not in r.text
