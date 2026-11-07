"""Файлы сдачи results/dev/results.json и results/prod/results.json в формате организаторов 1.0.

Формат и правила: reports/условие.md, раздел «Сдача результатов».

Команды из корня репозитория:
    python -m app.results build --data data/raw/dev.json --evals outputs/eval/<папка> --out results/dev/results.json
    python -m app.results check results/dev/results.json --data data/raw/dev.json
    python -m app.results control --group-id <ID> --out results/prod/results.json --expect 10
"""
