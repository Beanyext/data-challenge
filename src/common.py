"""Общие помощники: чтение таблиц, кодирование признаков, пути вывода."""
from __future__ import annotations

import codecs
import os
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
WORK = Path(os.environ.get("DC_WORK_DIR", ROOT))
REPORTS = WORK / "reports"
OUTPUTS = WORK / "outputs"
SEED = 42
NA_TOKEN = "__NA__"


def sniff_csv(path: str | Path, sample_bytes: int = 1 << 20) -> tuple[str, str]:
    """Определяет кодировку (UTF-8 или cp1251) и разделитель по началу файла."""
    with open(path, "rb") as fh:
        raw = fh.read(sample_bytes)
    encoding = "utf-8-sig"
    try:
        codecs.getincrementaldecoder("utf-8-sig")().decode(raw, final=False)
    except UnicodeDecodeError:
        encoding = "cp1251"
    text = raw.decode(encoding, errors="ignore")
    header = text.splitlines()[0] if text else ""
    sep = max([",", ";", "\t", "|"], key=header.count)
    return encoding, sep


def read_table(path: str | Path) -> pd.DataFrame:
    """Читает csv, tsv, txt, parquet или xlsx."""
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix in {".parquet", ".pq"}:
        return pd.read_parquet(path)
    if suffix == ".xlsx":
        return pd.read_excel(path)
    if suffix in {".csv", ".tsv", ".txt"}:
        encoding, sep = sniff_csv(path)
        return pd.read_csv(path, encoding=encoding, sep=sep, low_memory=False)
    raise SystemExit(f"Формат {suffix} не поддержан: {path}")


def is_text(series: pd.Series) -> bool:
    return not (
        pd.api.types.is_numeric_dtype(series)
        or pd.api.types.is_datetime64_any_dtype(series)
    )


def to_seconds(series: pd.Series) -> pd.Series:
    return (series - pd.Timestamp("1970-01-01")).dt.total_seconds()


def to_numeric_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Таблица только из чисел для быстрых проверок: текст заменяется номером значения."""
    out = {}
    for col in df.columns:
        s = df[col]
        if pd.api.types.is_datetime64_any_dtype(s):
            out[col] = to_seconds(s).fillna(-999.0)
        elif pd.api.types.is_numeric_dtype(s):
            out[col] = s.astype(float).replace([np.inf, -np.inf], np.nan).fillna(-999.0)
        else:
            out[col] = pd.Series(
                pd.factorize(s.astype("string"), sort=True)[0].astype(float), index=df.index
            )
    return pd.DataFrame(out, index=df.index)


def parse_amount(series: pd.Series) -> pd.Series:
    """Сумма в числа, в том числе из записи вида «1 234,50»."""
    if pd.api.types.is_numeric_dtype(series):
        return series.astype(float)
    cleaned = (
        series.astype("string")
        .str.replace(r"\s", "", regex=True)
        .str.replace(",", ".", regex=False)
    )
    return pd.to_numeric(cleaned, errors="coerce").astype(float)


def write_report(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def md_table(headers: list[str], rows: list[list[object]]) -> str:
    lines = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    lines += ["| " + " | ".join(str(c) for c in row) + " |" for row in rows]
    return "\n".join(lines)
