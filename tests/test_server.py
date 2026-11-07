"""Сервер на тестовом режиме модели (mock) и выдуманных диалогах. Платных вызовов и сети нет."""

import copy
import json
import time
from pathlib import Path

import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from app.server import audio as audio_mod  # noqa: E402
from app.server.main import create_app  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
CHECKLIST = json.loads((ROOT / "app/checklists/freedom_chat_v1.json").read_text(encoding="utf-8"))


def chat(cid, lang="RU"):
    return {
        "conversation_id": cid, "channel": "agent chat", "language": lang, "audio_url": None,
        "transcript": [
            {"timestamp": "00:00", "speaker": "client", "text": "Где посмотреть тариф?"},
            {"timestamp": "00:02", "speaker": "bot", "text": "Здравствуйте! Я бот."},
            {"timestamp": "00:10", "speaker": "system", "text": "Эскалация на оператора."},
            {"timestamp": "01:00", "speaker": "operator", "text": "Здравствуйте, меня зовут Ирина. Тариф в разделе «Кабинет»."},
            {"timestamp": "01:20", "speaker": "client", "text": "Нашёл, спасибо."},
            {"timestamp": "01:40", "speaker": "operator", "text": "Рада помочь! Хорошего дня."},
        ],
    }


def call(cid):
    base = "2026-11-03T13:10:{:02d}.0000000+00:00"
    stamps = [0, 0, 5, 20, 21, 30, 33, 40, 59]
    speakers = ["system", "system", "client", "system", "system", "system", "system", "operator", "client"]
    texts = ["Жазу және транскрипция басталды.", "Bot dialog and transcription languages have been updated.",
             "Алло", "Клиент переведен от агента на представителя службы поддержки",
             "Запись и транскрибирование приостановлены.", "Агент присоединился к разговору с клиентом.",
             "Запись и транскрибирование возобновлены.", "Здравствуйте, меня зовут Ирина.", "Спасибо"]
    return {"conversation_id": cid, "channel": "voice call", "language": "RU",
            "audio_url": "https://audio.example/page?sig=SECRET",
            "transcript": [{"timestamp": base.format(s), "speaker": sp, "text": t} for s, sp, t in zip(stamps, speakers, texts)]}


@pytest.fixture
def client(tmp_path):
    app = create_app(db_path=tmp_path / "cqa.sqlite3", provider="mock", web_dir=False, data_dir=tmp_path / "raw", env_file=None)
    with TestClient(app) as c:
        c.tmp = tmp_path
        yield c


def test_serves_interface_with_module_types(tmp_path, monkeypatch):
    """Интерфейс с того же адреса, что и API. Типы файлов не зависят от реестра Windows."""
    import mimetypes
    web = tmp_path / "web"
    web.mkdir()
    for name, text in (("index.html", "<!doctype html><title>CQA</title>"), ("app.mjs", "export {}"),
                       ("react-ui.js", "void 0"), ("styles.css", "body{}"), ("logo.svg", "<svg/>")):
        (web / name).write_text(text, encoding="utf-8")
    monkeypatch.setitem(mimetypes.types_map, ".js", "text/plain")  # как на машине с испорченным реестром
    monkeypatch.setitem(mimetypes.types_map, ".mjs", "text/plain")
    app = create_app(db_path=tmp_path / "cqa.sqlite3", provider="mock", web_dir=web, data_dir=tmp_path / "raw", env_file=None)
    with TestClient(app) as c:
        assert "CQA" in c.get("/").text
        types = {p: c.get(p).headers["content-type"].split(";")[0] for p in ("/app.mjs", "/react-ui.js", "/styles.css", "/logo.svg")}
        assert types == {"/app.mjs": "text/javascript", "/react-ui.js": "text/javascript", "/styles.css": "text/css", "/logo.svg": "image/svg+xml"}
        assert c.get("/api/health").json()["ok"] is True


