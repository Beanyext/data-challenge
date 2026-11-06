"""Базовая модель с кросс-валидацией: сравнение с простым ориентиром и файл сдачи.

Запуск: python src/baseline.py --train data/raw/train.csv --target y --test data/raw/test.csv --id id
            --sample-submission data/raw/sample_submission.csv [--metric roc_auc]
            [--split auto|kfold|stratified|group|time] [--group-col client] [--time-col date]
"""
from __future__ import annotations

import argparse
import csv
import subprocess
import time
from datetime import datetime

import numpy as np
import pandas as pd
from sklearn.compose import make_column_selector, make_column_transformer
from sklearn.dummy import DummyClassifier, DummyRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    f1_score,
    log_loss,
    mean_absolute_error,
    r2_score,
    roc_auc_score,
    root_mean_squared_error,
)
from sklearn.model_selection import GroupKFold, KFold, StratifiedKFold, TimeSeriesSplit
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

import check_submission
import common

HIGHER_IS_BETTER = {
    "roc_auc": True, "pr_auc": True, "f1": True, "f1_macro": True, "accuracy": True, "r2": True,
    "logloss": False, "rmse": False, "mae": False,
}
PROB_METRICS = {"roc_auc", "pr_auc", "logloss"}
BINARY_ONLY = {"pr_auc", "f1"}
REGRESSION_METRICS = {"rmse", "mae", "r2"}
DEFAULT_METRIC = {"binary": "roc_auc", "multiclass": "f1_macro", "regression": "rmse"}
SUSPICIOUS_AUC = 0.99


def detect_task(y: pd.Series) -> str:
    if pd.api.types.is_numeric_dtype(y) and y.nunique() > 20:
        return "regression"
    return "binary" if y.nunique() == 2 else "multiclass"


def validate_metric(metric: str, task: str) -> None:
    if metric not in HIGHER_IS_BETTER:
        raise SystemExit(f"Неизвестная метрика {metric}: выбери из {sorted(HIGHER_IS_BETTER)}")
    if (metric in REGRESSION_METRICS) != (task == "regression"):
        raise SystemExit(f"Метрика {metric} не подходит к задаче {task}")
    if metric in BINARY_ONLY and task != "binary":
        raise SystemExit(f"Метрика {metric} только для двух классов")


def score(metric: str, y_true: np.ndarray, pred: np.ndarray, n_classes: int) -> float:
    if metric == "rmse":
        return float(root_mean_squared_error(y_true, pred))
    if metric == "mae":
        return float(mean_absolute_error(y_true, pred))
    if metric == "r2":
        return float(r2_score(y_true, pred))
    if metric == "logloss":
        return float(log_loss(y_true, pred, labels=np.arange(n_classes)))
    if metric == "roc_auc":
        if n_classes == 2:
            return float(roc_auc_score(y_true, pred[:, 1]))
        return float(roc_auc_score(y_true, pred, multi_class="ovr", labels=np.arange(n_classes)))
    if metric == "pr_auc":
        return float(average_precision_score(y_true, pred[:, 1]))
    hard = pred.argmax(axis=1)
    if metric == "f1":
        return float(f1_score(y_true, hard))
    if metric == "f1_macro":
        return float(f1_score(y_true, hard, average="macro"))
    return float(accuracy_score(y_true, hard))


def make_splits(
    y: np.ndarray,
    task: str,
    split: str,
    folds: int,
    seed: int,
    groups: np.ndarray | None = None,
    times: np.ndarray | None = None,
) -> list[tuple[np.ndarray, np.ndarray]]:
    """Разбиения по строкам. При разбиении по времени validation всегда позже train."""
    idx = np.arange(len(y))
    if split == "group":
        return list(GroupKFold(n_splits=folds).split(idx, y, groups))
    if split == "time":
        unique = np.sort(pd.unique(times))
        out = []
        for tr_u, va_u in TimeSeriesSplit(n_splits=min(folds, len(unique) - 1)).split(unique):
            train_rows = np.flatnonzero(times <= unique[tr_u[-1]])
            val_rows = np.flatnonzero((times >= unique[va_u[0]]) & (times <= unique[va_u[-1]]))
            out.append((train_rows, val_rows))
        return out
    if split == "stratified":
        return list(StratifiedKFold(folds, shuffle=True, random_state=seed).split(idx, y))
    return list(KFold(folds, shuffle=True, random_state=seed).split(idx))


