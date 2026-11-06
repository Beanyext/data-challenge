import numpy as np
import pandas as pd

import common
import profile_data


def test_reads_excel_style_csv(tmp_path):
    path = tmp_path / "выгрузка.csv"
    path.write_bytes("город;сумма\nАстана;10\nАлматы;20\n".encode("cp1251"))
    df = common.read_table(path)
    assert list(df.columns) == ["город", "сумма"]
    assert df["город"].tolist() == ["Астана", "Алматы"]


def test_reads_utf8_with_bom(tmp_path):
    path = tmp_path / "a.csv"
    path.write_bytes("﻿город,сумма\nАстана,10\n".encode("utf-8"))
    assert list(common.read_table(path).columns) == ["город", "сумма"]


def test_parse_amount_handles_spaces_and_commas():
    parsed = common.parse_amount(pd.Series(["1 234,50", "7", "нет"]))
    assert parsed.iloc[0] == 1234.5
    assert parsed.iloc[1] == 7
    assert np.isnan(parsed.iloc[2])


def _sensitive_frame():
    return pd.DataFrame({
        "segment": ["СЕКРЕТНЫЙ_ТАРИФ"] * 50 + ["ВТОРОЙ_ТАРИФ"] * 50,
        "client_phone": ["+77011112233"] * 100,
        "amount": np.arange(100.0),
    })


def test_profile_hides_values_by_default():
    text = profile_data.profile(_sensitive_frame(), "t")
    assert "СЕКРЕТНЫЙ_ТАРИФ" not in text
    assert "+77011112233" not in text
    assert "возможны личные данные" in text


def test_profile_never_shows_personal_fields_even_with_values():
    text = profile_data.profile(_sensitive_frame(), "t", values=True)
    assert "СЕКРЕТНЫЙ_ТАРИФ" in text
    assert "+77011112233" not in text
