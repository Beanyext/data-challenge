"""Репетиция всей цепочки на открытых данных. Пишет только в outputs/rehearsal.

Предсказание: банковский маркетинг (UCI). Сегментация: Online Retail (UCI).
"""
from __future__ import annotations

import io
import os
import subprocess
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "outputs" / "rehearsal"
DATA = WORK / "data"
BANK_URL = "https://archive.ics.uci.edu/static/public/222/bank+marketing.zip"
RETAIL_URL = "https://archive.ics.uci.edu/static/public/352/online+retail.zip"
ENV = {**os.environ, "DC_WORK_DIR": str(WORK), "PYTHONUTF8": "1"}


def step(title: str, *args: str, expect_fail: bool = False) -> str:
    print(f"\n=== {title}", flush=True)
    started = time.time()
    done = subprocess.run(
        [sys.executable, *args], cwd=ROOT, env=ENV, capture_output=True, text=True, encoding="utf-8"
    )
    print(done.stdout[-3500:])
    if done.stderr.strip() and done.returncode:
        print(done.stderr[-1500:])
    failed = done.returncode != 0
    if failed != expect_fail:
        raise SystemExit(f"Шаг «{title}»: код {done.returncode}")
    print(f"--- {time.time() - started:.1f} с", flush=True)
    return done.stdout


def prepare_prediction() -> dict[str, Path]:
    """Имитирует то, что выдаст организатор: train и test без ответов, образец, выгрузка из Excel."""
    archive = DATA / "bank_marketing.zip"
    if not archive.exists():
        urllib.request.urlretrieve(BANK_URL, archive)
    with zipfile.ZipFile(archive) as outer, zipfile.ZipFile(io.BytesIO(outer.read("bank.zip"))) as inner:
        with inner.open("bank-full.csv") as fh:
            df = pd.read_csv(fh, sep=";")
    df = df.rename(columns={"y": "target"})
    df.insert(0, "id", np.arange(100000, 100000 + len(df)))
    df["регион"] = np.random.default_rng(0).choice(["Астана", "Алматы", "Шымкент"], size=len(df))
    train, test = train_test_split(df, test_size=0.2, random_state=0, stratify=df["target"])

    paths = {k: DATA / f"{k}.csv" for k in ("train", "test", "sample", "answers", "train_leak", "test_shift")}
    train.to_csv(paths["train"], index=False, sep=";", encoding="cp1251")
    test.drop(columns="target").to_csv(paths["test"], index=False)
    pd.DataFrame({"id": test["id"].sample(frac=1, random_state=1).to_numpy(), "target": 0.5}).to_csv(paths["sample"], index=False)
    test[["id", "target"]].to_csv(paths["answers"], index=False)

    leak = train.copy()
    leak["статус_после_звонка"] = pd.factorize(leak["target"].astype(str), sort=True)[0]
    leak.to_csv(paths["train_leak"], index=False)
    shifted = test.drop(columns="target").copy()
    shifted["age"] = shifted["age"].astype(float) + 25
    shifted.to_csv(paths["test_shift"], index=False)
    print(f"Предсказание: train {len(train)}, test {len(test)}, положительных {(df['target'] == 'yes').mean():.1%}")
    return paths


def prepare_retail() -> Path:
    archive = DATA / "online_retail.zip"
    target = DATA / "retail"
    if not archive.exists():
        urllib.request.urlretrieve(RETAIL_URL, archive)
    with zipfile.ZipFile(archive) as zf:
        zf.extractall(target)
    tx = pd.read_excel(target / "Online Retail.xlsx")
    tx["amount"] = tx["Quantity"] * tx["UnitPrice"]
    path = DATA / "retail_tx.csv"
    tx[["CustomerID", "InvoiceNo", "InvoiceDate", "amount"]].to_csv(path, index=False)
    print(f"Сегментация: строк {len(tx)}, без клиента {tx['CustomerID'].isna().mean():.1%}, отрицательных сумм {(tx['amount'] < 0).mean():.1%}")
    return path


def main() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    paths = prepare_prediction()
    train, test, sample = map(str, (paths["train"], paths["test"], paths["sample"]))

    step("Профиль без значений", "src/profile_data.py", train)
    step("Поиск утечек, чистые данные", "src/leak_check.py", "--train", train, "--target", "target", "--test", test, "--id", "id")
    out = step("Поиск утечек, подложенная колонка", "src/leak_check.py", "--train", str(paths["train_leak"]), "--target", "target", "--id", "id")
    assert "статус_после_звонка" in out.split("Подозрение на утечку")[1], "утечка не найдена"
    out = step("Различие train и test, подложенный сдвиг", "src/leak_check.py", "--train", train, "--target", "target", "--test", str(paths["test_shift"]), "--id", "id")
    assert "различаются" in out, "сдвиг не найден"

    out = step(
        "Базовые модели и файл сдачи",
        "src/baseline.py", "--train", train, "--target", "target", "--test", test, "--id", "id",
        "--sample-submission", sample, "--name", "rehearsal",
    )
    best_cv = max(
        float(line.split()[2]) for line in out.splitlines()
        if line.split()[:1] and line.split()[0] in {"linear", "lightgbm", "catboost"}
    )
    submission = WORK / "outputs" / "submission_rehearsal.csv"
    step("Проверка файла сдачи", "src/check_submission.py", "--sample", sample, "--submission", str(submission), "--proba")

    broken = WORK / "outputs" / "submission_broken.csv"
    pd.read_csv(submission).iloc[:-1].to_csv(broken, index=False)
    step("Проверка ловит испорченный файл", "src/check_submission.py", "--sample", sample, "--submission", str(broken), "--proba", expect_fail=True)

    answers = pd.read_csv(paths["answers"])
    merged = pd.read_csv(submission).merge(answers, on="id", suffixes=("_pred", "_true"))
    positive = np.sort(answers["target"].unique())[1]
    holdout = roc_auc_score(merged["target_true"] == positive, merged["target_pred"])
    print(f"\nОценка на кросс-валидации {best_cv:.4f}, на скрытых ответах {holdout:.4f}, разница {holdout - best_cv:+.4f}")
    assert abs(holdout - best_cv) < 0.02, "оценка кросс-валидации расходится со скрытыми ответами"

    retail = str(prepare_retail())
    step(
        "RFM на грязных операциях",
        "src/rfm.py", "--tx", retail, "--customer", "CustomerID", "--date", "InvoiceDate",
        "--amount", "amount", "--order", "InvoiceNo",
    )
    print("\nРепетиция пройдена")


if __name__ == "__main__":
    main()
