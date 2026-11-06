# Правила проекта Data Challenge

Для всех ИИ-помощников команды (Claude Code и Codex) и для людей.

## Порядок работы

1. **Условие.** Записать в `reports/условие.md` метрику, формат сдачи, срок и критерии жюри. Сверять с ними каждое решение.
2. **Правила о данных.** До первого чтения данных выяснить, можно ли отправлять их во внешний ИИ. Вывод команд уходит модели. Если нельзя или ответа нет, смотреть только через `src/profile_data.py` без `--values`, строки данных не выводить.
3. **Профиль.** `src/profile_data.py`: типы, пропуски, дубли.
4. **Проверка.** Сначала схема валидации, совпадающая с тем, как будут оценивать, потом `src/leak_check.py`.
5. **База.** `src/baseline.py` даёт оценку и файл сдачи. Первый рабочий файл сдачи должен появиться как можно раньше.
6. **Улучшения.** Одна гипотеза, один запуск, строка в `reports/experiments.csv`. Прибавка меньше разброса между частями не считается улучшением.
7. **Сдача.** `src/check_submission.py`, затем весь расчёт заново с чистого состояния.

Если задача про сегментацию клиентов, а не про предсказание, шаги 4 и 5 заменяет `src/rfm.py`. Жюри важна методика: правила очистки, дата расчёта, почему столько сегментов и что делать с каждым. Если организаторы задают свою методику, она важнее встроенных правил.

## Команды

Все команды запускать из корня репозитория, перед ними один раз: `export PYTHONUTF8=1`.

```bash
.venv/Scripts/python.exe src/profile_data.py data/raw/train.csv
.venv/Scripts/python.exe src/leak_check.py --train data/raw/train.csv --target y --test data/raw/test.csv --id id
.venv/Scripts/python.exe src/baseline.py --train data/raw/train.csv --target y --test data/raw/test.csv --id id --sample-submission data/raw/sample_submission.csv --name base
.venv/Scripts/python.exe src/check_submission.py --sample data/raw/sample_submission.csv --submission outputs/submission_base.csv --proba
.venv/Scripts/python.exe src/rfm.py --tx data/raw/tx.csv --customer client_id --date dt --amount sum --order order_id
.venv/Scripts/python.exe -m pytest -q
```

Данные лежат в `data/raw/`, результаты пишутся в `outputs/` и `reports/`. `data/` и `outputs/` в git не попадают.

## Проверенные ловушки этой машины

Всё ниже воспроизведено 06.11.2026 на Windows, Python 3.12.

- **LightGBM на пути с кириллицей.** `booster.save_model()` и чтение модели из файла падают, когда в пути есть кириллица. Сохранять модели только через `joblib.dump`.
- **CatBoost на пути с кириллицей.** Полный путь в `train_dir` падает. Всегда передавать `allow_writing_files=False`.
- **Видеокарта.** Работает только CatBoost (`task_type="GPU"`). XGBoost с `device="cuda"` видеокарту не находит и молча считает на процессоре, сборка LightGBM её не поддерживает.
- **Время.** На 36 тыс. строк в 5 частях LightGBM занял 4–9 с и дал ROC AUC 0,9361, CatBoost 187 с и 0,9354. Перебирать гипотезы на LightGBM, CatBoost запускать в конце.
- **Новые версии библиотек:** pandas 3.1, numpy 2.5, scikit-learn 1.9, duckdb 2.0. Синтаксис по памяти может не работать: в DuckDB у `.sql(...)` нет `fetchone()`, только `fetchall()`, а `sklearn.fetch_openml` падает на pandas 3. Документацию сверять через context7.
- **Streamlit.** Запускать только из корня репозитория: настройки лежат в `.streamlit/config.toml`, они отключают сбор статистики и закрывают доступ из сети. Кнопку установки скиллов в его интерфейсе не нажимать.
- **Ложноотрицательная утечка.** `leak_check` ловит только явные случаи. В репетиции колонка `duration` набрала 0,81 и порог не перешла, хотя её значение известно только после звонка. По каждой верхней колонке проверять смысл вручную.
- **Выбор числа кластеров.** Силуэт часто выбирает 2 кластера: так вышло и на репетиции. Для жюри это слабый результат, число сегментов выбирать через `--k` по смыслу и объяснять.

## Качество

- Зерно случайности 42. Ноутбуки только для просмотра, итоговый результат считается скриптом.
- Каждая цифра в презентации воспроизводится командой из репозитория. Цифр по памяти нет.
- Коммит на каждый проверенный шаг: что изменилось и какая получилась оценка.
- Не коммитить данные организаторов, ключи и пароли.

## Новые пакеты

Список закреплён в `requirements.lock` с хешами и датой отсечения 2026-10-23. Новый пакет добавлять в `requirements.in`, затем:

```bash
uv pip compile requirements.in --python-version 3.12 --python-platform windows --only-binary :all: --generate-hashes --exclude-newer 2026-10-23 --no-header -o requirements.lock
uv pip sync requirements.lock --require-hashes --only-binary :all: --python .venv/Scripts/python.exe
```

Посмотреть изменения в `requirements.lock` до установки. Пакеты вне PyPI и без готовых сборок не ставить.
