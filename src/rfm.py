"""RFM-сегментация клиентов по таблице операций: правила и кластеры.

R (давность) — дней от последней покупки до даты расчёта.
F (частота) — число разных покупок. M (деньги) — сумма покупок за вычетом возвратов.

Запуск: python src/rfm.py --tx data/raw/tx.csv --customer client_id --date dt --amount sum [--order order_id]
            [--asof 2026-01-01] [--k 4] [--dayfirst]
"""
from __future__ import annotations

import argparse

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import adjusted_rand_score, silhouette_score
from sklearn.preprocessing import StandardScaler

import common

SEGMENT_ORDER = ["Чемпионы", "Лояльные", "Новые", "Перспективные", "Под угрозой ухода", "Спящие"]
K_RANGE = range(2, 9)
STABILITY_SEEDS = 5
MAX_SILHOUETTE_ROWS = 10_000


def segment_name(r: int, f: int, m: int) -> str:
    """Стартовые правила. Если организаторы задают свою методику, она важнее."""
    if r >= 4 and f >= 4 and m >= 4:
        return "Чемпионы"
    if r >= 3 and f >= 4:
        return "Лояльные"
    if r >= 4 and f <= 2:
        return "Новые"
    if r >= 3:
        return "Перспективные"
    if f >= 3 or m >= 4:
        return "Под угрозой ухода"
    return "Спящие"


def quantile_score(values: pd.Series, higher_is_better: bool = True) -> pd.Series:
    """Балл от 1 до 5 по доле в рейтинге. Одинаковые значения получают один балл."""
    pct = values.rank(pct=True, method="average", ascending=higher_is_better)
    return np.ceil(pct * 5).clip(1, 5).astype(int)


def clean_transactions(
    tx: pd.DataFrame, customer: str, date: str, amount: str, dayfirst: bool
) -> tuple[pd.DataFrame, dict[str, int]]:
    log = {"строк на входе": len(tx)}
    out = pd.DataFrame({
        "customer": tx[customer],
        "amount": common.parse_amount(tx[amount]),
    })
    if pd.api.types.is_datetime64_any_dtype(tx[date]):
        out["date"] = tx[date]
    else:
        out["date"] = pd.to_datetime(tx[date], errors="coerce", format="mixed", dayfirst=dayfirst)
    log["без клиента"] = int(out["customer"].isna().sum())
    log["дата не разобрана"] = int(out["date"].isna().sum())
    log["сумма не разобрана"] = int(out["amount"].isna().sum())
    return out, log


def compute_rfm(
    tx: pd.DataFrame,
    customer: str,
    date: str,
    amount: str,
    order: str | None = None,
    asof: str | None = None,
    dayfirst: bool = False,
) -> tuple[pd.DataFrame, dict[str, int], pd.Timestamp]:
    clean, log = clean_transactions(tx, customer, date, amount, dayfirst)
    clean["order"] = tx[order] if order else np.arange(len(tx))
    clean = clean.dropna(subset=["customer", "date", "amount"])
    log["строк после очистки"] = len(clean)
    log["возвраты и нулевые суммы"] = int((clean["amount"] <= 0).sum())

    purchases = clean[clean["amount"] > 0]
    asof_ts = pd.Timestamp(asof) if asof else purchases["date"].max().normalize() + pd.Timedelta(days=1)
    future = int((purchases["date"] > asof_ts).sum())
    if future:
        log["покупки позже даты расчёта, исключены"] = future
        keep = clean["date"] <= asof_ts
        clean, purchases = clean[keep], purchases[purchases["date"] <= asof_ts]

    per_customer = purchases.groupby("customer").agg(
        last=("date", "max"), frequency=("order", "nunique")
    )
    per_customer["recency"] = (asof_ts - per_customer["last"]).dt.days
    per_customer["monetary"] = clean.groupby("customer")["amount"].sum().reindex(per_customer.index)
    log["клиентов всего"] = int(clean["customer"].nunique())
    log["клиентов только с возвратами, исключены"] = int(clean["customer"].nunique() - len(per_customer))

    rfm = per_customer.drop(columns="last").reset_index()
    rfm["r_score"] = quantile_score(rfm["recency"], higher_is_better=False)
    rfm["f_score"] = quantile_score(rfm["frequency"])
    rfm["m_score"] = quantile_score(rfm["monetary"])
    rfm["segment"] = [
        segment_name(r, f, m) for r, f, m in zip(rfm["r_score"], rfm["f_score"], rfm["m_score"])
    ]
    return rfm, log, asof_ts


