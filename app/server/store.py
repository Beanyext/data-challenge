"""Хранение в SQLite (стандартная библиотека). Файл базы лежит вне git и переживает перезапуск.

Исходная оценка модели не перезаписывается никогда: решения проверяющего хранятся отдельно
и накладываются при чтении. Каждое сохранение чек-листа создаёт новую версию."""

from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS dialogs (
    conversation_id TEXT PRIMARY KEY,
    channel TEXT, language TEXT, group_id TEXT,
    record_json TEXT NOT NULL,
    imported_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS checklists (
    id TEXT NOT NULL, version INTEGER NOT NULL,
    body_json TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY (id, version)
);
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, status TEXT NOT NULL,
    checklist_id TEXT, checklist_version INTEGER,
    total INTEGER NOT NULL, completed INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
    evaluation_ids_json TEXT NOT NULL, created_at TEXT NOT NULL, finished_at TEXT
);
CREATE TABLE IF NOT EXISTS evaluations (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL,
    checklist_id TEXT NOT NULL, checklist_version INTEGER NOT NULL,
    job_id TEXT, status TEXT NOT NULL,
    result_json TEXT, created_at TEXT NOT NULL, finished_at TEXT
);
CREATE INDEX IF NOT EXISTS evaluations_by_dialog ON evaluations (conversation_id, created_at);
CREATE TABLE IF NOT EXISTS appeals (
    id TEXT PRIMARY KEY, evaluation_id TEXT NOT NULL, criterion_id TEXT NOT NULL,
    comment TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS decisions (
    appeal_id TEXT PRIMARY KEY, answer_json TEXT NOT NULL, reason TEXT NOT NULL, decided_at TEXT NOT NULL
);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def _dump(value) -> str:
    return json.dumps(value, ensure_ascii=False)


class Store:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.conn = sqlite3.connect(str(self.path), check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        with self.lock:
            self.conn.execute("PRAGMA journal_mode=WAL")
            self.conn.executescript(SCHEMA)

    def _all(self, sql: str, args=()) -> list[sqlite3.Row]:
        with self.lock:
            return self.conn.execute(sql, args).fetchall()

    def _one(self, sql: str, args=()) -> sqlite3.Row | None:
        with self.lock:
            return self.conn.execute(sql, args).fetchone()

    def _run(self, sql: str, args=()) -> None:
        with self.lock:
            self.conn.execute(sql, args)

    def close(self) -> None:
        with self.lock:
            self.conn.close()

    # --- диалоги ---------------------------------------------------------------

    def upsert_dialog(self, record: dict, group_id: str | None) -> str:
        """new — добавлен, same — уже был такой же, updated — заменён (оценок ещё не было), conflict — не тронут."""
        cid = record["conversation_id"]
        body = _dump(record)
        with self.lock:
            row = self._one("SELECT record_json FROM dialogs WHERE conversation_id = ?", (cid,))
            if row is None:
                self._run(
                    "INSERT INTO dialogs VALUES (?, ?, ?, ?, ?, ?)",
                    (cid, record.get("channel"), record.get("language"), group_id, body, now()),
                )
                return "new"
            if json.loads(row["record_json"]) == record:
                return "same"
            if self._one("SELECT 1 FROM evaluations WHERE conversation_id = ?", (cid,)):
                return "conflict"
            self._run(
                "UPDATE dialogs SET channel = ?, language = ?, group_id = ?, record_json = ?, imported_at = ? WHERE conversation_id = ?",
                (record.get("channel"), record.get("language"), group_id, body, now(), cid),
            )
            return "updated"

    def get_dialog(self, cid: str) -> dict | None:
        row = self._one("SELECT * FROM dialogs WHERE conversation_id = ?", (cid,))
        return None if row is None else {"group_id": row["group_id"], "record": json.loads(row["record_json"])}

    def list_dialogs(self) -> list[dict]:
        rows = self._all("SELECT * FROM dialogs ORDER BY conversation_id")
        return [{"group_id": r["group_id"], "record": json.loads(r["record_json"])} for r in rows]

    # --- чек-листы -------------------------------------------------------------

    def save_checklist(self, checklist: dict) -> dict:
        with self.lock:
            row = self._one("SELECT MAX(version) AS v FROM checklists WHERE id = ?", (checklist["id"],))
            version = (row["v"] or 0) + 1
            saved = {**checklist, "version": version, "created_at": now()}
            self._run("INSERT INTO checklists VALUES (?, ?, ?, ?)", (saved["id"], version, _dump(saved), saved["created_at"]))
            return saved

    def seed_checklist(self, checklist: dict) -> None:
        """Исходный чек-лист как есть, с его версией, если такого id ещё нет."""
        with self.lock:
            if self._one("SELECT 1 FROM checklists WHERE id = ?", (checklist["id"],)):
                return
            saved = {**checklist, "version": int(checklist.get("version") or 1), "created_at": now()}
            self._run("INSERT INTO checklists VALUES (?, ?, ?, ?)", (saved["id"], saved["version"], _dump(saved), saved["created_at"]))

    def get_checklist(self, cid: str, version: int | None = None) -> dict | None:
        if version is None:
            row = self._one("SELECT body_json FROM checklists WHERE id = ? ORDER BY version DESC LIMIT 1", (cid,))
        else:
            row = self._one("SELECT body_json FROM checklists WHERE id = ? AND version = ?", (cid, version))
        return None if row is None else json.loads(row["body_json"])

    def evaluation_stats(self, limit: int = 200) -> dict:
        """Средняя цена и время оценки одного диалога по последним настоящим оценкам (тестовый режим не в счёт)."""
        rows = self._all("SELECT result_json FROM evaluations WHERE status = 'done' ORDER BY finished_at DESC LIMIT ?", (limit,))
        costs, seconds = [], []
        for r in rows:
            res = json.loads(r["result_json"] or "{}")
            if res.get("provider") == "mock" or res.get("reused_from"):
                continue  # частичная переоценка дешевле полной и исказила бы прогноз цены
            if isinstance(res.get("cost_usd"), (int, float)):
                costs.append(float(res["cost_usd"]))
            s = sum(float(c.get("seconds") or 0) for c in res.get("calls") or [])
            if s > 0:
                seconds.append(s)
        return {
            "based_on": len(costs),
            "cost_per_dialog_usd": round(sum(costs) / len(costs), 4) if costs else None,
            "seconds_per_dialog": round(sum(seconds) / len(seconds), 1) if seconds else None,
        }

    def latest_checklists(self) -> list[dict]:
        rows = self._all(
            "SELECT c.body_json FROM checklists c JOIN (SELECT id, MAX(version) AS v FROM checklists GROUP BY id) m "
            "ON c.id = m.id AND c.version = m.v ORDER BY c.created_at"
        )
        return [json.loads(r["body_json"]) for r in rows]

    def checklist_versions(self, cid: str) -> list[dict]:
        rows = self._all("SELECT version, created_at FROM checklists WHERE id = ? ORDER BY version", (cid,))
        return [{"id": cid, "version": r["version"], "created_at": r["created_at"]} for r in rows]

    # --- задания и оценки ------------------------------------------------------

    def create_job(self, job_id: str, checklist: dict, items: list[tuple[str, str]]) -> None:
        """items: (id оценки, conversation_id). Оценки создаются сразу в состоянии pending."""
        with self.lock:
            created = now()
            self._run(
                "INSERT INTO jobs (id, status, checklist_id, checklist_version, total, evaluation_ids_json, created_at) "
                "VALUES (?, 'queued', ?, ?, ?, ?, ?)",
                (job_id, checklist["id"], checklist["version"], len(items), _dump([e for e, _ in items]), created),
            )
            for ev_id, cid in items:
                self._run(
                    "INSERT INTO evaluations (id, conversation_id, checklist_id, checklist_version, job_id, status, created_at) "
                    "VALUES (?, ?, ?, ?, ?, 'pending', ?)",
                    (ev_id, cid, checklist["id"], checklist["version"], job_id, created),
                )

    def job_running(self, job_id: str) -> None:
        self._run("UPDATE jobs SET status = 'running' WHERE id = ? AND status = 'queued'", (job_id,))

    def finish_evaluation(self, ev_id: str, job_id: str | None, result: dict) -> None:
        ok = "error" not in result
        with self.lock:
            self._run(
                "UPDATE evaluations SET status = ?, result_json = ?, finished_at = ? WHERE id = ?",
                ("done" if ok else "error", _dump(result), now(), ev_id),
            )
            if job_id:
                self._run(
                    "UPDATE jobs SET completed = completed + 1, failed = failed + ? WHERE id = ?",
                    (0 if ok else 1, job_id),
                )
                job = self._one("SELECT total, completed, failed FROM jobs WHERE id = ?", (job_id,))
                if job and job["completed"] >= job["total"]:
                    status = "failed" if job["failed"] >= job["total"] else "completed"
                    self._run("UPDATE jobs SET status = ?, finished_at = ? WHERE id = ?", (status, now(), job_id))

    def get_job(self, job_id: str) -> dict | None:
        row = self._one("SELECT * FROM jobs WHERE id = ?", (job_id,))
        if row is None:
            return None
        ev_ids = json.loads(row["evaluation_ids_json"])
        errors = []
        if row["failed"]:
            placeholders = ",".join("?" * len(ev_ids))
            for r in self._all(f"SELECT id, conversation_id, result_json FROM evaluations WHERE status = 'error' AND id IN ({placeholders})", ev_ids):
                errors.append({"evaluation_id": r["id"], "conversation_id": r["conversation_id"],
                               "error": (json.loads(r["result_json"] or "{}")).get("error")})
        return {
            "id": row["id"], "status": row["status"], "total": row["total"], "completed": row["completed"],
            "failed": row["failed"], "progress": round(100 * row["completed"] / row["total"]) if row["total"] else 100,
            "evaluation_ids": ev_ids, "checklist_id": row["checklist_id"], "checklist_version": row["checklist_version"],
            "created_at": row["created_at"], "finished_at": row["finished_at"], "errors": errors,
        }

    def get_evaluation(self, ev_id: str) -> dict | None:
        row = self._one("SELECT * FROM evaluations WHERE id = ?", (ev_id,))
        return None if row is None else self._ev(row)

    def latest_evaluation(self, cid: str) -> dict | None:
        row = self._one(
            "SELECT * FROM evaluations WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1", (cid,)
        )
        return None if row is None else self._ev(row)

    def evaluations_for(self, cid: str) -> list[dict]:
        rows = self._all("SELECT * FROM evaluations WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC", (cid,))
        return [self._ev(r) for r in rows]

    @staticmethod
    def _ev(row: sqlite3.Row) -> dict:
        return {
            "id": row["id"], "conversation_id": row["conversation_id"], "checklist_id": row["checklist_id"],
            "checklist_version": row["checklist_version"], "job_id": row["job_id"], "status": row["status"],
            "result": json.loads(row["result_json"]) if row["result_json"] else None,
            "created_at": row["created_at"], "finished_at": row["finished_at"],
        }

    def abandon_pending(self) -> int:
        """После перезапуска: оценки, прерванные остановкой сервера, помечаются ошибкой, задания закрываются."""
        with self.lock:
            rows = self._all("SELECT id, job_id FROM evaluations WHERE status = 'pending'")
            for r in rows:
                self.finish_evaluation(r["id"], r["job_id"], {"error": "оценка прервана перезапуском сервера, запустите её заново"})
            return len(rows)

    # --- апелляции -------------------------------------------------------------

    def create_appeal(self, evaluation_id: str, criterion_id: str, comment: str) -> dict:
        appeal = {"id": new_id("ap"), "evaluation_id": evaluation_id, "criterion_id": criterion_id,
                  "comment": comment, "status": "open", "created_at": now()}
        self._run("INSERT INTO appeals VALUES (?, ?, ?, ?, ?, ?)", tuple(appeal.values()))
        return {**appeal, "decision": None}

    def open_appeal_exists(self, evaluation_id: str, criterion_id: str) -> bool:
        return self._one(
            "SELECT 1 FROM appeals WHERE evaluation_id = ? AND criterion_id = ? AND status = 'open'", (evaluation_id, criterion_id)
        ) is not None

    def _appeal(self, row: sqlite3.Row) -> dict:
        dec = self._one("SELECT * FROM decisions WHERE appeal_id = ?", (row["id"],))
        return {
            "id": row["id"], "evaluation_id": row["evaluation_id"], "criterion_id": row["criterion_id"],
            "comment": row["comment"], "status": row["status"], "created_at": row["created_at"],
            "decision": None if dec is None else {
                "answer": json.loads(dec["answer_json"]), "reason": dec["reason"], "decided_at": dec["decided_at"],
            },
        }

    def get_appeal(self, appeal_id: str) -> dict | None:
        row = self._one("SELECT * FROM appeals WHERE id = ?", (appeal_id,))
        return None if row is None else self._appeal(row)

    def list_appeals(self, status: str | None = None, evaluation_id: str | None = None) -> list[dict]:
        sql, args = "SELECT * FROM appeals WHERE 1 = 1", []
        if status:
            sql += " AND status = ?"
            args.append(status)
        if evaluation_id:
            sql += " AND evaluation_id = ?"
            args.append(evaluation_id)
        return [self._appeal(r) for r in self._all(sql + " ORDER BY created_at", args)]

    def decide(self, appeal_id: str, answer, reason: str, status: str) -> dict:
        with self.lock:
            self._run("INSERT INTO decisions VALUES (?, ?, ?, ?)", (appeal_id, _dump(answer), reason, now()))
            self._run("UPDATE appeals SET status = ? WHERE id = ?", (status, appeal_id))
            return self.get_appeal(appeal_id)

    def decisions_for(self, evaluation_id: str) -> list[dict]:
        rows = self._all(
            "SELECT a.id, a.criterion_id, a.status, d.answer_json, d.reason, d.decided_at FROM appeals a "
            "JOIN decisions d ON d.appeal_id = a.id WHERE a.evaluation_id = ? ORDER BY d.decided_at, a.rowid",
            (evaluation_id,),
        )
        return [
            {"appeal_id": r["id"], "criterion_id": r["criterion_id"], "status": r["status"],
             "answer": json.loads(r["answer_json"]), "reason": r["reason"], "decided_at": r["decided_at"]}
            for r in rows
        ]
