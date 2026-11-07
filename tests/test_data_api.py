"""Загрузка набора по group_id без сети: адрес, проверка ответа, ошибки без подписи в тексте."""

import io
import json
import urllib.error

import pytest

from app import data_api
from app.data_api import DataApiError, api_url, fetch_group

BASE = "https://api.example/run?api-version=1&sig=SECRET&group_id=DEV"


def test_group_id_replaced_and_signature_kept():
    url = api_url("PROD-1", BASE)
    assert url.endswith("group_id=PROD-1") and "sig=SECRET" in url and "DEV" not in url


@pytest.mark.parametrize("bad", ["", "a&b", "x?y", "a/b", "a b"])
def test_bad_group_id_rejected(bad):
    with pytest.raises(DataApiError):
        api_url(bad, BASE)


def test_missing_env_url(monkeypatch):
    monkeypatch.delenv("CQA_API_URL", raising=False)
    with pytest.raises(DataApiError, match="CQA_API_URL"):
        api_url("DEV")


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _serve(monkeypatch, payload=None, error=None):
    def fake_urlopen(req, timeout=None):
        if error:
            raise error
        return _Resp(json.dumps(payload).encode("utf-8"))

    monkeypatch.setattr(data_api.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(data_api.time, "sleep", lambda s: None)


def test_fetch_ok(monkeypatch):
    doc = {"isSuccess": True, "error": "", "data": {"records": [{"conversation_id": "a"}, {"conversation_id": "b"}]}}
    _serve(monkeypatch, doc)
    assert fetch_group("DEV", BASE) == doc


@pytest.mark.parametrize(
    "payload, message",
    [
        ({"isSuccess": False, "error": "нет набора"}, "нет набора"),
        ({"isSuccess": True, "data": {}}, "data.records"),
        ({"isSuccess": True, "data": {"records": [{"conversation_id": "a"}, {"conversation_id": "a"}]}}, "повтор"),
    ],
)
def test_fetch_bad_answers(monkeypatch, payload, message):
    _serve(monkeypatch, payload)
    with pytest.raises(DataApiError, match=message):
        fetch_group("DEV", BASE)


def test_network_error_does_not_leak_url(monkeypatch):
    _serve(monkeypatch, error=urllib.error.HTTPError(api_url("DEV", BASE), 403, "Forbidden", {}, None))
    with pytest.raises(DataApiError) as e:
        fetch_group("DEV", BASE)
    assert "SECRET" not in str(e.value) and "HTTP 403" in str(e.value)
