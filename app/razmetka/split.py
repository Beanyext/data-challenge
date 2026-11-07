"""Какие диалоги размечаем: настроечная часть и отложенная.

На настроечной части подбираем запрос. Отложенная изображает контрольный этап организаторов:
на ней запрос не настраиваем и замеряем точность один раз в конце."""

from __future__ import annotations

import random

# (канал, язык): (отложенных, настроечных). Всего 30: 5 звонков, 13 чатов RU, 6 KZ, 6 EN.
DEFAULT_QUOTAS = {
    ("voice call", "RU"): (2, 3),
    ("agent chat", "RU"): (4, 9),
    ("agent chat", "KZ"): (2, 4),
    ("agent chat", "EN"): (2, 4),
}


def choose_split(records: list[dict], quotas: dict = DEFAULT_QUOTAS, seed: int = 42) -> dict:
    """Случайный выбор с зерном внутри каждой группы «канал + язык». Один и тот же набор даёт один и тот же выбор."""
    rng = random.Random(seed)
    holdout: list[str] = []
    tune: list[str] = []
    for key in sorted(quotas):
        n_hold, n_tune = quotas[key]
        ids = sorted(r["conversation_id"] for r in records if (r.get("channel"), r.get("language")) == key)
        picked = rng.sample(ids, min(len(ids), n_hold + n_tune))
        holdout += picked[:n_hold]
        tune += picked[n_hold:]
    return {"holdout": holdout, "tune": tune}
