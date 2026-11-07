# Data Challenge

Заготовка под разбор данных: профиль таблицы, поиск утечек, базовая модель, RFM-сегментация и проверка файла сдачи. Правила работы описаны в [AGENTS.md](AGENTS.md).

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

## Сервер

API для интерфейса `web/` на FastAPI, данные в SQLite (`outputs/server/cqa.sqlite3`, в git не попадает, переживает перезапуск). Настройки в `.env` в корне, образец без секретов в `.env.example`.

```bash
.venv/Scripts/python.exe -m uvicorn app.server.main:app --host 127.0.0.1 --port 8000
```

- Открыть `http://127.0.0.1:8000/`: если в корне есть `web/`, сервер отдаёт интерфейс; описание API на `http://127.0.0.1:8000/api/docs`.
- `CQA_PROVIDER=mock` включает тестовый режим без модели и без расходов. По умолчанию `anthropic`, нужен `ANTHROPIC_API_KEY`.
- Загрузить DEV: `POST /api/dialogs/import` с `{"group_id": "DEV"}`, адрес API организаторов берётся из `CQA_API_URL`.
- Сервер слушает только `127.0.0.1`. Интерфейс на другом порту указывается явно в `CQA_CORS_ORIGINS`, `*` запрещён.

## Проверка

```bash
export PYTHONUTF8=1
.venv/Scripts/python.exe -m pytest -q
.venv/Scripts/python.exe rehearsal/smoke_env.py
.venv/Scripts/python.exe rehearsal/run_rehearsal.py
```

Первая команда проверяет логику скриптов, вторая библиотеки на этой машине, третья всю цепочку на открытых данных UCI (скачивает около 25 МБ, занимает до 5 минут).
