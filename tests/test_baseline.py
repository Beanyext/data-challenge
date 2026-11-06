import numpy as np
import pandas as pd
import pytest

import baseline
import check_submission


def _dataset(tmp_path, n=800, seed=0, informative=True):
    rng = np.random.default_rng(seed)
    x = rng.normal(size=n)
    logit = 2.5 * x if informative else 0.0
    y = (rng.random(n) < 1 / (1 + np.exp(-logit))).astype(int)
    df = pd.DataFrame({
        "id": np.arange(n),
        "x": x,
        "регион": rng.choice(["Астана", "Алматы", None], size=n),
        "client": rng.integers(0, 80, size=n),
        "dt": pd.date_range("2026-01-01", periods=n, freq="h").astype(str),
        "y": y,
    })
    cut = int(n * 0.75)
    train, test = df.iloc[:cut], df.iloc[cut:].drop(columns="y")
    sample = pd.DataFrame({"id": test["id"][::-1].to_numpy(), "y": 0.5})
    paths = {name: tmp_path / f"{name}.csv" for name in ("train", "test", "sample")}
    train.to_csv(paths["train"], index=False)
    test.to_csv(paths["test"], index=False)
    sample.to_csv(paths["sample"], index=False)
    return paths, df


def _args(paths, *extra):
    return baseline.build_parser().parse_args([
        "--train", str(paths["train"]), "--target", "y", "--test", str(paths["test"]),
        "--id", "id", "--sample-submission", str(paths["sample"]), "--drop", "dt", "client", *extra,
    ])


def test_time_split_never_looks_ahead():
    times = np.repeat(np.arange(20), 5)
    splits = baseline.make_splits(np.zeros(100), "binary", "time", 4, 42, times=times)
    assert len(splits) == 4
    for tr, va in splits:
        assert times[tr].max() < times[va].min()


def test_group_split_keeps_groups_apart():
    groups = np.repeat(np.arange(25), 4)
    splits = baseline.make_splits(np.zeros(100), "binary", "group", 5, 42, groups=groups)
    for tr, va in splits:
        assert not set(groups[tr]) & set(groups[va])


def test_metric_task_mismatch_is_rejected():
    with pytest.raises(SystemExit):
        baseline.validate_metric("rmse", "binary")
    with pytest.raises(SystemExit):
        baseline.validate_metric("pr_auc", "multiclass")


def test_all_models_beat_nothing_and_file_is_valid(tmp_path):
    paths, _ = _dataset(tmp_path)
    outcome = baseline.run(_args(paths, "--folds", "3", "--models", "dummy,linear,lightgbm,catboost"))
    results = outcome["results"]
    assert set(results) == {"dummy", "linear", "lightgbm", "catboost"}
    assert results["dummy"]["mean"] == pytest.approx(0.5, abs=0.01)
    for model in ("linear", "lightgbm", "catboost"):
        assert results[model]["mean"] > 0.75
    sub = pd.read_csv(outcome["submission"])
    assert check_submission.check(pd.read_csv(paths["sample"]), sub, proba=True) == []
    assert sub["id"].tolist() == pd.read_csv(paths["sample"])["id"].tolist()


def test_noise_gives_no_fake_signal(tmp_path):
    paths, _ = _dataset(tmp_path, informative=False)
    results = baseline.run(_args(paths, "--folds", "3", "--models", "lightgbm"))["results"]
    assert results["lightgbm"]["mean"] < 0.6


def test_same_seed_same_score(tmp_path):
    paths, _ = _dataset(tmp_path)
    first = baseline.run(_args(paths, "--folds", "3", "--models", "lightgbm"))["results"]["lightgbm"]["mean"]
    second = baseline.run(_args(paths, "--folds", "3", "--models", "lightgbm"))["results"]["lightgbm"]["mean"]
    assert first == second


def test_group_and_time_modes_run(tmp_path):
    paths, _ = _dataset(tmp_path)
    grouped = baseline.build_parser().parse_args([
        "--train", str(paths["train"]), "--target", "y", "--group-col", "client",
        "--drop", "id", "dt", "--folds", "3", "--models", "dummy,lightgbm",
    ])
    assert baseline.run(grouped)["split"] == "group"
    timed = baseline.build_parser().parse_args([
        "--train", str(paths["train"]), "--target", "y", "--time-col", "dt",
        "--drop", "id", "client", "--folds", "3", "--models", "dummy,lightgbm",
    ])
    assert baseline.run(timed)["split"] == "time"


def test_regression_and_multiclass(tmp_path):
    rng = np.random.default_rng(0)
    x = rng.normal(size=400)
    reg = tmp_path / "reg.csv"
    pd.DataFrame({"x": x, "y": 3 * x + rng.normal(scale=0.1, size=400)}).to_csv(reg, index=False)
    args = baseline.build_parser().parse_args(["--train", str(reg), "--target", "y", "--folds", "3"])
    outcome = baseline.run(args)
    assert outcome["task"] == "regression"
    assert outcome["best"] != "dummy"

    multi = tmp_path / "multi.csv"
    pd.DataFrame({"x": x, "y": np.digitize(x, [-0.5, 0.5])}).to_csv(multi, index=False)
    args = baseline.build_parser().parse_args(["--train", str(multi), "--target", "y", "--folds", "3"])
    outcome = baseline.run(args)
    assert outcome["task"] == "multiclass"
    assert outcome["results"]["lightgbm"]["mean"] > 0.9


def test_experiment_is_logged(tmp_path):
    import common

    paths, _ = _dataset(tmp_path)
    baseline.run(_args(paths, "--folds", "3", "--models", "dummy", "--name", "проба"))
    log = pd.read_csv(common.REPORTS / "experiments.csv")
    assert log.iloc[-1]["name"] == "проба"
    assert log.iloc[-1]["metric"] == "roc_auc"
