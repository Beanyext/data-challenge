"""Проверка окружения вживую: библиотеки, запись моделей, кириллица в данных, видеокарта, ноутбук, streamlit."""
from __future__ import annotations

import json
import subprocess
import sys
import time
import traceback
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "outputs" / "smoke"
WORK.mkdir(parents=True, exist_ok=True)
results: list[tuple[str, str, str]] = []


def check(name, required=True):
    def wrap(fn):
        started = time.time()
        try:
            note = fn() or ""
            results.append(("ок", name, f"{note} [{time.time() - started:.1f} с]"))
        except Exception as exc:  # noqa: BLE001
            status = "СБОЙ" if required else "нет"
            results.append((status, name, f"{type(exc).__name__}: {str(exc)[:220]}"))
            if required:
                traceback.print_exc(limit=2)
        print(f"{results[-1][0]:5s}{results[-1][1]}: {results[-1][2]}", flush=True)
    return wrap


def small_data(n=2000):
    import numpy as np

    rng = np.random.default_rng(0)
    X = rng.normal(size=(n, 5))
    return X, (X[:, 0] + X[:, 1] > 0).astype(int)


@check("версии")
def versions():
    import importlib.metadata as md

    names = ["numpy", "pandas", "scikit-learn", "lightgbm", "catboost", "xgboost", "duckdb", "shap", "optuna"]
    return f"Python {sys.version.split()[0]}; " + ", ".join(f"{n} {md.version(n)}" for n in names)


@check("LightGBM: запись и чтение модели через joblib")
def lgb_joblib():
    import joblib
    import lightgbm as lgb

    X, y = small_data()
    model = lgb.LGBMClassifier(n_estimators=10, verbose=-1).fit(X, y)
    path = WORK / "model_lgb.joblib"
    joblib.dump(model, path)
    return f"размер {path.stat().st_size}, прогноз после чтения {joblib.load(path).predict_proba(X[:1])[0, 1]:.3f}"


@check("LightGBM: родной save_model на этом пути", required=False)
def lgb_native():
    import lightgbm as lgb

    X, y = small_data()
    booster = lgb.train({"objective": "binary", "verbose": -1}, lgb.Dataset(X, y), 10)
    booster.save_model(str(WORK / "model_lgb.txt"))


@check("XGBoost: запись и чтение модели")
def xgb_path():
    import xgboost as xgb

    X, y = small_data()
    model = xgb.XGBClassifier(n_estimators=10, verbosity=0).fit(X, y)
    path = WORK / "model_xgb.json"
    model.save_model(str(path))
    other = xgb.XGBClassifier()
    other.load_model(str(path))
    return f"размер {path.stat().st_size}, прогноз после чтения {other.predict_proba(X[:1])[0, 1]:.3f}"


@check("CatBoost: запись и чтение модели")
def cat_path():
    from catboost import CatBoostClassifier

    X, y = small_data()
    model = CatBoostClassifier(iterations=10, verbose=0, allow_writing_files=False).fit(X, y)
    path = WORK / "model_cat.cbm"
    model.save_model(str(path))
    other = CatBoostClassifier().load_model(str(path))
    return f"размер {path.stat().st_size}, прогноз после чтения {other.predict_proba(X[:1])[0, 1]:.3f}"


@check("CatBoost: обучение с настройками по умолчанию")
def cat_default():
    from catboost import CatBoostClassifier

    X, y = small_data()
    CatBoostClassifier(iterations=10, verbose=0).fit(X, y)


@check("CatBoost: полный путь в train_dir", required=False)
def cat_train_dir():
    from catboost import CatBoostClassifier

    X, y = small_data()
    CatBoostClassifier(iterations=10, verbose=0, train_dir=str(WORK / "catboost_info")).fit(X, y)


@check("LightGBM: кириллица в названиях колонок")
def lgb_columns():
    import lightgbm as lgb
    import pandas as pd

    X, y = small_data()
    df = pd.DataFrame(X, columns=["сумма", "возраст", "доход клиента", "срок", "остаток"])
    return f"важность по {len(lgb.LGBMClassifier(n_estimators=10, verbose=-1).fit(df, y).feature_name_)} колонкам"


@check("XGBoost: кириллица в названиях колонок")
def xgb_columns():
    import pandas as pd
    import xgboost as xgb

    X, y = small_data()
    df = pd.DataFrame(X, columns=["сумма", "возраст", "доход клиента", "срок", "остаток"])
    xgb.XGBClassifier(n_estimators=10, verbosity=0).fit(df, y)


@check("Видеокарта: XGBoost", required=False)
def xgb_gpu():
    import xgboost as xgb

    X, y = small_data(50_000)
    model = xgb.XGBClassifier(n_estimators=50, device="cuda", tree_method="hist", verbosity=0).fit(X, y)
    config = json.loads(model.get_booster().save_config())
    device = config["learner"]["generic_param"]["device"]
    assert device == "cuda", device
    return f"устройство в настройках модели: {device}"


@check("Видеокарта: CatBoost", required=False)
def cat_gpu():
    from catboost import CatBoostClassifier

    X, y = small_data(50_000)
    model = CatBoostClassifier(iterations=50, verbose=0, task_type="GPU", allow_writing_files=False).fit(X, y)
    return f"устройство в настройках модели: {model.get_all_params().get('task_type')}"


