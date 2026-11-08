"""FastAPI-приложение: маршруты из раздела «Контракт» в reports/задачи.md.

Запуск из корня репозитория:
    .venv/Scripts/python.exe -m uvicorn app.server.main:app --host 127.0.0.1 --port 8000

Настройки (переменные окружения или .env):
    CQA_PROVIDER   anthropic (по умолчанию) или mock — тестовый режим без модели
    CQA_DB         файл базы, по умолчанию outputs/server/cqa.sqlite3
    CQA_WORKERS    сколько диалогов оценивать одновременно, по умолчанию 4
    CQA_CORS_ORIGINS  явные адреса интерфейса на другом порту через запятую; «*» запрещён
    CQA_ALLOWED_HOSTS дополнительные имена хоста, кроме 127.0.0.1 и localhost
    ANTHROPIC_API_KEY, CQA_MODEL, CQA_EFFORT, CQA_API_URL — как у модуля оценки
"""

from __future__ import annotations

import json
import mimetypes
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import Body, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app import data_api
from app.evaluator.cli import load_env
from app.evaluator.evaluate import evaluate_dialog
from app.evaluator.providers import AnthropicProvider, EvaluationError, MockProvider
from app.scoring import ScoringError
from app.server import audio as audio_mod
from app.server.checklist_rules import ChecklistError, validate_checklist
from app.server.criterion_review import LOCALES, ReviewError, review_criterion, review_effort, rule_review
from app.server.store import Store, new_id
from app.server.views import allowed_answer, appeal_view, criterion_by_id, dialog_row, evaluation_view, public_dialog

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CHECKLIST = ROOT / "app" / "checklists" / "freedom_chat_v1.json"
MAX_UPLOAD = 5 * 1024 * 1024
AUDIO_CACHE_SECONDS = 300


def _fail(status: int, message: str):
    raise HTTPException(status_code=status, detail=message)


def _records_from_upload(doc: object) -> list[dict]:
    if isinstance(doc, dict) and isinstance(doc.get("data"), dict) and isinstance(doc["data"].get("records"), list):
        records = doc["data"]["records"]
    elif isinstance(doc, dict) and isinstance(doc.get("records"), list):
        records = doc["records"]
    elif isinstance(doc, list):
        records = doc
    elif isinstance(doc, dict):
        records = [doc]
    else:
        _fail(400, "В файле должен быть диалог, список диалогов или ответ API организаторов.")
    if not records:
        _fail(400, "В файле нет диалогов.")
    for r in records:
        _check_record(r)
    ids = [r["conversation_id"] for r in records]
    if len(set(ids)) != len(ids):
        _fail(400, "В файле повторяются conversation_id.")
    return records


def _check_record(r: object) -> None:
    if not isinstance(r, dict) or not isinstance(r.get("conversation_id"), str) or not r["conversation_id"].strip():
        _fail(400, "У каждого диалога нужен conversation_id.")
    cid = r["conversation_id"]
    if len(cid) > 128 or any(ch in cid for ch in "/\\?#"):
        _fail(400, f"Недопустимый conversation_id: {cid[:40]}")
    transcript = r.get("transcript")
    if not isinstance(transcript, list) or not transcript:
        _fail(400, f"{cid}: transcript должен быть непустым массивом реплик.")
    for t in transcript:
        if not isinstance(t, dict) or t.get("speaker") not in ("client", "operator", "bot", "system") or not isinstance(t.get("text"), str):
            _fail(400, f"{cid}: у каждой реплики нужны speaker (client, operator, bot, system) и text.")


class Runner:
    """Оценка в фоне: задание возвращается сразу, интерфейс опрашивает /api/jobs/{id}."""

    def __init__(self, store: Store, provider_name: str, workers: int):
        self.store = store
        self.provider_name = provider_name
        self.workers = max(1, workers)
        self.pool = ThreadPoolExecutor(max_workers=self.workers, thread_name_prefix="cqa-eval")

    def provider(self):
        return MockProvider() if self.provider_name == "mock" else AnthropicProvider()

    def check_ready(self) -> None:
        try:
            self.provider()
        except EvaluationError as e:
            _fail(503, f"Модель недоступна: {e}")

    def start(self, records: list[dict], checklist: dict) -> dict:
        job_id = new_id("job")
        items = [(new_id("ev"), r["conversation_id"]) for r in records]
        self.store.create_job(job_id, checklist, items)
        for (ev_id, _), record in zip(items, records):
            self.pool.submit(self._one, job_id, ev_id, record, checklist)
        return self.store.get_job(job_id)

    def _one(self, job_id: str, ev_id: str, record: dict, checklist: dict) -> None:
        self.store.job_running(job_id)
        try:
            result = evaluate_dialog(record, checklist, self.provider())
        except Exception as exc:  # одна ошибка не останавливает задание
            result = {"conversation_id": record.get("conversation_id"), "error": f"{type(exc).__name__}: {exc}"}
        self.store.finish_evaluation(ev_id, job_id, result)