def build_features(
    train: pd.DataFrame, test: pd.DataFrame | None, columns: list[str]
) -> tuple[pd.DataFrame, pd.DataFrame | None, list[str], dict[str, list[str]]]:
    """Числа, даты в секундах, текст со значением-заполнителем вместо пропуска."""

    def convert(df: pd.DataFrame) -> pd.DataFrame:
        out = {}
        for col in columns:
            s = df[col]
            if pd.api.types.is_datetime64_any_dtype(s):
                out[col] = common.to_seconds(s)
            elif pd.api.types.is_numeric_dtype(s):
                out[col] = s.astype(float).replace([np.inf, -np.inf], np.nan)
            else:
                out[col] = s.astype("string").fillna(common.NA_TOKEN).astype(object)
        return pd.DataFrame(out, index=df.index)

    X_train = convert(train)
    X_test = convert(test) if test is not None else None
    cat_cols = [c for c in columns if X_train[c].dtype == object]
    categories = {}
    for col in cat_cols:
        values = set(X_train[col])
        if X_test is not None:
            values |= set(X_test[col])
        categories[col] = sorted(values)
    return X_train, X_test, cat_cols, categories


def _aligned_proba(estimator, X, n_classes: int) -> np.ndarray:
    """Вероятности по всем классам, даже если в части обучения какого-то класса не было."""
    out = np.zeros((len(X), n_classes))
    out[:, np.asarray(estimator.classes_).astype(int)] = estimator.predict_proba(X)
    return out


def _as_category(X: pd.DataFrame, categories: dict[str, list[str]]) -> pd.DataFrame:
    return X.assign(**{c: pd.Categorical(X[c], categories=v) for c, v in categories.items()})


def fit_predict(model, X_tr, y_tr, X_va, task, cat_cols, categories, n_classes, seed) -> np.ndarray:
    regression = task == "regression"
    if model == "dummy":
        estimator = DummyRegressor() if regression else DummyClassifier(strategy="prior")
    elif model == "linear":
        prep = make_column_transformer(
            (
                make_pipeline(SimpleImputer(strategy="median"), StandardScaler()),
                make_column_selector(dtype_include="number"),
            ),
            (
                OneHotEncoder(handle_unknown="infrequent_if_exist", max_categories=30),
                make_column_selector(dtype_exclude="number"),
            ),
        )
        head = Ridge(random_state=seed) if regression else LogisticRegression(max_iter=1000, random_state=seed)
        estimator = make_pipeline(prep, head)
    elif model == "lightgbm":
        import lightgbm as lgb

        cls = lgb.LGBMRegressor if regression else lgb.LGBMClassifier
        estimator = cls(
            n_estimators=400, learning_rate=0.05, num_leaves=31, subsample=0.8, subsample_freq=1,
            colsample_bytree=0.8, random_state=seed, verbose=-1,
        )
        X_tr, X_va = _as_category(X_tr, categories), _as_category(X_va, categories)
    elif model == "catboost":
        from catboost import CatBoostClassifier, CatBoostRegressor

        cls = CatBoostRegressor if regression else CatBoostClassifier
        estimator = cls(
            iterations=400, learning_rate=0.05, random_seed=seed, verbose=0,
            allow_writing_files=False, cat_features=cat_cols,
        )
    else:
        raise SystemExit(f"Неизвестная модель {model}")

    estimator.fit(X_tr, y_tr)
    if regression:
        return np.asarray(estimator.predict(X_va), dtype=float)
    return _aligned_proba(estimator, X_va, n_classes)


def git_hash() -> str:
    try:
        done = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], cwd=common.ROOT, capture_output=True, text=True, check=True
        )
        return done.stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "нет"


def log_experiment(row: dict) -> None:
    path = common.REPORTS / "experiments.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    new = not path.exists()
    with path.open("a", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(row))
        if new:
            writer.writeheader()
        writer.writerow(row)


