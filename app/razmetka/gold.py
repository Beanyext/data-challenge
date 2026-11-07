"""Файл эталонной разметки reports/gold.json.

Внутри только номера диалогов, критерии и ответы, плюс отметка «сомневаюсь» и откуда взят черновик.
Свободного текста нет намеренно: в нём легко оказались бы цитаты из реальных звонков."""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from app.scoring import ScoringError, normalize_answer

DRAFT_SOURCES = ("none", "model")
# Кто размечал: человек или ИИ-помощник. Разметка ИИ честно помечается: от неё зависит,
# как называть цифру точности на защите.
LABELERS = ("human", "assistant")


def new_gold(checklist: dict, split: dict, seed: int) -> dict:
    return {
        "checklist_id": checklist.get("id"),
        "checklist_version": checklist.get("version"),
        "seed": seed,
        "split": split,
        "labels": {},
    }


def load_gold(path: str | Path) -> dict | None:
    path = Path(path)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def save_gold(path: str | Path, gold: dict) -> None:
    """Запись через временный файл и замену: при сбое старый файл остаётся целым."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(gold, ensure_ascii=False, indent=2) + "\n"
    fd, tmp = tempfile.mkstemp(prefix=".gold-", suffix=".json", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def clean_label(checklist: dict, body: dict) -> dict:
    """Проверяет присланную разметку одного диалога. Разрешена частичная: можно сохранить и продолжить позже."""
    if not isinstance(body, dict):
        raise ScoringError("ожидается объект с ответами")
    criteria = {c["id"]: c for c in checklist["criteria"]}
    answers_in = body.get("answers") or {}
    if not isinstance(answers_in, dict):
        raise ScoringError("answers должен быть объектом")
    answers = {}
    for cid, raw in answers_in.items():
        if cid not in criteria:
            raise ScoringError(f"в чек-листе нет критерия {cid}")
        if raw is not None:
            answers[cid] = normalize_answer(criteria[cid], raw)
    unsure = body.get("unsure") or []
    if not isinstance(unsure, list) or any(u not in criteria for u in unsure):
        raise ScoringError("unsure должен быть списком критериев чек-листа")
    draft = body.get("draft") or "none"
    if draft not in DRAFT_SOURCES:
        raise ScoringError(f"draft должен быть одним из {DRAFT_SOURCES}")
    by = body.get("by") or "human"
    if by not in LABELERS:
        raise ScoringError(f"by должен быть одним из {LABELERS}")
    order = list(criteria)
    return {
        "answers": {cid: answers[cid] for cid in order if cid in answers},
        "unsure": [cid for cid in order if cid in set(unsure)],
        "draft": draft,
        "by": by,
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def is_complete(checklist: dict, label: dict | None) -> bool:
    return bool(label) and all(c["id"] in label.get("answers", {}) for c in checklist["criteria"])
