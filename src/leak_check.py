"""Поиск утечек и различий train/test. Выводит только названия колонок и оценки.

Запуск: python src/leak_check.py --train data/raw/train.csv --target y [--test data/raw/test.csv] [--id id]
"""
from __future__ import annotations

import argparse

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import KFold, StratifiedKFold, cross_val_predict, cross_val_score
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor

import common

LEAK_THRESHOLD = 0.95
DRIFT_THRESHOLD = 0.70
MAX_ROWS = 50_000


def single_feature_scores(df: pd.DataFrame, target: str, ignore: list[str]) -> tuple[pd.Series, str]:
    """Насколько хорошо каждая колонка в одиночку предсказывает целевую."""
    if len(df) > MAX_ROWS:
        df = df.sample(MAX_ROWS, random_state=common.SEED)
    y_raw = df[target]
    mask = y_raw.notna()
    df, y_raw = df[mask], y_raw[mask]
    regression = pd.api.types.is_numeric_dtype(y_raw) and y_raw.nunique() > 20
    X = common.to_numeric_frame(df.drop(columns=[target, *ignore], errors="ignore"))

    if regression:
        model, y, scoring = (
            DecisionTreeRegressor(max_depth=4, min_samples_leaf=20, random_state=common.SEED),
            y_raw.astype(float).to_numpy(),
            "r2",
        )
        cv = KFold(3, shuffle=True, random_state=common.SEED)
    else:
        model, y, scoring = (
            DecisionTreeClassifier(max_depth=4, min_samples_leaf=20, random_state=common.SEED),
            pd.factorize(y_raw)[0],
            "roc_auc" if y_raw.nunique() == 2 else "roc_auc_ovr",
        )
        cv = StratifiedKFold(3, shuffle=True, random_state=common.SEED)

    scores = {}
    for col in X.columns:
        scores[col] = float(np.nanmean(cross_val_score(model, X[[col]], y, cv=cv, scoring=scoring)))
    return pd.Series(scores).sort_values(ascending=False), scoring


def adversarial_auc(train: pd.DataFrame, test: pd.DataFrame, columns: list[str]) -> tuple[float, pd.Series]:
    """Может ли модель отличить строку train от строки test. Около 0.5 значит не может."""
    import lightgbm as lgb

    a = train[columns].sample(min(len(train), MAX_ROWS), random_state=common.SEED)
    b = test[columns].sample(min(len(test), MAX_ROWS), random_state=common.SEED)
    X = common.to_numeric_frame(pd.concat([a, b], ignore_index=True))
    y = np.r_[np.zeros(len(a)), np.ones(len(b))]
    model = lgb.LGBMClassifier(
        n_estimators=100, learning_rate=0.1, random_state=common.SEED, verbose=-1,
        importance_type="gain",
    )
    cv = StratifiedKFold(3, shuffle=True, random_state=common.SEED)
    proba = cross_val_predict(model, X, y, cv=cv, method="predict_proba")[:, 1]
    importance = pd.Series(model.fit(X, y).feature_importances_, index=X.columns)
    return float(roc_auc_score(y, proba)), importance.sort_values(ascending=False)


def run(train: pd.DataFrame, target: str, test: pd.DataFrame | None, ignore: list[str]) -> dict:
    scores, scoring = single_feature_scores(train, target, ignore)
    leaks = scores[scores >= LEAK_THRESHOLD].index.tolist()
    result: dict = {"scores": scores, "scoring": scoring, "leaks": leaks}
    if test is not None:
        common_cols = [c for c in train.columns if c in test.columns and c != target and c not in ignore]
        auc, importance = adversarial_auc(train, test, common_cols)
        result |= {"adversarial_auc": auc, "drift": auc >= DRIFT_THRESHOLD, "importance": importance}
    return result


def report(result: dict) -> str:
    rows = [[c, f"{v:.4f}"] for c, v in result["scores"].head(15).items()]
    lines = [
        "# Проверка утечек",
        "",
        f"Оценка одной колонки ({result['scoring']}), порог подозрения {LEAK_THRESHOLD}:",
        "",
        common.md_table(["Колонка", "Оценка"], rows),
        "",
        f"**Подозрение на утечку:** {', '.join(result['leaks']) or 'нет'}",
        "",
        "Порог ловит только явные случаи. По каждой верхней колонке проверь смысл: "
        "известно ли её значение в момент прогноза.",
    ]
    if "adversarial_auc" in result:
        top = ", ".join(result["importance"].head(5).index)
        verdict = (
            "train и test различаются, случайное разбиение завысит оценку"
            if result["drift"]
            else "сильных различий нет"
        )
        lines += ["", f"**Различие train и test:** AUC {result['adversarial_auc']:.3f}, {verdict}. Больше всего различают: {top}."]
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--test")
    parser.add_argument("--id", nargs="*", default=[], help="колонки, которые не проверять")
    args = parser.parse_args()

    train = common.read_table(args.train)
    test = common.read_table(args.test) if args.test else None
    text = report(run(train, args.target, test, args.id))
    out = common.REPORTS / "leak_check.md"
    common.write_report(out, text)
    print(text)
    print(f"Сохранено: {out}")


if __name__ == "__main__":
    main()