def create_app(db_path: str | Path | None = None, provider: str | None = None, web_dir: str | Path | None | bool = None,
               data_dir: str | Path | None = None, env_file: str | Path | None = ROOT / ".env") -> FastAPI:
    if env_file:
        load_env(Path(env_file))
    provider_name = (provider or os.environ.get("CQA_PROVIDER") or "anthropic").strip().lower()
    if provider_name not in ("anthropic", "mock"):
        raise ValueError("CQA_PROVIDER: anthropic или mock")
    store = Store(db_path or os.environ.get("CQA_DB") or ROOT / "outputs" / "server" / "cqa.sqlite3")
    store.seed_checklist(json.loads(DEFAULT_CHECKLIST.read_text(encoding="utf-8")))
    store.abandon_pending()
    runner = Runner(store, provider_name, int(os.environ.get("CQA_WORKERS") or 4))
    raw_dir = Path(data_dir) if data_dir else ROOT / "data" / "raw"
    audio_cache: dict[str, tuple[float, str]] = {}
    audio_lock = threading.Lock()

    cors = [o.strip() for o in (os.environ.get("CQA_CORS_ORIGINS") or "").split(",") if o.strip()]
    if "*" in cors:
        raise ValueError("CQA_CORS_ORIGINS: «*» запрещён, перечислите адреса явно")
    hosts = ["127.0.0.1", "localhost", "testserver"] + [h.strip() for h in (os.environ.get("CQA_ALLOWED_HOSTS") or "").split(",") if h.strip()]

    app = FastAPI(title="CQA прототип", docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
    app.state.store, app.state.runner = store, runner
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=hosts)
    if cors:
        app.add_middleware(CORSMiddleware, allow_origins=cors, allow_methods=["GET", "POST"], allow_headers=["Content-Type", "Accept"])

    @app.middleware("http")
    async def guard(request: Request, call_next):
        """Запись только со своей страницы или из CQA_CORS_ORIGINS и только JSON/форма: чужой сайт не запустит платную оценку."""
        if request.url.path.startswith("/api/") and request.method in ("POST", "PUT", "PATCH", "DELETE"):
            origin = request.headers.get("origin")
            own = f"{request.url.scheme}://{request.headers.get('host', '')}"
            if origin and origin != own and origin not in cors:
                return JSONResponse({"detail": "Запрос с чужого сайта отклонён."}, status_code=403)
            ctype = request.headers.get("content-type", "")
            need = "multipart/form-data" if request.url.path.endswith("/upload") else "application/json"
            if not ctype.startswith(need):
                return JSONResponse({"detail": f"Нужен Content-Type {need}."}, status_code=415)
        return await call_next(request)

    # --- служебное -----------------------------------------------------------

    @app.get("/api/health")
    def health():
        return {"ok": True, "provider": provider_name,
                "model": os.environ.get("CQA_MODEL", "claude-opus-5-5") if provider_name == "anthropic" else "mock",
                "dialogs": len(store.list_dialogs()), "checklists": len(store.latest_checklists()),
                # для окна оценки: сколько стоит и сколько ждать; в тестовом режиме не заполняется
                "estimate": {**store.evaluation_stats(), "workers": runner.workers}}

    # --- диалоги -------------------------------------------------------------

    @app.get("/api/dialogs")
    def list_dialogs(gross_error: bool | None = None, language: str | None = None, channel: str | None = None,
                     status: str | None = None, group_id: str | None = None, needs_review: bool | None = None):
        rows = [dialog_row(store, e, store.latest_evaluation(e["record"]["conversation_id"])) for e in store.list_dialogs()]
        if gross_error is not None:
            rows = [r for r in rows if r["gross_error"] == gross_error]
        if language:
            rows = [r for r in rows if (r["language"] or "").lower() == language.lower()]
        if channel:
            rows = [r for r in rows if (r["channel"] or "").lower() == channel.lower()]
        if status:
            rows = [r for r in rows if r["status"] == status]
        if group_id:
            rows = [r for r in rows if r["group_id"] == group_id]
        if needs_review is not None:
            rows = [r for r in rows if r["needs_review"] == needs_review]
        return rows

    @app.get("/api/dialogs/{cid}")
    def get_dialog(cid: str):
        entry = store.get_dialog(cid) or _fail(404, "Диалог не найден.")
        latest = store.latest_evaluation(cid)
        return {**dialog_row(store, entry, latest), **public_dialog(entry)}

    @app.get("/api/dialogs/{cid}/evaluations")
    def dialog_evaluations(cid: str):
        store.get_dialog(cid) or _fail(404, "Диалог не найден.")
        out = []
        for ev in store.evaluations_for(cid):
            v = evaluation_view(store, ev, with_appeals=False)
            out.append({k: v.get(k) for k in ("id", "status", "checklist_id", "checklist_version", "total",
                                              "original_total", "gross_error", "model", "created_at", "error")})
        return out

    @app.get("/api/dialogs/{cid}/audio")
    def get_audio(cid: str):
        entry = store.get_dialog(cid) or _fail(404, "Диалог не найден.")
        page = entry["record"].get("audio_url")
        if not page:
            _fail(404, "У этого диалога нет записи.")
        with audio_lock:
            cached = audio_cache.get(cid)
        if cached and time.time() - cached[0] < AUDIO_CACHE_SECONDS:
            url = cached[1]
        else:
            try:
                url = audio_mod.fresh_audio_url(page)
            except audio_mod.AudioError as e:
                _fail(502, f"Запись не получена: {e}. Повторите позже.")
            with audio_lock:
                audio_cache[cid] = (time.time(), url)
        offsets = audio_mod.turn_offsets(entry["record"]["transcript"])
        return {"url": url, "audio_url": url, "turn_offsets": offsets, "offsets_available": bool(offsets),
                "seek_back_seconds": 3, "note": "ссылка на файл живёт около часа, при ошибке воспроизведения запросите заново"}

    @app.post("/api/dialogs/import")
    def import_dialogs(payload: dict = Body(...)):
        group_id = str(payload.get("group_id") or "").strip()
        if not group_id:
            _fail(400, "Введите group_id.")
        try:
            doc = data_api.fetch_group(group_id)
        except data_api.DataApiError as e:
            _fail(502, str(e))
        records = doc["data"]["records"]
        for r in records:
            _check_record(r)
        try:
            data_api.save_group(doc, raw_dir / f"{group_id}.json")
        except OSError:
            pass  # копия на диске только для удобства, база главнее
        counts = {"new": 0, "same": 0, "updated": 0, "conflict": 0}
        conflicts = []
        for r in records:
            state = store.upsert_dialog(r, group_id)
            counts[state] += 1
            if state == "conflict":
                conflicts.append(r["conversation_id"])
        return {"group_id": group_id, "total_records": len(records), "imported": counts["new"] + counts["updated"],
                **counts, "conflicts": conflicts, "conversation_ids": [r["conversation_id"] for r in records]}

    @app.post("/api/dialogs/upload")
    async def upload_dialogs(file: UploadFile = File(...)):
        raw = await file.read(MAX_UPLOAD + 1)
        if len(raw) > MAX_UPLOAD:
            _fail(413, "Файл больше 5 МБ.")
        try:
            doc = json.loads(raw.decode("utf-8-sig"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            _fail(400, "Файл должен содержать корректный JSON в UTF-8.")
        records = _records_from_upload(doc)
        conflicts = [r["conversation_id"] for r in records
                     if (e := store.get_dialog(r["conversation_id"])) and e["record"] != r]
        if conflicts:
            _fail(409, f"Уже загружен другой диалог с таким conversation_id: {', '.join(conflicts[:5])}")
        states = [store.upsert_dialog(r, "upload") for r in records]
        rows = [dialog_row(store, store.get_dialog(r["conversation_id"]), store.latest_evaluation(r["conversation_id"])) for r in records]
        return {"imported": states.count("new"), "same": states.count("same"), "records": rows}

    # --- чек-листы -----------------------------------------------------------

    @app.get("/api/checklists")
    def list_checklists():
        return store.latest_checklists()

    @app.get("/api/checklists/{cl_id}")
    def get_checklist(cl_id: str, version: int | None = None):
        return store.get_checklist(cl_id, version) or _fail(404, "Чек-лист не найден.")

    @app.get("/api/checklists/{cl_id}/versions")
    def checklist_versions(cl_id: str):
        return store.checklist_versions(cl_id) or _fail(404, "Чек-лист не найден.")

    @app.post("/api/checklists/review-criterion")
    def review_criterion_route(payload: dict = Body(...)):
        """Совет модели по формулировке критерия. Ничего не сохраняет."""
        locale = payload.get("locale") if payload.get("locale") in LOCALES else "ru"
        try:
            if provider_name == "mock":
                return rule_review(payload.get("criterion"), payload.get("checklist"), locale)
            try:
                provider = AnthropicProvider(effort=review_effort(), max_tokens=8000)
            except EvaluationError as e:
                _fail(503, f"Модель недоступна: {e}")
            return review_criterion(payload.get("criterion"), payload.get("checklist"), provider, locale)
        except ReviewError as e:
            _fail(400, str(e))
        except HTTPException:
            raise
        except Exception as e:  # сеть, лимиты, отказ модели: совет не обязателен, редактор работает дальше
            _fail(502, f"Совет модели не получен: {type(e).__name__}. Повторите или сохраните критерий без совета.")

    @app.post("/api/checklists")
    def save_checklist(payload: dict = Body(...)):
        try:
            checklist = validate_checklist(payload)
        except ChecklistError as e:
            _fail(400, str(e))
        return store.save_checklist(checklist)

    # --- оценка --------------------------------------------------------------

    @app.post("/api/evaluations")
    def start_evaluation(payload: dict = Body(...)):
        cl_id = str(payload.get("checklist_id") or "").strip()
        if not cl_id:
            _fail(400, "Выберите чек-лист.")
        version = payload.get("checklist_version")
        try:
            version = int(version) if version not in (None, "") else None
        except (TypeError, ValueError):
            _fail(400, "checklist_version должен быть числом.")
        checklist = store.get_checklist(cl_id, version) or _fail(404, "Чек-лист не найден.")
        ids = payload.get("conversation_ids")
        if not ids and payload.get("group_id"):
            ids = [e["record"]["conversation_id"] for e in store.list_dialogs() if e["group_id"] == payload["group_id"]]
        if not isinstance(ids, list) or not ids or not all(isinstance(i, str) for i in ids):
            _fail(400, "Выберите хотя бы один диалог.")
        ids = list(dict.fromkeys(ids))
        missing = [i for i in ids if store.get_dialog(i) is None]
        if missing:
            _fail(404, f"Нет таких диалогов: {', '.join(missing[:5])}")
        runner.check_ready()
        records = [store.get_dialog(i)["record"] for i in ids]
        return runner.start(records, checklist)

    @app.get("/api/jobs/{job_id}")
    def get_job(job_id: str):
        return store.get_job(job_id) or _fail(404, "Задание не найдено.")

    @app.get("/api/evaluations/{ev_id}")
    def get_evaluation(ev_id: str):
        ev = store.get_evaluation(ev_id) or _fail(404, "Оценка не найдена.")
        return evaluation_view(store, ev)

    # --- апелляции -----------------------------------------------------------

    @app.post("/api/appeals")
    def create_appeal(payload: dict = Body(...)):
        ev = store.get_evaluation(str(payload.get("evaluation_id") or "")) or _fail(404, "Оценка не найдена.")
        if ev["status"] != "done":
            _fail(409, "Оспорить можно только готовую оценку.")
        cid = str(payload.get("criterion_id") or "")
        checklist = store.get_checklist(ev["checklist_id"], ev["checklist_version"])
        if cid not in criterion_by_id(checklist):
            _fail(400, "Критерий не найден в оценке.")
        comment = str(payload.get("comment") or "").strip()
        if not comment:
            _fail(400, "Напишите, почему вы оспариваете оценку.")
        if store.open_appeal_exists(ev["id"], cid):
            _fail(409, "По этому критерию уже есть открытая апелляция.")
        return appeal_view(store, store.create_appeal(ev["id"], cid, comment[:2000]))

    @app.get("/api/appeals")
    def list_appeals(status: str | None = None):
        return [appeal_view(store, a) for a in store.list_appeals(status=status)]

    @app.post("/api/appeals/{appeal_id}/decision")
    def decide_appeal(appeal_id: str, payload: dict = Body(...)):
        appeal = store.get_appeal(appeal_id) or _fail(404, "Апелляция не найдена.")
        if appeal["status"] != "open":
            _fail(409, "По этой апелляции уже принято решение.")
        reason = str(payload.get("reason") or "").strip()
        if not reason:
            _fail(400, "Укажите причину решения.")
        ev = store.get_evaluation(appeal["evaluation_id"])
        view = evaluation_view(store, ev, with_appeals=False)
        item = next(c for c in view["criteria"] if c["criterion_id"] == appeal["criterion_id"])
        criterion = criterion_by_id(view["checklist"])[appeal["criterion_id"]]
        confirm = payload.get("status") == "confirmed" or payload.get("action") == "confirm"
        raw = item["answer"] if confirm else payload.get("answer")
        try:
            answer = allowed_answer(criterion, raw)
        except ScoringError as e:
            _fail(400, f"Недопустимый ответ: {e}")
        current = item["answer"]
        status = "confirmed" if current is not None and str(answer) == str(current) else "changed"
        decided = store.decide(appeal_id, answer, reason[:2000], status)
        return {**appeal_view(store, decided), "evaluation": evaluation_view(store, ev)}

    # --- аналитика -----------------------------------------------------------

    @app.get("/api/summary")
    def summary():
        views = []
        for e in store.list_dialogs():
            latest = store.latest_evaluation(e["record"]["conversation_id"])
            if latest and latest["status"] == "done":
                views.append((e["record"], evaluation_view(store, latest, with_appeals=False)))
        groups: dict[str, list[float]] = {}
        crit: dict[str, dict] = {}
        for record, v in views:
            if v["total"] is not None:
                for key in ("all", f"language:{record.get('language')}", f"channel:{record.get('channel')}"):
                    groups.setdefault(key, []).append(v["total"])
            for c in v["criteria"]:
                s = crit.setdefault(c["criterion_id"], {"criterion_id": c["criterion_id"], "title": c["title"],
                                                        "evaluated": 0, "full": 0, "partial_or_no": 0, "na": 0,
                                                        "violations": 0, "needs_review": 0})
                s["evaluated"] += 1
                s["needs_review"] += int(c["needs_review"])
                if c["gross_error"]:
                    s["violations"] += int(c["answer"] == "yes")
                elif c["answer"] == "na":
                    s["na"] += 1
                elif c["raw_points"] is not None and c["weight"] and c["raw_points"] >= c["weight"]:
                    s["full"] += 1
                else:
                    s["partial_or_no"] += 1
        return {
            "evaluated_dialogs": len(views),
            "gross_error_dialogs": sum(1 for _, v in views if v["gross_error"]),
            "average_total": {k: round(sum(x) / len(x), 2) for k, x in sorted(groups.items())},
            "criteria": sorted(crit.values(), key=lambda s: -s["partial_or_no"]),
        }

    # --- интерфейс -----------------------------------------------------------

    web = None if web_dir is False else Path(web_dir) if web_dir else ROOT / "web"
    if web is not None and (web / "index.html").exists():
        # Python на Windows берёт типы файлов из реестра, а там у .js бывает text/plain:
        # тогда браузер не запускает модули и страница остаётся пустой. Типы задаём явно.
        for ext, mime in ((".js", "text/javascript"), (".mjs", "text/javascript"), (".css", "text/css"),
                          (".svg", "image/svg+xml"), (".json", "application/json")):
            mimetypes.add_type(mime, ext)
        app.mount("/", StaticFiles(directory=str(web), html=True), name="web")
    else:
        @app.get("/")
        def root():
            return {"message": "Сервер CQA работает. Интерфейс не найден: положите web/ в корень репозитория.",
                    "api": "/api/docs"}

    return app


_app: FastAPI | None = None


def __getattr__(name: str):
    """uvicorn app.server.main:app создаёт приложение при первом обращении, а не при импорте модуля в тестах."""
    global _app
    if name == "app":
        if _app is None:
            _app = create_app()
        return _app
    raise AttributeError(name)
