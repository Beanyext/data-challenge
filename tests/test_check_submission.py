import numpy as np
import pandas as pd
import pytest

from check_submission import check, warnings_for


@pytest.fixture
def sample():
    return pd.DataFrame({"id": [1, 2, 3, 4], "pred": [0.5, 0.5, 0.5, 0.5]})


@pytest.fixture
def good():
    return pd.DataFrame({"id": [4, 3, 2, 1], "pred": [0.1, 0.2, 0.3, 0.4]})


def test_good_file_passes(sample, good):
    assert check(sample, good, proba=True) == []


def test_ids_int_and_float_are_same(sample, good):
    assert check(sample, good.assign(id=good["id"].astype(float))) == []


def test_wrong_columns(sample, good):
    assert check(sample, good.rename(columns={"pred": "target"}))


def test_wrong_column_order(sample, good):
    assert check(sample, good[["pred", "id"]])


def test_too_few_rows(sample, good):
    assert any("Строк" in e for e in check(sample, good.iloc[:3]))


def test_duplicate_id(sample, good):
    assert any("Повторов" in e for e in check(sample, good.assign(id=[1, 1, 2, 3])))


def test_foreign_id(sample, good):
    errors = check(sample, good.assign(id=[1, 2, 3, 99]))
    assert any("Лишних" in e for e in errors) and any("Нет идентификаторов" in e for e in errors)


def test_missing_prediction(sample, good):
    assert any("Пропуски" in e for e in check(sample, good.assign(pred=[0.1, np.nan, 0.3, 0.4])))


def test_infinity(sample, good):
    assert any("Бесконечность" in e for e in check(sample, good.assign(pred=[0.1, np.inf, 0.3, 0.4])))


def test_probability_out_of_range(sample, good):
    assert any("диапазона" in e for e in check(sample, good.assign(pred=[0.1, 1.5, 0.3, 0.4]), proba=True))


def test_text_instead_of_number(sample, good):
    assert any("ожидаются числа" in e for e in check(sample, good.assign(pred=["a", "b", "c", "d"])))


def test_constant_prediction_warns(good):
    assert warnings_for(good.assign(pred=0.5))
    assert not warnings_for(good)
