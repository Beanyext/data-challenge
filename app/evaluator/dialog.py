"""Загрузка диалогов и подготовка транскрипта для модели."""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path

ROLE_NAMES = {"client": "клиент", "operator": "оператор", "bot": "бот", "system": "система"}
_TAG = re.compile(r"<\s*/?\s*transcript", re.IGNORECASE)


def load_records(path: str | Path) -> list[dict]:
    """Читает ответ API организаторов, список записей или одну запись."""
    doc = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    if isinstance(doc, dict) and "data" in doc:
        if doc.get("isSuccess") is False:
            raise ValueError(f"API вернул ошибку: {doc.get('error')}")
        return doc["data"]["records"]
    if isinstance(doc, list):
        return doc
    if isinstance(doc, dict) and "transcript" in doc:
        return [doc]
    raise ValueError(f"Неизвестный формат файла с диалогами: {path}")


def clean_text(text: object) -> str:
    """Одна строка без лишних пробелов. Метки транскрипта внутри текста обезврежены."""
    return _TAG.sub("[transcript", " ".join(str(text or "").split()))


def _parse_iso(value: object) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def display_times(transcript: list[dict]) -> list[str]:
    """Время чатов как есть. Время звонков (ISO 8601) переводится в минуты:секунды от первой реплики."""
    raw = [t.get("timestamp") for t in transcript]
    parsed = [_parse_iso(v) for v in raw]
    if not parsed or any(p is None for p in parsed) or len({p.tzinfo is None for p in parsed}) > 1:
        return [str(v or "") for v in raw]
    start = parsed[0]
    out = []
    for p in parsed:
        seconds = max(0, int((p - start).total_seconds()))
        out.append(f"{seconds // 60:02d}:{seconds % 60:02d}")
    return out


def operator_turns(record: dict) -> list[int]:
    return [i for i, t in enumerate(record["transcript"]) if t.get("speaker") == "operator"]


def render_transcript(record: dict) -> str:
    """Каждая реплика на своей строке с номером в массиве transcript: на него ссылаются доказательства."""
    lines = []
    for i, (turn, ts) in enumerate(zip(record["transcript"], display_times(record["transcript"]))):
        role = ROLE_NAMES.get(turn.get("speaker"), str(turn.get("speaker")))
        lines.append(f"[{i}] {ts} {role}: {clean_text(turn.get('text'))}")
    return "\n".join(lines)