def upload(c, doc, name="dialogs.json"):
    return c.post("/api/dialogs/upload", files={"file": (name, json.dumps(doc, ensure_ascii=False).encode("utf-8"), "application/json")})


def wait_job(c, job_id, timeout=10):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = c.get(f"/api/jobs/{job_id}").json()
        if job["status"] in ("completed", "failed"):
            return job
        time.sleep(0.05)
    raise AssertionError("задание не завершилось")


def evaluate(c, ids, checklist_id="freedom-chat"):
    r = c.post("/api/evaluations", json={"conversation_ids": ids, "checklist_id": checklist_id})
    assert r.status_code == 200, r.text
    job = r.json()
    assert set(job) >= {"id", "status", "completed", "total", "evaluation_ids"}
    return wait_job(c, job["id"])


def test_health_and_seeded_checklist(client):
    h = client.get("/api/health").json()
    assert h["ok"] and h["provider"] == "mock" and h["checklists"] == 1
    lists = client.get("/api/checklists").json()
    assert lists[0]["id"] == "freedom-chat" and lists[0]["version"] == 1


def test_upload_formats_and_conflicts(client):
    r = upload(client, {"isSuccess": True, "data": {"records": [chat("t-1"), chat("t-2", "KZ")]}})
    assert r.status_code == 200 and r.json()["imported"] == 2
    assert upload(client, chat("t-1")).json()["same"] == 1
    other = chat("t-1")
    other["transcript"][0]["text"] = "другое"
    assert upload(client, other).status_code == 409
    assert upload(client, [chat("x"), chat("x")]).status_code == 400
    bad = client.post("/api/dialogs/upload", files={"file": ("a.json", b"{not json", "application/json")})
    assert bad.status_code == 400
    assert {d["conversation_id"] for d in client.get("/api/dialogs").json()} == {"t-1", "t-2"}


def test_import_by_group_id(client, monkeypatch):
    doc = {"isSuccess": True, "error": "", "data": {"dataset_group_id": "G1", "records": [chat("g-1"), call("g-2")]}}
    monkeypatch.setattr("app.server.main.data_api.fetch_group", lambda gid: doc)
    r = client.post("/api/dialogs/import", json={"group_id": "G1"})
    assert r.status_code == 200 and r.json()["new"] == 2
    assert (client.tmp / "raw" / "G1.json").exists()
    again = client.post("/api/dialogs/import", json={"group_id": "G1"}).json()
    assert again["same"] == 2 and again["imported"] == 0


def test_import_error_has_no_signature(client, monkeypatch):
    from app.data_api import DataApiError

    def boom(gid):
        raise DataApiError("API организаторов не ответило: HTTP 404")

    monkeypatch.setattr("app.server.main.data_api.fetch_group", boom)
    r = client.post("/api/dialogs/import", json={"group_id": "NOPE"})
    assert r.status_code == 502 and "sig" not in r.text


