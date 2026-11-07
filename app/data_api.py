"""Набор диалогов с API организаторов по group_id.

Адрес берётся из CQA_API_URL в .env: в нём подпись sig, поэтому адрес не печатается,
не пишется в журналы и не попадает в сообщения об ошибках."""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


class DataApiError(RuntimeError):
    """API не вернуло набор. Текст ошибки без адреса API."""


def api_url(group_id: str, base: str | None = None) -> str:
    base = base or os.environ.get("CQA_API_URL", "")
    if not base:
        raise DataApiError("нет CQA_API_URL: положите адрес API организаторов в файл .env в корне репозитория")
    if not group_id or any(ch in group_id for ch in "&?#/ "):
        raise DataApiError(f"недопустимый group_id {group_id!r}")
    parts = urlsplit(base)
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k != "group_id"]
    query.append(("group_id", group_id))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def fetch_group(group_id: str, base: str | None = None, timeout: float = 60, attempts: int = 3) -> dict:
    """Ответ API целиком: {"isSuccess": true, "data": {"records": [...]}}. Повтор при сбое сети."""
    url = api_url(group_id, base)
    last = ""
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "cqa-prototype"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                doc = json.loads(resp.read().decode("utf-8-sig"))
            break
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last = type(e).__name__
        except json.JSONDecodeError:
            last = "ответ не JSON"
        if attempt + 1 < attempts:
            time.sleep(2 * (attempt + 1))
    else:
        raise DataApiError(f"API организаторов не ответило: {last}")
    if not isinstance(doc, dict) or doc.get("isSuccess") is not True:
        err = doc.get("error") if isinstance(doc, dict) else "неизвестный формат"
        raise DataApiError(f"API вернуло ошибку: {err}")
    records = (doc.get("data") or {}).get("records")
    if not isinstance(records, list):
        raise DataApiError("в ответе API нет data.records")
    ids = [r.get("conversation_id") for r in records]
    if len(set(ids)) != len(ids) or any(not i for i in ids):
        raise DataApiError("в наборе пустые или повторяющиеся conversation_id")
    return doc


def save_group(doc: dict, path: str | Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    return path
