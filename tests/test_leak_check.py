import numpy as np
import pandas as pd

import leak_check


def _frame(n=2000, seed=0):
    rng = np.random.default_rng(seed)
    signal = rng.normal(size=n)
    y = (signal + rng.normal(scale=1.5, size=n) > 0).astype(int)
    return pd.DataFrame({
        "signal": signal,
        "noise": rng.normal(size=n),
        "group": rng.choice(["а", "б", "в"], size=n),
        "y": y,
    })


def test_clean_data_has_no_leak():
    assert leak_check.run(_frame(), "y", None, [])["leaks"] == []


def test_planted_leak_is_found():
    df = _frame()
    df["after_event"] = df["y"] * 10 + np.random.default_rng(1).normal(scale=0.1, size=len(df))
    assert leak_check.run(df, "y", None, [])["leaks"] == ["after_event"]


def test_ignored_column_is_skipped():
    df = _frame()
    df["after_event"] = df["y"]
    assert leak_check.run(df, "y", None, ["after_event"])["leaks"] == []


def test_regression_target_leak():
    df = _frame().drop(columns="y")
    df["y"] = df["signal"] * 3.0
    assert "signal" in leak_check.run(df, "y", None, [])["leaks"]


def test_same_distribution_has_no_drift():
    train, test = _frame(seed=0), _frame(seed=1).drop(columns="y")
    result = leak_check.run(train, "y", test, [])
    assert not result["drift"]
    assert 0.4 < result["adversarial_auc"] < 0.6


def test_shifted_test_is_found():
    train, test = _frame(seed=0), _frame(seed=1).drop(columns="y")
    test["noise"] += 3.0
    result = leak_check.run(train, "y", test, [])
    assert result["drift"]
    assert result["importance"].index[0] == "noise"


def test_report_contains_no_values():
    df = _frame()
    df["group"] = "СЕКРЕТ"
    assert "СЕКРЕТ" not in leak_check.report(leak_check.run(df, "y", None, []))
