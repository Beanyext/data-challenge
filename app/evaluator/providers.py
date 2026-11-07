"""Откуда берётся ответ: модель Claude или тестовый режим без модели."""

from __future__ import annotations

import json
import os
import time

from app.evaluator.dialog import operator_turns
from app.evaluator.prompt import answer_options

# Долларов за миллион токенов. Источник: справка Claude API, цены на 2026-10-06.
# Запись в кеш стоит 1,25 цены ввода, чтение из кеша указано отдельно.
PRICES_PER_MTOK = {
    "claude-opus-5-5": {"input": 4.00, "output": 20.00, "cache_read": 0.20},
    "claude-sonnet-5-5": {"input": 2.00, "output": 10.00, "cache_read": 0.20},
    "claude-haiku-5-5": {"input": 0.10, "output": 0.50, "cache_read": 0.01},
}


class EvaluationError(RuntimeError):
    """Модель не дала пригодного ответа."""


def call_cost(usage: dict) -> float | None:
    price = PRICES_PER_MTOK.get(usage.get("model", ""))
    if price is None:
        return None
    total = (
        usage.get("input_tokens", 0) * price["input"]
        + usage.get("cache_creation_input_tokens", 0) * price["input"] * 1.25
        + usage.get("cache_read_input_tokens", 0) * price["cache_read"]
        + usage.get("output_tokens", 0) * price["output"]
    )
    return round(total / 1_000_000, 6)


class AnthropicProvider:
    """Claude через официальный пакет anthropic.

    Ключ передаётся явно из ANTHROPIC_API_KEY (обычно из .env проекта). Без этого SDK сам ищет
    другие ключи и профили на машине и может молча взять чужой."""

    name = "anthropic"

    def __init__(self, model: str | None = None, effort: str | None = None, fallbacks: bool | None = None, max_tokens: int = 16000):
        import anthropic  # здесь, а не наверху: тесты и тестовый режим работают без пакета

        key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
        if not key:
            raise EvaluationError("нет ANTHROPIC_API_KEY: положите ключ в файл .env в корне репозитория")
        self.client = anthropic.Anthropic(api_key=key)
        self.model = model or os.environ.get("CQA_MODEL", "claude-opus-5-5")
        self.effort = effort or os.environ.get("CQA_EFFORT", "high")
        self.fallbacks = fallbacks if fallbacks is not None else os.environ.get("CQA_FALLBACKS", "1") != "0"
        self.max_tokens = max_tokens

    def complete(self, system: str, user: str, schema: dict) -> tuple[dict, dict]:
        kwargs = dict(
            model=self.model,
            max_tokens=self.max_tokens,
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user}],
            thinking={"type": "adaptive"},
            output_config={"effort": self.effort, "format": {"type": "json_schema", "schema": schema}},
        )
        started = time.monotonic()
        if self.fallbacks:
            # При отказе модели по соображениям безопасности сервер сам повторит запрос на рекомендованной модели.
            response = self.client.beta.messages.create(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kwargs)
        else:
            response = self.client.messages.create(**kwargs)
        u = response.usage
        usage = {
            "model": response.model,
            "requested_model": self.model,
            "effort": self.effort,
            "input_tokens": u.input_tokens or 0,
            "output_tokens": u.output_tokens or 0,
            "cache_creation_input_tokens": getattr(u, "cache_creation_input_tokens", 0) or 0,
            "cache_read_input_tokens": getattr(u, "cache_read_input_tokens", 0) or 0,
            "seconds": round(time.monotonic() - started, 2),
            "stop_reason": response.stop_reason,
            "request_id": getattr(response, "_request_id", None),
        }
        usage["cost_usd"] = call_cost(usage)
        if response.stop_reason == "refusal":
            raise EvaluationError(f"модель отказалась отвечать: {getattr(response, 'stop_details', None)}")
        if response.stop_reason == "max_tokens":
            raise EvaluationError("ответ модели обрезан по max_tokens")
        text = next((b.text for b in response.content if b.type == "text"), None)
        if text is None:
            raise EvaluationError("в ответе модели нет текста")
        return json.loads(text), usage


class MockProvider:
    """Тестовый режим без модели: правдоподобный ответ, чтобы интерфейс и сервер работали без ключа.
    Результат не настоящая оценка и в отчётах о точности не участвует."""

    name = "mock"

    def __init__(self, record: dict | None = None, checklist: dict | None = None):
        self.record = record
        self.checklist = checklist

    def answer(self, record: dict, checklist: dict) -> dict:
        ops = operator_turns(record) or [0]
        first, last = ops[0], len(record["transcript"]) - 1
        quote = " ".join(str(record["transcript"][first].get("text") or "").split()[:6])
        out = {}
        for c in checklist["criteria"]:
            if c.get("gross_error"):
                out[c["id"]] = {"answer": "no", "explanation": f"{c['title']} — нет. Тестовый режим без модели.",
                                "evidence": [], "checked_range": [first, last], "na_reason": ""}
            else:
                out[c["id"]] = {"answer": answer_options(c)[0], "explanation": f"{c['title']} — тестовый режим без модели.",
                                "evidence": [{"turn": first, "quote": quote}], "checked_range": [], "na_reason": ""}
        return out

    def complete(self, system: str, user: str, schema: dict) -> tuple[dict, dict]:
        if self.record is None or self.checklist is None:
            raise EvaluationError("тестовому режиму нужен диалог и чек-лист: используйте evaluate_dialog")
        usage = {"model": "mock", "input_tokens": 0, "output_tokens": 0, "seconds": 0.0, "stop_reason": "end_turn", "cost_usd": 0.0}
        return self.answer(self.record, self.checklist), usage