def cluster(rfm: pd.DataFrame, k: int | None, seed: int) -> tuple[pd.Series, list[list[object]], float, int]:
    """KMeans на логарифмах: суммы сильно скошены, иначе кластеры задаёт один крупный клиент."""
    features = np.column_stack([
        np.log1p(rfm["recency"]),
        np.log1p(rfm["frequency"]),
        np.log1p(rfm["monetary"].clip(lower=0)),
    ])
    X = StandardScaler().fit_transform(features)
    sample = min(len(X), MAX_SILHOUETTE_ROWS)

    table = []
    best_k, best_score = 2, -1.0
    for candidate in K_RANGE:
        if candidate >= len(X):
            break
        labels = KMeans(candidate, n_init=10, random_state=seed).fit_predict(X)
        value = float(silhouette_score(X, labels, sample_size=sample, random_state=seed))
        table.append([candidate, f"{value:.3f}"])
        if value > best_score:
            best_k, best_score = candidate, value

    chosen = k or best_k
    runs = [
        KMeans(chosen, n_init=10, random_state=seed + i).fit_predict(X)
        for i in range(STABILITY_SEEDS)
    ]
    stability = float(np.mean([adjusted_rand_score(runs[0], other) for other in runs[1:]]))
    return pd.Series(runs[0], index=rfm.index), table, stability, chosen


def summary(rfm: pd.DataFrame, by: str, order: list | None = None) -> list[list[object]]:
    revenue = rfm["monetary"].clip(lower=0).sum()
    grouped = rfm.groupby(by)
    keys = order if order is not None else sorted(grouped.groups)
    rows = []
    for key in keys:
        if key not in grouped.groups:
            continue
        g = grouped.get_group(key)
        rows.append([
            key,
            len(g),
            f"{len(g) / len(rfm):.1%}",
            f"{g['recency'].median():.0f}",
            f"{g['frequency'].median():.0f}",
            f"{g['monetary'].median():,.0f}",
            f"{g['monetary'].clip(lower=0).sum() / revenue:.1%}" if revenue else "нет",
        ])
    return rows


def save_figure(rfm: pd.DataFrame, path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    revenue = rfm["monetary"].clip(lower=0).sum()
    grouped = rfm.groupby("segment")
    names = [s for s in SEGMENT_ORDER if s in grouped.groups][::-1]
    y = np.arange(len(names))
    fig, ax = plt.subplots(figsize=(9, 4.5))
    ax.barh(y + 0.2, [100 * len(grouped.get_group(n)) / len(rfm) for n in names], 0.4, label="Доля клиентов", color="#8AA4C8")
    ax.barh(y - 0.2, [100 * grouped.get_group(n)["monetary"].clip(lower=0).sum() / revenue for n in names], 0.4, label="Доля выручки", color="#1F4E8C")
    ax.set_yticks(y, names)
    ax.set_xlabel("%")
    ax.legend(frameon=False)
    ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=160)
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--tx", required=True)
    parser.add_argument("--customer", required=True)
    parser.add_argument("--date", required=True)
    parser.add_argument("--amount", required=True)
    parser.add_argument("--order", help="номер покупки; без него каждая строка считается покупкой")
    parser.add_argument("--asof", help="дата расчёта, по умолчанию день после последней покупки")
    parser.add_argument("--k", type=int, help="число кластеров, по умолчанию лучшее по силуэту")
    parser.add_argument("--dayfirst", action="store_true", help="даты в виде ДД.ММ.ГГГГ")
    parser.add_argument("--seed", type=int, default=common.SEED)
    args = parser.parse_args()

    tx = common.read_table(args.tx)
    rfm, log, asof = compute_rfm(tx, args.customer, args.date, args.amount, args.order, args.asof, args.dayfirst)
    rfm["cluster"], k_table, stability, chosen = cluster(rfm, args.k, args.seed)

    customers_path = common.OUTPUTS / "rfm_customers.csv"
    customers_path.parent.mkdir(parents=True, exist_ok=True)
    rfm.to_csv(customers_path, index=False)
    figure_path = common.REPORTS / "figures" / "rfm_segments.png"
    save_figure(rfm, figure_path)

    headers = ["Группа", "Клиентов", "Доля", "Давность, медиана", "Частота, медиана", "Сумма, медиана", "Доля выручки"]
    text = "\n".join([
        "# RFM-сегментация",
        "",
        f"Дата расчёта: {asof:%Y-%m-%d}. Клиентов в расчёте: {len(rfm)}.",
        "",
        "## Очистка",
        "",
        common.md_table(["Что", "Количество"], [[k, v] for k, v in log.items()]),
        "",
        "## Сегменты по правилам",
        "",
        common.md_table(headers, summary(rfm, "segment", SEGMENT_ORDER)),
        "",
        "## Кластеры",
        "",
        f"Выбрано кластеров: {chosen}. Совпадение разбиений при разных запусках (ARI): {stability:.3f}.",
        "",
        common.md_table(["k", "Силуэт"], k_table),
        "",
        common.md_table(headers, summary(rfm, "cluster")),
        "",
    ])
    report_path = common.REPORTS / "rfm_segments.md"
    common.write_report(report_path, text)
    print(text)
    print(f"Сохранено: {report_path}\n{customers_path}\n{figure_path}")


if __name__ == "__main__":
    main()
