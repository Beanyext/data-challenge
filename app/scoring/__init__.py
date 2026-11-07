"""Подсчёт итога по правилам чек-листа. Правила и проверочные примеры: reports/чек-лист.md."""

from app.scoring.score import (
    NA,
    NO,
    YES,
    ScoringError,
    apply_decisions,
    compute,
    normalize_answer,
    round_half_up,
    scale_values,
    score,
)

__all__ = [
    "NA",
    "NO",
    "YES",
    "ScoringError",
    "apply_decisions",
    "compute",
    "normalize_answer",
    "round_half_up",
    "scale_values",
    "score",
]
