import itertools

import pandas as pd
import pytest

import rfm


@pytest.fixture
def tx():
    return pd.DataFrame({
        "client": ["a", "a", "a", "b", "c", "d", None],
        "order": [1, 1, 2, 3, 4, 5, 6],
        "dt": ["2026-01-01", "2026-01-01", "2026-01-11", "2026-01-05", "2026-01-02", "2026-01-03", "2026-01-03"],
        "sum": [100.0, 50.0, 200.0, 300.0, -40.0, "1 000,50", 999.0],
    })


def _by_client(tx, **kwargs):
    table, log, asof = rfm.compute_rfm(tx, "client", "dt", "sum", "order", **kwargs)
    return table.set_index("customer"), log, asof


def test_rfm_values_by_hand(tx):
    table, _, asof = _by_client(tx, asof="2026-01-21")
    assert asof == pd.Timestamp("2026-01-21")
    assert table.loc["a", "recency"] == 10
    assert table.loc["a", "frequency"] == 2
    assert table.loc["a", "monetary"] == 350.0
    assert table.loc["d", "monetary"] == 1000.5


def test_refund_reduces_money_but_not_frequency():
    tx = pd.DataFrame({
        "client": ["a", "a", "b"],
        "order": [1, 2, 3],
        "dt": ["2026-01-01", "2026-01-10", "2026-01-01"],
        "sum": [100.0, -30.0, 10.0],
    })
    table, _, _ = _by_client(tx, asof="2026-01-21")
    assert table.loc["a", "monetary"] == 70.0
    assert table.loc["a", "frequency"] == 1
    assert table.loc["a", "recency"] == 20


def test_only_refund_client_is_excluded_and_counted(tx):
    table, log, _ = _by_client(tx)
    assert "c" not in table.index
    assert log["клиентов только с возвратами, исключены"] == 1
    assert log["без клиента"] == 1


def test_default_asof_is_day_after_last_purchase(tx):
    _, _, asof = _by_client(tx)
    assert asof == pd.Timestamp("2026-01-12")


def test_purchases_after_asof_are_ignored(tx):
    table, log, _ = _by_client(tx, asof="2026-01-08")
    assert log["покупки позже даты расчёта, исключены"] == 1
    assert table.loc["a", "monetary"] == 150.0


def test_every_score_combination_has_segment():
    names = {rfm.segment_name(*c) for c in itertools.product(range(1, 6), repeat=3)}
    assert names == set(rfm.SEGMENT_ORDER)


def test_segment_extremes():
    assert rfm.segment_name(5, 5, 5) == "Чемпионы"
    assert rfm.segment_name(1, 1, 1) == "Спящие"
    assert rfm.segment_name(1, 5, 5) == "Под угрозой ухода"
    assert rfm.segment_name(5, 1, 1) == "Новые"


def test_quantile_score_direction_and_ties():
    values = pd.Series([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    assert rfm.quantile_score(values).tolist() == [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]
    assert rfm.quantile_score(values, higher_is_better=False).tolist() == [5, 5, 4, 4, 3, 3, 2, 2, 1, 1]
    assert rfm.quantile_score(pd.Series([1, 1, 1, 1])).nunique() == 1


def test_cluster_finds_two_clear_groups():
    table = pd.DataFrame({
        "recency": [5] * 50 + [400] * 50,
        "frequency": [30] * 50 + [1] * 50,
        "monetary": [10000.0] * 50 + [10.0] * 50,
    })
    labels, _, stability, k = rfm.cluster(table, None, seed=42)
    assert k == 2
    assert stability > 0.99
    assert labels.iloc[:50].nunique() == 1
    assert labels.iloc[0] != labels.iloc[-1]
