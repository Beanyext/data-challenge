"""Профиль таблицы. По умолчанию не выводит значения: только типы, пропуски и агрегаты.

Запуск: python src/profile_data.py data/raw/train.csv [--values]
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

import pandas as pd

import common

PII_RE = re.compile(
    r"iin|иин|phone|телефон|e-?mail|почт|fio|фио|name|имя|фамил|address|адрес"
    r"|card|карт|iban|passport|паспорт|birth|рожд",
    re.IGNORECASE,
)
DATE_SHARE = 0.9


def looks_like_date(series: pd.Series) -> bool:
    sample = series.dropna().astype("string").head(1000)
    if sample.empty or sample.str.fullmatch(r"[\d.,\s-]+").all() and sample.str.len().max() < 8:
        return False
    parsed = pd.to_datetime(sample, errors="coerce", format="mixed", dayfirst=True)
    return parsed.notna().mean() >= DATE_SHARE


def describe_column(series: pd.Series, n_rows: int, values: bool) -> dict[str, str]:
    name = str(series.name)
    nunique = series.nunique(dropna=True)
    pii = bool(PII_RE.search(name))
    flags = []
    if nunique <= 1:
        flags.append("константа")
    if n_rows and nunique / n_rows > 0.95:
        flags.append("похоже на идентификатор")
    if pii:
        flags.append("возможны личные данные")

    stats = "скрыто" if pii else ""
    if not pii:
        if pd.api.types.is_numeric_dtype(series) and not pd.api.types.is_bool_dtype(series):
            s = series.astype(float)
            stats = (
                f"min {s.min():.4g}; медиана {s.median():.4g}; "
                f"среднее {s.mean():.4g}; max {s.max():.4g}"
            )
        elif pd.api.types.is_datetime64_any_dtype(series):
            stats = f"с {series.min()} по {series.max()}"
        elif looks_like_date(series):
            parsed = pd.to_datetime(series, errors="coerce", format="mixed", dayfirst=True)
            flags.append("дата в тексте")
            stats = f"с {parsed.min():%Y-%m-%d} по {parsed.max():%Y-%m-%d}"
        elif values:
            top = series.value_counts().head(5)
            stats = "; ".join(f"{k}: {v}" for k, v in top.items())
    return {
        "column": name,
        "dtype": str(series.dtype),
        "missing": f"{series.isna().mean():.1%}",
        "unique": str(nunique),
        "stats": stats,
        "flags": ", ".join(flags),
    }


def profile(df: pd.DataFrame, title: str, values: bool = False) -> str:
    rows = [describe_column(df[c], len(df), values) for c in df.columns]
    table = common.md_table(
        ["Колонка", "Тип", "Пропуски", "Уникальных", "Сводка", "Отметки"],
        [[r["column"], r["dtype"], r["missing"], r["unique"], r["stats"], r["flags"]] for r in rows],
    )
    return (
        f"# Профиль: {title}\n\n"
        f"Строк: {len(df)}. Колонок: {df.shape[1]}. "
        f"Полных дублей строк: {int(df.duplicated().sum())}.\n\n{table}\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path")
    parser.add_argument("--values", action="store_true", help="показать частые значения, кроме личных полей")
    args = parser.parse_args()

    path = Path(args.path)
    text = profile(common.read_table(path), path.name, args.values)
    out = common.REPORTS / f"profile_{path.stem}.md"
    common.write_report(out, text)
    print(text)
    print(f"Сохранено: {out}")


if __name__ == "__main__":
    main()
