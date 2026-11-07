"""Страница разметки без браузера: выбор диалогов, проверка ответов, сервер. Диалоги выдуманы."""

import http.client
import json
import threading
from pathlib import Path

import pytest

from app.razmetka.gold import clean_label, is_complete, load_gold, save_gold
from app.razmetka.server import Labeling, make_server
from app.razmetka.split import choose_split
from app.scoring import ScoringError

ROOT = Path(__file__).resolve().parents[1]
CHECKLIST = json.loads((ROOT / "app/checklists/freedom_chat_v1.json").read_text(encoding="utf-8"))
FULL = {"c01": "yes", "c02": "na", "c03": "na", "c04": 20, "c05": "yes", "c06": 10, "c07": "yes", "c08": "no"}


def fake_records():
    groups = [("voice call", "RU", 5), ("agent chat", "RU", 30), ("agent chat", "KZ", 15), ("agent chat", "EN", 15)]
    out = []
    for channel, lang, n in groups:
        for k in range(n):
            cid = f"t-{channel[0]}-{lang.lower()}-{k:03d}"
            out.append({
                "conversation_id": cid, "channel": channel, "language": lang, "audio_url": None,
                "transcript": [
                    {"timestamp": "00:00", "speaker": "client", "text": f"секретный вопрос {cid}"},
                    {"timestamp": "00:05", "speaker": "operator", "text": f"секретный ответ {cid}"},
                ],
            })
    return out


def test_split_sizes_and_strata():
    recs = fake_records()
    split = choose_split(recs)
    assert len(split["holdout"]) == 10 and len(split["tune"]) == 20
    assert not set(split["holdout"]) & set(split["tune"])
    by_id = {r["conversation_id"]: r for r in recs}
    calls = [c for c in split["holdout"] + split["tune"] if by_id[c]["channel"] == "voice call"]
    assert len(calls) == 5
    assert sum(by_id[c]["channel"] == "voice call" for c in split["holdout"]) == 2
    assert [by_id[c]["language"] for c in split["holdout"]].count("KZ") == 2


def test_split_is_reproducible_and_depends_on_seed():
    recs = fake_records()
    assert choose_split(recs) == choose_split(list(reversed(recs)))
    assert choose_split(recs, seed=1) != choose_split(recs, seed=42)


def test_split_takes_what_exists_in_small_group():
    recs = [r for r in fake_records() if r["channel"] == "voice call"][:3]
    split = choose_split(recs)
    assert len(split["holdout"]) == 2 and len(split["tune"]) == 1


def test_clean_label_partial_and_ordered():
    lab = clean_label(CHECKLIST, {"answers": {"c06": "7", "c01": "YES"}, "unsure": ["c06", "c01"]})
    assert lab["answers"] == {"c01": "yes", "c06": 7}
    assert lab["unsure"] == ["c01", "c06"] and lab["draft"] == "none"
    assert not is_complete(CHECKLIST, lab)
    assert is_complete(CHECKLIST, clean_label(CHECKLIST, {"answers": FULL}))


@pytest.mark.parametrize(
    "body",
    [
        {"answers": {"c99": "yes"}},
        {"answers": {"c01": "na"}},
        {"answers": {"c04": 12}},
        {"answers": {}, "unsure": ["c99"]},
        {"answers": {}, "draft": "кто-то"},
        {"answers": ["c01"]},
    ],
)
def test_clean_label_rejects(body):
    with pytest.raises(ScoringError):
        clean_label(CHECKLIST, body)


def test_save_gold_roundtrip_leaves_no_temp_files(tmp_path):
    path = tmp_path / "reports" / "gold.json"
    save_gold(path, {"labels": {"x": {"answers": {"c01": "yes"}}}})
    save_gold(path, {"labels": {"x": {"answers": {"c01": "no"}}}})
    assert load_gold(path)["labels"]["x"]["answers"]["c01"] == "no"
    assert [p.name for p in path.parent.iterdir()] == ["gold.json"]


@pytest.fixture
def server(tmp_path):
    app = Labeling(fake_records(), CHECKLIST, tmp_path / "gold.json")
    srv = make_server(app, port=0)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    yield srv, app, tmp_path / "gold.json"
    srv.shutdown()
    srv.server_close()


def request(srv, method, path, body=None, headers=None):
    port = srv.server_address[1]
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    hdrs = {"Host": f"127.0.0.1:{port}"}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        hdrs["Content-Type"] = "application/json"
    hdrs.update(headers or {})
    conn.request(method, path, body=data, headers=hdrs)
    resp = conn.getresponse()
    raw = resp.read()
    conn.close()
    return resp.status, raw


def test_state_lists_holdout_first(server):
    srv, app, _ = server
    status, raw = request(srv, "GET", "/api/state")
    st = json.loads(raw)
    assert status == 200 and len(st["dialogs"]) == 30
    assert [d["part"] for d in st["dialogs"]] == ["holdout"] * 10 + ["tune"] * 20
    assert st["dialogs"][0]["turns"][0]["i"] == 0


def test_page_is_served(server):
    srv, _, _ = server
    status, raw = request(srv, "GET", "/")
    assert status == 200 and "Разметка эталона" in raw.decode("utf-8")


def test_save_label_writes_gold_without_dialog_text(server):
    srv, app, gold_path = server
    cid = app.gold["split"]["holdout"][0]
    status, raw = request(srv, "POST", f"/api/labels/{cid}", {"answers": FULL, "unsure": ["c04"]})
    out = json.loads(raw)
    assert status == 200 and out["complete"] is True and out["score"]["total"] == 100.0
    text = gold_path.read_text(encoding="utf-8")
    assert json.loads(text)["labels"][cid]["answers"]["c04"] == 20
    assert "секретный" not in text


def test_bad_answer_is_rejected(server):
    srv, app, _ = server
    cid = app.gold["split"]["tune"][0]
    status, raw = request(srv, "POST", f"/api/labels/{cid}", {"answers": {"c01": "na"}})
    assert status == 400 and "N/A" in json.loads(raw)["error"]


def test_unknown_dialog_is_404(server):
    srv, _, _ = server
    status, _ = request(srv, "POST", "/api/labels/not-in-split", {"answers": {}})
    assert status == 404


@pytest.mark.parametrize(
    "headers, expected",
    [
        ({"Host": "evil.example:80"}, 403),
        ({"Origin": "http://evil.example"}, 403),
        ({"Content-Type": "text/plain"}, 415),
    ],
)
def test_foreign_requests_are_refused(server, headers, expected):
    srv, app, gold_path = server
    cid = app.gold["split"]["holdout"][0]
    status, _ = request(srv, "POST", f"/api/labels/{cid}", {"answers": FULL}, headers)
    assert status == expected
    assert cid not in load_gold(gold_path)["labels"]


def test_score_endpoint(server):
    srv, _, _ = server
    status, raw = request(srv, "POST", "/api/score", {"answers": {**FULL, "c08": "yes"}})
    sc = json.loads(raw)
    assert status == 200 and sc["gross_error"] is True and sc["total"] == 100.0


def test_existing_gold_is_kept_on_restart(tmp_path):
    first = Labeling(fake_records(), CHECKLIST, tmp_path / "gold.json")
    cid = first.gold["split"]["holdout"][0]
    first.save_label(cid, {"answers": {"c01": "yes"}})
    again = Labeling(fake_records(), CHECKLIST, tmp_path / "gold.json", seed=7)
    assert again.gold["split"] == first.gold["split"]
    assert again.gold["labels"][cid]["answers"] == {"c01": "yes"}
