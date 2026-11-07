"""Запись звонка: свежая ссылка на файл и позиции реплик в записи.

audio_url ведёт на HTML-страницу с плеером, а ссылка на сам MP3 внутри живёт около часа.
Поэтому страница запрашивается в момент воспроизведения. Адрес страницы подписан и наружу не отдаётся.

Позиция реплики в записи = время реплики − начало записи − сумма пауз записи до неё.
События записи идут на разных языках, поэтому ищем по нескольким словам."""

from __future__ import annotations

import html
import re
import urllib.error
import urllib.request
from datetime import datetime
from urllib.parse import urljoin

_SOURCE = re.compile(r"<source\b[^>]*?\bsrc\s*=\s*[\"']([^\"']+)[\"']", re.IGNORECASE)
_AUDIO = re.compile(r"<audio\b[^>]*?\bsrc\s*=\s*[\"']([^\"']+)[\"']", re.IGNORECASE)
_RECORDING = ("запис", "жазу", "record", "транскри")
_START = ("запущен", "начат", "басталды", "started")
_PAUSE = ("приостановлен", "paused", "тоқтатыл", "кідірт")
_RESUME = ("возобновлен", "resumed", "жалғас", "қайта")


class AudioError(RuntimeError):
    """Запись получить не удалось. Текст без адресов."""


def _parse(ts: object) -> datetime | None:
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except ValueError:
        return None


def recording_event(text: str) -> str | None:
    low = str(text or "").lower()
    if not any(w in low for w in _RECORDING):
        return None
    if any(w in low for w in _PAUSE):
        return "pause"
    if any(w in low for w in _RESUME):
        return "resume"
    if any(w in low for w in _START):
        return "start"
    return None


def turn_offsets(transcript: list[dict]) -> dict[str, float]:
    """Секунды от начала записи для каждой реплики. Пусто, если время не ISO 8601 (чаты)."""
    times = [_parse(t.get("timestamp")) for t in transcript]
    if not times or any(t is None for t in times):
        return {}
    events = [(times[i], recording_event(t.get("text"))) for i, t in enumerate(transcript) if t.get("speaker") == "system"]
    start = next((ts for ts, kind in events if kind == "start"), times[0])
    pauses: list[tuple[datetime, datetime | None]] = []
    paused_at = None
    for ts, kind in events:
        if ts < start:
            continue
        if kind == "pause" and paused_at is None:
            paused_at = ts
        elif kind == "resume" and paused_at is not None:
            pauses.append((paused_at, ts))
            paused_at = None
    if paused_at is not None:
        pauses.append((paused_at, None))
    out = {}
    for i, ts in enumerate(times):
        offset = (ts - start).total_seconds()
        for p, r in pauses:
            if p < ts:
                end = ts if r is None or ts < r else r
                offset -= (end - p).total_seconds()
        out[str(i)] = round(max(0.0, offset), 1)
    return out


def fresh_audio_url(page_url: str, timeout: float = 30) -> str:
    """Ссылка на файл записи со страницы плеера. Если адрес уже отдаёт звук, он и возвращается."""
    req = urllib.request.Request(page_url, headers={"User-Agent": "cqa-prototype", "Accept": "text/html,audio/*"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.headers.get_content_type().startswith("audio/"):
                return page_url
            body = resp.read(2_000_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        raise AudioError(f"страница записи ответила HTTP {e.code}") from None
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise AudioError(f"страница записи недоступна: {type(e).__name__}") from None
    m = _SOURCE.search(body) or _AUDIO.search(body)
    if not m:
        raise AudioError("на странице записи нет ссылки на файл")
    return urljoin(page_url, html.unescape(m.group(1)))