def test_full_path_evaluate_appeal_decision_new_version(client):
    upload(client, [chat("t-1"), chat("t-2", "EN")])
    job = evaluate(client, ["t-1", "t-2"])
    assert job["status"] == "completed" and job["completed"] == 2 and job["failed"] == 0
    ev_id = job["evaluation_ids"][0]
    ev = client.get(f"/api/evaluations/{ev_id}").json()
    # без решения по апелляции исходного итога нет: интерфейс по нему показывает блок «Пересмотр результата»
    assert ev["status"] == "done" and ev["total"] == 100.0 and ev["original_total"] is None
    assert ev["checklist"]["version"] == 1 and len(ev["criteria"]) == 8
    c06 = next(c for c in ev["criteria"] if c["criterion_id"] == "c06")
    assert c06["points"] == 15.0 and c06["raw_points"] == 15.0 and c06["effective_weight"] == 15.0
    assert c06["evidence"] and c06["evidence"][0]["turn"] == 3
    row = next(d for d in client.get("/api/dialogs").json() if d["conversation_id"] == "t-1")
    assert row["status"] == "evaluated" and row["evaluation_id"] == ev_id and row["total"] == 100.0 and row["original_total"] is None

    ap = client.post("/api/appeals", json={"evaluation_id": ev_id, "criterion_id": "c07", "comment": "Не попрощался"})
    assert ap.status_code == 200
    appeal = ap.json()
    assert appeal["status"] == "open" and appeal["criterion"]["answer"] == "yes" and appeal["fragment"]
    assert client.post("/api/appeals", json={"evaluation_id": ev_id, "criterion_id": "c07", "comment": "ещё"}).status_code == 409
    queue = client.get("/api/appeals", params={"status": "open"}).json()
    assert [a["id"] for a in queue] == [appeal["id"]] and queue[0]["conversation_id"] == "t-1"

    no_reason = client.post(f"/api/appeals/{appeal['id']}/decision", json={"answer": "no", "reason": " "})
    assert no_reason.status_code == 400
    bad = client.post(f"/api/appeals/{appeal['id']}/decision", json={"answer": "может быть", "reason": "x"})
    assert bad.status_code == 400 and "Недопустимый ответ" in bad.json()["detail"]
    assert client.get("/api/appeals", params={"status": "open"}).json()[0]["id"] == appeal["id"]


