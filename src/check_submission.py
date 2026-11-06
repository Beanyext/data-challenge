"""Проверка файла сдачи по образцу организаторов. Код выхода 1 при любой ошибке.

Запуск: python src/check_submission.py --sample data/raw/sample_submission.csv --submission outputs/submission.csv [--proba]
"""
from __future__ import annotations

import argparse
import sys

import numpy as np
import pandas as pd

import common


def _ids(series: pd.Series) -> pd.Series:
    """Приводит идентификаторы к одному виду: 7 и 7.0 считаются одним значением."""
    numeric = pd.to_numeric(series, errors="coerce")
    if numeric.notna().all():
        return numeric.astype(float)
    return series.astype("string")


def check(sample: pd.DataFrame, submission: pd.DataFrame, proba: bool = False) -> list[str]:
    errors: list[str] = []
    if list(submission.columns) != list(sample.columns):
        errors.append(f"Колонки {list(submission.columns)} вместо {list(sample.columns)}")
        return errors
    if len(submission) != len(sample):
        errors.append(f"Строк {len(submission)} вместо {len(sample)}")

    id_col = sample.columns[0]
    sub_ids, sample_ids = _ids(submission[id_col]), _ids(sample[id_col])
    duplicates = int(sub_ids.duplicated().sum())
    if duplicates:
        errors.append(f"Повторов идентификатора: {duplicates}")
    missing = set(sample_ids) - set(sub_ids)
    extra = set(sub_ids) - set(sample_ids)
    if missing:
        errors.append(f"Нет идентификаторов из образца: {len(missing)}")
    if extra:
        errors.append(f"Лишних идентификаторов: {len(extra)}")

    for col in sample.columns[1:]:
        s = submission[col]
        if s.isna().any():
            errors.append(f"Пропуски в {col}: {int(s.isna().sum())}")
        if pd.api.types.is_numeric_dtype(sample[col]) and not pd.api.types.is_numeric_dtype(s):
            errors.append(f"В {col} ожидаются числа, получен тип {s.dtype}")
        elif pd.api.types.is_numeric_dtype(s):
            if np.isinf(s.astype(float)).any():
                errors.append(f"Бесконечность в {col}")
            if proba and ((s < 0).any() or (s > 1).any()):
                errors.append(f"В {col} значения вне диапазона от 0 до 1")
    return errors


def warnings_for(submission: pd.DataFrame) -> list[str]:
    return [
        f"В {col} все предсказания одинаковые"
        for col in submission.columns[1:]
        if submission[col].nunique(dropna=False) == 1
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sample", required=True)
    parser.add_argument("--submission", required=True)
    parser.add_argument("--proba", action="store_true", help="значения должны быть вероятностями")
    args = parser.parse_args()

    submission = common.read_table(args.submission)
    errors = check(common.read_table(args.sample), submission, args.proba)
    for warning in warnings_for(submission):
        print(f"Внимание: {warning}")
    if errors:
        print("НЕ ПРОШЁЛ:")
        for error in errors:
            print(f"  {error}")
        sys.exit(1)
    print(f"Файл верный: {len(submission)} строк, колонки {list(submission.columns)}")


if __name__ == "__main__":
    main()
