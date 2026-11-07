# Data Challenge

Прототип CQA для контроля качества диалогов: очередь проверки, оценка с доказательствами, версии чек-листа, апелляции, PDF-отчёт и подготовка результатов для сдачи. Общий интерфейс написан на React и TypeScript с JSX; доступны русский, английский и казахский языки. Правила работы описаны в [AGENTS.md](AGENTS.md).

Запуск интерфейса, сборка и API-контракт описаны в [`web/README.md`](web/README.md), правила сдачи — в [`results/README.md`](results/README.md). Готовый JavaScript включён в репозиторий: для просмотра достаточно статического HTTP-сервера, Node.js нужен для разработки и CLI-проверки результатов. Сервер команды развивается отдельно; в эту ветку он не включён. Ниже сохранены команды установки исходных Python-инструментов подготовки данных.

## Установка

Нужен [uv](https://docs.astral.sh/uv/). Данные организаторов положить в `data/raw/`, в git они не попадают. На Windows:

```bash
uv venv --python 3.12 .venv
uv pip sync requirements.lock --require-hashes --only-binary :all: --python .venv/Scripts/python.exe
```

На другой системе `requirements.lock` не подойдёт, он собран для Windows:

```bash
uv venv --python 3.12 .venv
uv pip install -r requirements.in --only-binary :all: --exclude-newer 2026-10-23 --python .venv/bin/python
```

## Проверка

```bash
export PYTHONUTF8=1
.venv/Scripts/python.exe -m pytest -q
.venv/Scripts/python.exe rehearsal/smoke_env.py
.venv/Scripts/python.exe rehearsal/run_rehearsal.py
```

Первая команда проверяет логику скриптов, вторая библиотеки на этой машине, третья всю цепочку на открытых данных UCI (скачивает около 25 МБ, занимает до 5 минут).