def run(args: argparse.Namespace) -> dict:
    train = common.read_table(args.train)
    if args.target not in train.columns:
        raise SystemExit(f"Нет колонки {args.target}. Есть: {list(train.columns)}")
    dropped = int(train[args.target].isna().sum())
    if dropped:
        print(f"Убрано строк без целевой колонки: {dropped}")
    train = train[train[args.target].notna()].reset_index(drop=True)
    test = common.read_table(args.test) if args.test else None
    if test is not None and not args.id:
        raise SystemExit("Для файла сдачи укажи --id")

    task = detect_task(train[args.target]) if args.task == "auto" else args.task
    metric = args.metric or DEFAULT_METRIC[task]
    validate_metric(metric, task)

    y_raw = train[args.target]
    if task == "regression":
        y, classes, n_classes = y_raw.astype(float).to_numpy(), None, 0
    else:
        classes = np.sort(y_raw.unique())
        y, n_classes = np.searchsorted(classes, y_raw.to_numpy()), len(classes)

    split = args.split
    if split == "auto":
        split = (
            "group" if args.group_col
            else "time" if args.time_col
            else "kfold" if task == "regression"
            else "stratified"
        )
    groups = train[args.group_col].to_numpy() if split == "group" else None
    times = None
    if split == "time":
        raw_time = train[args.time_col]
        if pd.api.types.is_numeric_dtype(raw_time):
            times = raw_time.to_numpy()
        else:
            parsed = pd.to_datetime(raw_time, errors="coerce", format="mixed", dayfirst=args.dayfirst)
            if parsed.isna().any():
                raise SystemExit(f"В {args.time_col} не разобрано дат: {int(parsed.isna().sum())}")
            times = parsed.to_numpy()
    splits = make_splits(y, task, split, args.folds, args.seed, groups, times)

    excluded = {args.target, args.id, args.group_col, args.time_col, *args.drop} - {None}
    columns = [c for c in train.columns if c not in excluded]
    if test is not None:
        lost = [c for c in columns if c not in test.columns]
        if lost:
            print(f"Нет в test, не используются: {lost}")
        columns = [c for c in columns if c in test.columns]
    X, X_test, cat_cols, categories = build_features(train, test, columns)
    wide = [c for c in cat_cols if len(categories[c]) > 1000]
    if wide:
        print(f"Текстовые колонки с более чем 1000 значений, проверь смысл: {wide}")

    print(f"Задача {task}, метрика {metric}, разбиение {split}, частей {len(splits)}, признаков {len(columns)}")
    if classes is not None and n_classes == 2:
        print(f"Положительный класс: {classes[1]}")

    results = {}
    for model in args.models.split(","):
        started = time.time()
        fold_scores = []
        for tr, va in splits:
            pred = fit_predict(
                model, X.iloc[tr], y[tr], X.iloc[va], task, cat_cols, categories, n_classes, args.seed
            )
            if task != "regression" and len(np.unique(y[va])) < 2:
                print(f"{model}: часть пропущена, в ней один класс")
                continue
            fold_scores.append(score(metric, y[va], pred, n_classes))
        results[model] = {
            "mean": float(np.mean(fold_scores)),
            "std": float(np.std(fold_scores)),
            "seconds": round(time.time() - started, 1),
        }
        print(f"{model:10s} {metric} {results[model]['mean']:.5f} ± {results[model]['std']:.5f} ({results[model]['seconds']} с)")
        log_experiment({
            "when": datetime.now().isoformat(timespec="seconds"),
            "git": git_hash(),
            "name": args.name,
            "model": model,
            "metric": metric,
            "mean": round(results[model]["mean"], 6),
            "std": round(results[model]["std"], 6),
            "split": split,
            "folds": len(fold_scores),
            "rows": len(X),
            "features": len(columns),
            "seconds": results[model]["seconds"],
        })

    pick = max if HIGHER_IS_BETTER[metric] else min
    best = pick(results, key=lambda m: results[m]["mean"])
    print(f"Лучшая модель: {best}")
    if "dummy" in results and best == "dummy":
        print("ВНИМАНИЕ: модели не лучше простого ориентира")
    if metric == "roc_auc" and results[best]["mean"] >= SUSPICIOUS_AUC:
        print("ВНИМАНИЕ: оценка подозрительно высокая, запусти src/leak_check.py")

    outcome = {"task": task, "metric": metric, "split": split, "best": best, "results": results}
    if test is not None:
        pred = fit_predict(best, X, y, X_test, task, cat_cols, categories, n_classes, args.seed)
        outcome["submission"] = write_submission(args, test, pred, task, metric, classes)
    return outcome


def write_submission(args, test, pred, task, metric, classes):
    if task == "regression":
        values = pred
    elif task == "binary" and metric in PROB_METRICS:
        values = pred[:, 1]
    else:
        values = classes[pred.argmax(axis=1)]

    sample = common.read_table(args.sample_submission) if args.sample_submission else None
    id_name = sample.columns[0] if sample is not None else args.id
    target_name = sample.columns[1] if sample is not None else args.target
    frame = pd.DataFrame({id_name: test[args.id].to_numpy(), target_name: values})
    if sample is not None:
        frame = frame.set_index(id_name).reindex(sample[id_name]).reset_index()
        errors = check_submission.check(sample, frame, proba=task == "binary" and metric in PROB_METRICS)
        if errors:
            raise SystemExit("Файл сдачи не прошёл проверку: " + "; ".join(errors))

    path = common.OUTPUTS / f"submission_{args.name}.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(path, index=False)
    print(f"Файл сдачи: {path}")
    return path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--train", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--test")
    parser.add_argument("--id")
    parser.add_argument("--sample-submission")
    parser.add_argument("--task", default="auto", choices=["auto", "binary", "multiclass", "regression"])
    parser.add_argument("--metric")
    parser.add_argument("--split", default="auto", choices=["auto", "kfold", "stratified", "group", "time"])
    parser.add_argument("--group-col")
    parser.add_argument("--time-col")
    parser.add_argument("--dayfirst", action="store_true")
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument(
        "--models", default="dummy,linear,lightgbm",
        help="catboost добавлять отдельно: на 36 тыс. строк он в десятки раз медленнее lightgbm",
    )
    parser.add_argument("--drop", nargs="*", default=[])
    parser.add_argument("--name", default="baseline")
    parser.add_argument("--seed", type=int, default=common.SEED)
    return parser


if __name__ == "__main__":
    run(build_parser().parse_args())
