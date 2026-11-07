"""Сервер страницы разметки. Только стандартная библиотека Python, без новых пакетов.

Слушает только 127.0.0.1: страница доступна лишь на этом компьютере. Запросы с чужих сайтов
отклоняются по заголовкам Host и Origin, а сохранение принимает только application/json."""

from __future__ import annotations

import argparse
import json
import re
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from app.evaluator.dialog import display_times, load_records
from app.razmetka.gold import clean_label, is_complete, load_gold, new_gold, save_gold
from app.razmetka.split import choose_split
from app.scoring import ScoringError, score

STATIC = Path(__file__).parent / "static"
MAX_BODY = 1_000_000
_LABEL_PATH = re.compile(r"/api/labels/([A-Za-z0-9_.-]+)")


class Labeling:
    """Состояние разметки: диалоги, чек-лист и файл gold.json. Все записи идут под одной блокировкой."""

    def __init__(self, records: list[dict], checklist: dict, gold_path: str | Path, seed: int = 42):
        self.checklist = checklist
        self.gold_path = Path(gold_path)
        self.lock = threading.Lock()
        self.records = {r["conversation_id"]: r for r in records}
        gold = load_gold(self.gold_path)
        if gold is None:
            gold = new_gold(checklist, choose_split(records, seed=seed), seed)
            save_gold(self.gold_path, gold)
        elif gold.get("checklist_id") != checklist.get("id"):
            raise SystemExit(
                f"{self.gold_path} размечен по чек-листу {gold.get('checklist_id')}, а открыт {checklist.get('id')}"
            )
        lost = [cid for part in gold["split"].values() for cid in part if cid not in self.records]
        if lost:
            raise SystemExit(f"в файле с диалогами нет {len(lost)} диалогов из разметки, например {lost[0]}")
        self.gold = gold

    def ordered_ids(self) -> list[tuple[str, str]]:
        """Сначала отложенные: их размечаем без подсказок модели, пока взгляд не замылен."""
        return [(cid, "holdout") for cid in self.gold["split"]["holdout"]] + [
            (cid, "tune") for cid in self.gold["split"]["tune"]
        ]

    def state(self) -> dict:
        dialogs = []
        for cid, part in self.ordered_ids():
            r = self.records[cid]
            times = display_times(r["transcript"])
            dialogs.append(
                {
                    "id": cid,
                    "part": part,
                    "channel": r.get("channel"),
                    "language": r.get("language"),
                    "turns": [
                        {"i": i, "time": times[i], "speaker": t.get("speaker"), "text": str(t.get("text") or "")}
                        for i, t in enumerate(r["transcript"])
                    ],
                }
            )
        with self.lock:
            labels = json.loads(json.dumps(self.gold["labels"]))
        return {
            "checklist": self.checklist,
            "dialogs": dialogs,
            "labels": labels,
            "complete": {cid: is_complete(self.checklist, labels.get(cid)) for cid, _ in self.ordered_ids()},
        }

    def save_label(self, cid: str, body: dict) -> dict:
        if cid not in {c for c, _ in self.ordered_ids()}:
            raise KeyError(cid)
        label = clean_label(self.checklist, body)
        with self.lock:
            self.gold["labels"][cid] = label
            save_gold(self.gold_path, self.gold)
        return {"label": label, "complete": is_complete(self.checklist, label), "score": score(self.checklist, label["answers"])}

    def score(self, answers: dict) -> dict:
        return score(self.checklist, answers if isinstance(answers, dict) else {})


def make_handler(app: Labeling):
    class Handler(BaseHTTPRequestHandler):
        allowed_hosts: set[str] = set()

        def log_message(self, fmt, *args):  # без журнала каждого запроса в консоли
            pass

        def _send(self, code: int, body: bytes, content_type: str) -> None:
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, code: int, obj) -> None:
            self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

        def _trusted(self) -> bool:
            if self.headers.get("Host", "") not in self.allowed_hosts:
                return False
            origin = self.headers.get("Origin")
            return origin is None or urlsplit(origin).netloc in self.allowed_hosts

        def do_GET(self):
            if not self._trusted():
                return self._json(403, {"error": "запрос не с этого компьютера"})
            path = urlsplit(self.path).path
            if path in ("/", "/index.html"):
                return self._send(200, (STATIC / "index.html").read_bytes(), "text/html; charset=utf-8")
            if path == "/api/state":
                return self._json(200, app.state())
            return self._json(404, {"error": "нет такой страницы"})

        def _read_body(self) -> bytes | None:
            """Тело читается до любого ответа: если ответить, не дочитав его, Windows может
            оборвать соединение, и клиент вместо ответа получит ошибку сети."""
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = -1
            if length < 0 or length > MAX_BODY:
                self.close_connection = True
                return None
            return self.rfile.read(length) if length else b""

        def do_POST(self):
            raw = self._read_body()
            if not self._trusted():
                return self._json(403, {"error": "запрос не с этого компьютера"})
            if raw is None:
                return self._json(413, {"error": "слишком большой запрос"})
            if not self.headers.get("Content-Type", "").startswith("application/json"):
                return self._json(415, {"error": "нужен application/json"})
            try:
                body = json.loads(raw or b"{}")
            except json.JSONDecodeError:
                return self._json(400, {"error": "тело запроса не JSON"})
            path = urlsplit(self.path).path
            try:
                if path == "/api/score":
                    return self._json(200, app.score(body.get("answers") if isinstance(body, dict) else {}))
                m = _LABEL_PATH.fullmatch(path)
                if m:
                    return self._json(200, app.save_label(m.group(1), body))
            except ScoringError as e:
                return self._json(400, {"error": str(e)})
            except KeyError:
                return self._json(404, {"error": "этого диалога нет в разметке"})
            return self._json(404, {"error": "нет такого запроса"})

    return Handler


def make_server(app: Labeling, port: int = 8765) -> ThreadingHTTPServer:
    handler = make_handler(app)
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    real_port = server.server_address[1]
    handler.allowed_hosts = {f"127.0.0.1:{real_port}", f"localhost:{real_port}"}
    return server


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Ручная разметка эталона по чек-листу")
    parser.add_argument("--data", default="data/raw/dev.json", help="ответ API организаторов с диалогами")
    parser.add_argument("--checklist", default="app/checklists/freedom_chat_v1.json")
    parser.add_argument("--gold", default="reports/gold.json", help="куда сохранять разметку")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--no-browser", action="store_true", help="не открывать браузер автоматически")
    args = parser.parse_args(argv)

    checklist = json.loads(Path(args.checklist).read_text(encoding="utf-8"))
    app = Labeling(load_records(args.data), checklist, args.gold, seed=args.seed)
    server = make_server(app, args.port)
    url = f"http://127.0.0.1:{server.server_address[1]}/"
    done = sum(app.state()["complete"].values())
    print(f"Разметка: {url}\nГотово {done} из {len(app.ordered_ids())}. Ответы пишутся в {args.gold}. Остановить: Ctrl+C")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