@check("Видеокарта: LightGBM", required=False)
def lgb_gpu():
    import lightgbm as lgb

    X, y = small_data(50_000)
    lgb.LGBMClassifier(n_estimators=20, device="gpu", verbose=-1).fit(X, y)


@check("Скорость: LightGBM, 1 млн строк, 30 признаков, 100 деревьев")
def speed():
    import lightgbm as lgb
    import numpy as np

    rng = np.random.default_rng(0)
    X = rng.normal(size=(1_000_000, 30))
    y = (X[:, 0] + rng.normal(size=len(X)) > 0).astype(int)
    lgb.LGBMClassifier(n_estimators=100, verbose=-1).fit(X, y)


@check("DuckDB и Parquet, кириллица в имени файла и колонках")
def duck():
    import duckdb
    import pandas as pd

    path = WORK / "таблица.parquet"
    pd.DataFrame({"город": ["Астана", "Алматы"], "сумма": [1, 2]}).to_parquet(path)
    value = duckdb.sql(f"select sum(сумма) from read_parquet('{path.as_posix()}')").fetchall()[0][0]
    assert value == 3
    return f"сумма {value}"


@check("Excel, кириллица в имени файла и колонках")
def excel():
    import pandas as pd

    path = WORK / "таблица.xlsx"
    pd.DataFrame({"город": ["Астана"]}).to_excel(path, index=False)
    assert pd.read_excel(path)["город"][0] == "Астана"


@check("Графики с кириллицей, без потерянных символов")
def plots():
    import warnings

    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import plotly.express as px
    import seaborn as sns

    with warnings.catch_warnings():
        warnings.simplefilter("error")
        fig, ax = plt.subplots()
        sns.barplot(x=["Астана", "Алматы"], y=[1, 2], ax=ax)
        ax.set_title("Доля клиентов, қазақша әріптер")
        fig.savefig(WORK / "график.png")
        plt.close(fig)
    px.bar(x=["Астана"], y=[1]).write_html(WORK / "график.html")


@check("SHAP, Optuna, statsmodels")
def explain():
    import lightgbm as lgb
    import numpy as np
    import optuna
    import shap
    import statsmodels.api as sm

    X, y = small_data()
    model = lgb.LGBMClassifier(n_estimators=20, verbose=-1).fit(X, y)
    values = shap.TreeExplainer(model).shap_values(X[:100])
    top = int(np.argmax(np.abs(np.asarray(values)).mean(axis=0)))
    assert top in (0, 1)

    optuna.logging.set_verbosity(optuna.logging.WARNING)
    study = optuna.create_study()
    study.optimize(lambda t: (t.suggest_float("x", -1, 1) - 0.5) ** 2, n_trials=20)

    fit = sm.OLS(y, sm.add_constant(X)).fit()
    return f"главный признак {top}; optuna {study.best_value:.4f}; R² {fit.rsquared:.2f}"


@check("Ноутбук выполняется")
def notebook():
    import nbformat
    from nbclient import NotebookClient
    from nbformat.v4 import new_code_cell, new_notebook

    nb = new_notebook(cells=[new_code_cell("import pandas as pd\nprint(pd.DataFrame({'а': [1, 2]}).sum().iloc[0])")])
    NotebookClient(nb, timeout=120, kernel_name="python3").execute(cwd=str(WORK))
    text = nb.cells[0].outputs[0]["text"].strip()
    assert text == "3"
    nbformat.write(nb, WORK / "проба.ipynb")
    return f"вывод ячейки {text}"


@check("Streamlit: настройки, ответ, только локальный адрес")
def streamlit():
    shown = subprocess.run(
        [sys.executable, "-m", "streamlit", "config", "show"],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace",
    ).stdout
    for line in ("gatherUsageStats = false", 'address = "127.0.0.1"', "headless = true", "showEmailPrompt = false"):
        assert line in shown, f"настройка не применилась: {line}"

    app = WORK / "приложение.py"
    app.write_text("import streamlit as st\nst.write('проба')\n", encoding="utf-8")
    port = "8599"
    proc = subprocess.Popen(
        [sys.executable, "-m", "streamlit", "run", str(app), "--server.port", port],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(60):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/_stcore/health", timeout=2) as resp:
                    answer = resp.read().decode()
                break
            except OSError:
                time.sleep(1)
        else:
            raise TimeoutError("нет ответа за 60 с")
        netstat = subprocess.run(["netstat", "-ano"], capture_output=True, text=True, errors="replace").stdout
        local = [
            parts[1]
            for parts in (line.split() for line in netstat.splitlines())
            if len(parts) >= 4 and parts[0].startswith("TCP") and parts[1].endswith(f":{port}") and parts[3] == "LISTENING"
        ]
        assert local and all(a.startswith("127.0.0.1:") for a in local), f"слушает {local}"
        return f"ответ {answer}; слушает {local}"
    finally:
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)


failed = [r for r in results if r[0] == "СБОЙ"]
print(f"\nИтог: ок {sum(r[0] == 'ок' for r in results)}, сбоев {len(failed)}, необязательных недоступно {sum(r[0] == 'нет' for r in results)}")
sys.exit(1 if failed else 0)