def test_decision_recomputes_total_and_keeps_original(client):
    upload(client, [chat("t-1")])
    ev_id = evaluate(client, ["t-1"])["evaluation_ids"][0]
    appeal = client.post("/api/appeals", json={"evaluation_id": ev_id, "criterion_id": "c07", "comment": "Не попрощался"}).json()
    r = client.post(f"/api/appeals/{appeal['id']}/decision", json={"answer": "no", "reason": "Прощания нет", "status": "changed"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "changed" and out["decision"]["answer"] == "no"
    ev = out["evaluation"]
    assert ev["original_total"] == 100.0 and ev["total"] == 95.0
    c07 = next(c for c in ev["criteria"] if c["criterion_id"] == "c07")
    assert c07["answer"] == "no" and c07["original_answer"] == "yes" and c07["review_reason"] == "Прощания нет"
    assert client.post(f"/api/appeals/{appeal['id']}/decision", json={"answer": "yes", "reason": "x"}).status_code == 409
    again = client.get(f"/api/evaluations/{ev_id}").json()
    assert again["total"] == 95.0 and again["appeals"][0]["status"] == "changed"


def test_confirm_decision(client):
    upload(client, [chat("t-1")])
    ev_id = evaluate(client, ["t-1"])["evaluation_ids"][0]
    appeal = client.post("/api/appeals", json={"evaluation_id": ev_id, "criterion_id": "c04", "comment": "Мало"}).json()
    out = client.post(f"/api/appeals/{appeal['id']}/decision", json={"status": "confirmed", "reason": "Ответ полный"}).json()
    assert out["status"] == "confirmed" and out["evaluation"]["total"] == 100.0


@pytest.mark.parametrize("decision", [
    {"status": "confirmed", "reason": "Ответ подтверждён"},
    {"status": "changed", "answer": "no", "reason": "Прощания нет"},
    {"status": "changed", "answer": "na", "reason": "Клиент отключился"},
])
def test_original_criteria_snapshot_survives_decision_and_weight_redistribution(client, decision):
    upload(client, [chat("original-snapshot")])
    ev_id = evaluate(client, ["original-snapshot"])["evaluation_ids"][0]
    before = client.get(f"/api/evaluations/{ev_id}").json()
    assert before["original_criteria"] == before["criteria"]
    appeal = client.post("/api/appeals", json={
        "evaluation_id": ev_id, "criterion_id": "c07", "comment": "Проверить завершение",
    }).json()
    response = client.post(f"/api/appeals/{appeal['id']}/decision", json=decision)
    assert response.status_code == 200, response.text
    after = client.get(f"/api/evaluations/{ev_id}").json()
    assert after["original_total"] == before["total"]
    assert after["original_criteria"] == before["criteria"]
    original_c07 = next(c for c in after["original_criteria"] if c["criterion_id"] == "c07")
    assert original_c07["answer"] == "yes" and original_c07["decision"] is None
    assert original_c07["explanation"] and original_c07["evidence"]
    if decision.get("answer") == "na":
        current_c01 = next(c for c in after["criteria"] if c["criterion_id"] == "c01")
        original_c01 = next(c for c in after["original_criteria"] if c["criterion_id"] == "c01")
        assert current_c01["effective_weight"] != original_c01["effective_weight"]
        assert original_c01["effective_weight"] == 10.0


def test_scale_decision_and_invalid_answer(client):
    upload(client, [chat("t-1")])
    ev_id = evaluate(client, ["t-1"])["evaluation_ids"][0]
    appeal = client.post("/api/appeals", json={"evaluation_id": ev_id, "criterion_id": "c06", "comment": "Сбой"}).json()
    assert client.post(f"/api/appeals/{appeal['id']}/decision", json={"answer": 5, "reason": "x"}).status_code == 400
    out = client.post(f"/api/appeals/{appeal['id']}/decision", json={"answer": "7", "reason": "Один сбой"}).json()
    c06 = next(c for c in out["evaluation"]["criteria"] if c["criterion_id"] == "c06")
    assert c06["answer"] == 7 and c06["raw_points"] == 10.5 and out["evaluation"]["total"] == 95.5


def test_new_checklist_version_and_reevaluation(client):
    upload(client, [chat("t-1")])
    first = evaluate(client, ["t-1"])["evaluation_ids"][0]
    cl = copy.deepcopy(CHECKLIST)
    cl["criteria"] = [c for c in cl["criteria"] if c["id"] != "c05"]
    cl["criteria"].append({"id": "c09", "code": "understanding", "section_id": "s3", "title": "Проверка понимания",
                           "description": "Оператор убедился, что клиент понял.", "answer_type": "scale",
                           "scale": {"min": 0, "max": 3}, "weight": 15, "na_allowed": False, "gross_error": False})
    saved = client.post("/api/checklists", json=cl)
    assert saved.status_code == 200 and saved.json()["version"] == 2
    second = evaluate(client, ["t-1"])["evaluation_ids"][0]
    ev2 = client.get(f"/api/evaluations/{second}").json()
    assert ev2["checklist_version"] == 2 and "c09" in {c["criterion_id"] for c in ev2["criteria"]}
    ev1 = client.get(f"/api/evaluations/{first}").json()
    assert ev1["checklist_version"] == 1 and "c05" in {c["criterion_id"] for c in ev1["criteria"]}
    history = client.get("/api/dialogs/t-1/evaluations").json()
    assert [h["checklist_version"] for h in history] == [2, 1]
    assert [v["version"] for v in client.get("/api/checklists/freedom-chat/versions").json()] == [1, 2]
    assert client.get("/api/checklists/freedom-chat", params={"version": 1}).json()["version"] == 1


@pytest.mark.parametrize(
    "mutate, message",
    [
        (lambda cl: cl["criteria"].append(copy.deepcopy(cl["criteria"][0])), "повторяется"),
        (lambda cl: cl["criteria"][7].update(weight=5), "нулевой вес"),
        (lambda cl: cl["criteria"][3]["scale"]["steps"].append({"value": 99, "label": ""}), "в пределах"),
        (lambda cl: cl["criteria"][0].update(section_id="s9"), "секций"),
        (lambda cl: cl["criteria"][1].update(code="contact"), "код contact"),
        (lambda cl: cl["criteria"][0].update(weight=-1), "не меньше нуля"),
        (lambda cl: cl.update(criteria=[]), "хотя бы один"),
        (lambda cl: cl["criteria"][1].update(na_rule=""), "N/A"),
    ],
)
def test_checklist_validation(client, mutate, message):
    cl = copy.deepcopy(CHECKLIST)
    mutate(cl)
    r = client.post("/api/checklists", json=cl)
    assert r.status_code == 400 and message in r.json()["detail"]


def test_filters(client):
    upload(client, [chat("t-1"), chat("t-2", "KZ"), call("c-1")])
    evaluate(client, ["t-1"])
    assert [d["conversation_id"] for d in client.get("/api/dialogs", params={"language": "kz"}).json()] == ["t-2"]
    assert [d["conversation_id"] for d in client.get("/api/dialogs", params={"channel": "voice call"}).json()] == ["c-1"]
    assert [d["conversation_id"] for d in client.get("/api/dialogs", params={"status": "evaluated"}).json()] == ["t-1"]
    assert client.get("/api/dialogs", params={"gross_error": "true"}).json() == []


def test_dialog_hides_signed_audio_url(client):
    upload(client, [call("c-1")])
    d = client.get("/api/dialogs/c-1").json()
    assert "audio_url" not in d and d["has_audio"] is True and "SECRET" not in json.dumps(d)
    assert "SECRET" not in client.get("/api/dialogs").text


def test_audio_offsets_skip_pause():
    off = audio_mod.turn_offsets(call("c-1")["transcript"])
    # запись с 0 с, пауза с 21 по 33 с: реплика оператора на 40 с играет на 28 с
    assert off["0"] == 0.0 and off["4"] == 21.0 and off["5"] == 21.0 and off["7"] == 28.0 and off["8"] == 47.0
    assert audio_mod.turn_offsets(chat("t")["transcript"]) == {}


def test_audio_endpoint(client, monkeypatch):
    upload(client, [call("c-1"), chat("t-1")])
    monkeypatch.setattr(audio_mod, "fresh_audio_url", lambda page: "https://files.example/rec.mp3?t=1")
    a = client.get("/api/dialogs/c-1/audio").json()
    assert a["url"].endswith("rec.mp3?t=1") and a["turn_offsets"]["7"] == 28.0 and "SECRET" not in json.dumps(a)
    assert client.get("/api/dialogs/t-1/audio").status_code == 404


def test_audio_page_parsing(monkeypatch):
    import io

    class Resp(io.BytesIO):
        headers = type("H", (), {"get_content_type": staticmethod(lambda: "text/html")})()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    page = b'<html><audio controls><source src="https://cdn.example/a.mp3?x=1&amp;y=2" type="audio/mpeg"></audio></html>'
    monkeypatch.setattr(audio_mod.urllib.request, "urlopen", lambda req, timeout=None: Resp(page))
    assert audio_mod.fresh_audio_url("https://p.example/page") == "https://cdn.example/a.mp3?x=1&y=2"


def test_security_guards(client):
    assert client.post("/api/checklists", content=json.dumps(CHECKLIST), headers={"Content-Type": "text/plain"}).status_code == 415
    assert client.post("/api/checklists", json=CHECKLIST, headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.get("/api/health", headers={"Host": "evil.example"}).status_code == 400
    assert client.post("/api/checklists", json=CHECKLIST, headers={"Origin": "http://testserver"}).status_code == 200


def test_restart_keeps_data_and_closes_pending(tmp_path):
    db = tmp_path / "cqa.sqlite3"
    app = create_app(db_path=db, provider="mock", web_dir=False, data_dir=tmp_path, env_file=None)
    with TestClient(app) as c:
        upload(c, [chat("t-1")])
        ev_id = evaluate(c, ["t-1"])["evaluation_ids"][0]
        app.state.store.create_job("job-x", app.state.store.get_checklist("freedom-chat"), [("ev-x", "t-1")])
    app2 = create_app(db_path=db, provider="mock", web_dir=False, data_dir=tmp_path, env_file=None)
    with TestClient(app2) as c:
        assert c.get(f"/api/evaluations/{ev_id}").json()["total"] == 100.0
        assert c.get("/api/evaluations/ev-x").json()["status"] == "error"
        assert c.get("/api/jobs/job-x").json()["status"] == "failed"


def test_summary(client):
    upload(client, [chat("t-1"), chat("t-2", "EN")])
    evaluate(client, ["t-1", "t-2"])
    s = client.get("/api/summary").json()
    assert s["evaluated_dialogs"] == 2 and s["average_total"]["all"] == 100.0 and s["average_total"]["language:EN"] == 100.0


def test_unknown_things_are_404(client):
    assert client.get("/api/dialogs/nope").status_code == 404
    assert client.get("/api/evaluations/nope").status_code == 404
    assert client.get("/api/jobs/nope").status_code == 404
    assert client.post("/api/evaluations", json={"conversation_ids": ["nope"], "checklist_id": "freedom-chat"}).status_code == 404
    assert client.post("/api/evaluations", json={"conversation_ids": [], "checklist_id": "freedom-chat"}).status_code == 400


# --- поля для интерфейса: номера реплик, краткая причина, время звонка, цена оценки ---

from app.server.views import human_turns, short_reason  # noqa: E402


def test_turn_numbers_follow_transcript_and_short_reason():
    assert human_turns("Основание — реплики [0], [9] и [11].") == "Основание — реплики [1], [10] и [12]."
    assert human_turns(None) is None
    text = "Выявление потребности — Нет. Клиент просил помочь с выбором облигаций, но оператор ничего не уточнил. Основание — реплики [9] и [11]."
    assert short_reason(text, "Выявление потребности") == "Клиент просил помочь с выбором облигаций, но оператор ничего не уточнил."
    # без вступления «Критерий — ответ.» берётся первая фраза; короткая дополняется второй
    assert short_reason("Да. Оператор поздоровался по имени клиента [2].", "Установление контакта") == "Да. Оператор поздоровался по имени клиента [3]."
    assert short_reason("Основание — реплика [4].", "Завершение") == "Основание — реплика [5]."


def _finished(c, cid, answers, explanation, provider="anthropic", cost=0.05, seconds=20.0):
    store = c.app.state.store
    checklist = store.get_checklist("freedom-chat", 1)
    ev_id, job_id = f"ev-{cid}", f"job-{cid}"
    store.create_job(job_id, checklist, [(ev_id, cid)])
    store.finish_evaluation(ev_id, job_id, {
        "conversation_id": cid, "provider": provider, "model": "claude-opus-5-5", "cost_usd": cost,
        "calls": [{"model": "claude-opus-5-5", "seconds": seconds, "cost_usd": cost}],
        "criteria": [{"criterion_id": k, "answer": v, "explanation": explanation(k), "evidence": [{"turn": 3, "quote": "x"}],
                      "checked_range": None, "na_reason": None} for k, v in answers.items()],
    })
    return ev_id


def test_gross_error_reason_and_explanations_in_views(client):
    upload(client, [chat("g-1")])
    answers = {"c01": "yes", "c02": "na", "c03": "na", "c04": 15, "c05": "yes", "c06": 7, "c07": "yes", "c08": "yes"}
    titles = {c["id"]: c["title"] for c in CHECKLIST["criteria"]}
    ev_id = _finished(client, "g-1", answers,
                      lambda k: f"{titles[k]} — Да. Оператор предложил перевести деньги ему лично. Основание — реплика [3]." if k == "c08"
                      else f"{titles[k]} — ответ. Пояснение по критерию со ссылкой [3]. Основание — реплика [3].")
    ev = client.get(f"/api/evaluations/{ev_id}").json()
    c08 = next(c for c in ev["criteria"] if c["criterion_id"] == "c08")
    assert c08["explanation"].endswith("реплика [4].") and c08["reason"] == "Оператор предложил перевести деньги ему лично."
    row = next(r for r in client.get("/api/dialogs").json() if r["conversation_id"] == "g-1")
    assert row["gross_error"] is True and row["gross_error_reason"] == "Оператор предложил перевести деньги ему лично."
    appeal = client.post("/api/appeals", json={"evaluation_id": ev_id, "criterion_id": "c04", "comment": "Спорно"}).json()
    assert appeal["criterion"]["explanation"].endswith("[4].") and all("display_time" in t for t in appeal["fragment"])


def test_call_has_readable_times_and_duration(client):
    upload(client, [call("v-1"), chat("c-1")])
    d = client.get("/api/dialogs/v-1").json()
    assert [t["display_time"] for t in d["transcript"]][:4] == ["00:00", "00:00", "00:05", "00:20"]
    assert d["transcript"][0]["timestamp"].startswith("2026-11-03T13:10:00")  # исходное время не теряется
    assert d["duration_seconds"] == 59
    rows = {r["conversation_id"]: r for r in client.get("/api/dialogs").json()}
    assert rows["v-1"]["duration_seconds"] == 59 and "duration_seconds" in rows["c-1"]


def test_health_estimate_ignores_mock(client):
    est = client.get("/api/health").json()["estimate"]
    assert est["cost_per_dialog_usd"] is None and est["based_on"] == 0 and est["workers"] >= 1
    upload(client, [chat("e-1"), chat("e-2"), chat("e-3")])
    evaluate(client, ["e-3"])  # тестовый режим не влияет на оценку цены
    base = {"c01": "yes", "c02": "na", "c03": "na", "c04": 15, "c05": "yes", "c06": 7, "c07": "yes", "c08": "no"}
    _finished(client, "e-1", base, lambda k: "x", cost=0.04, seconds=18.0)
    _finished(client, "e-2", base, lambda k: "x", cost=0.06, seconds=22.0)
    est = client.get("/api/health").json()["estimate"]
    assert est == {"based_on": 2, "cost_per_dialog_usd": 0.05, "seconds_per_dialog": 20.0, "workers": est["workers"]}


def test_load_saved_evaluations_without_model(tmp_path):
    """Сохранённые оценки попадают в базу и видны через API; повторная загрузка не дублирует."""
    from app.server.load_evals import load
    from app.server.store import Store
    evals = tmp_path / "evals"
    evals.mkdir()
    base = {"c01": "yes", "c02": "na", "c03": "na", "c04": 15, "c05": "yes", "c06": 7, "c07": "yes", "c08": "no"}
    for cid in ("l-1", "l-2"):
        (evals / f"{cid}.json").write_text(json.dumps({
            "conversation_id": cid, "checklist_id": "freedom-chat", "checklist_version": 1, "provider": "anthropic",
            "model": "claude-opus-5-5", "cost_usd": 0.05, "calls": [{"seconds": 20}],
            "criteria": [{"criterion_id": k, "answer": v, "explanation": "Пояснение [2].", "evidence": [], "checked_range": None,
                          "na_reason": None} for k, v in base.items()]}, ensure_ascii=False), encoding="utf-8")
    (evals / "l-3.json").write_text(json.dumps({"conversation_id": "l-3", "error": "сбой"}), encoding="utf-8")
    (evals / "summary.json").write_text("{}", encoding="utf-8")
    db = tmp_path / "cqa.sqlite3"
    stats = load(Store(db), evals, [chat("l-1"), chat("l-2")])
    assert stats == {"loaded": 2, "skipped_existing": 0, "no_dialog": 0, "errors": 1, "unknown_checklist": 0}
    assert load(Store(db), evals)["skipped_existing"] == 2
    app = create_app(db_path=db, provider="mock", web_dir=False, data_dir=tmp_path, env_file=None)
    with TestClient(app) as c:
        rows = {r["conversation_id"]: r for r in c.get("/api/dialogs").json()}
        assert rows["l-1"]["status"] == "evaluated" and rows["l-1"]["total"] is not None
        assert c.get("/api/health").json()["estimate"]["cost_per_dialog_usd"] == 0.05
