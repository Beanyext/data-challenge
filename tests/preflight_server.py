"""Isolated synthetic fixture for browser-preflight.js; run uvicorn preflight_server:app --app-dir tests."""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
workspace = Path(tempfile.mkdtemp(prefix='cqa-preflight-api-'))
os.environ['CQA_PROVIDER'] = 'mock'
os.environ['CQA_DB'] = str(workspace / 'api.sqlite3')
from app.server.main import create_app
from app.evaluator.evaluate import evaluate_dialog
from app.evaluator.providers import MockProvider

app = create_app(db_path=workspace / 'api.sqlite3', provider='mock', data_dir=workspace / 'raw', env_file=None)
record = {'conversation_id': 'synthetic-recovery', 'channel': 'agent chat', 'language': 'RU', 'audio_url': None, 'transcript': [
    {'speaker': 'client', 'timestamp': '00:00', 'text': 'Вымышленный вопрос «Сұрақ» & <тест>.'},
    {'speaker': 'operator', 'timestamp': '00:02', 'text': 'Здравствуйте! Я вымышленный оператор. Вымышленный ответ «Жауап».'},
]}
store = app.state.store
store.upsert_dialog(record, 'SYNTHETIC')
checklist = store.get_checklist('freedom-chat')
store.create_job('synthetic-recovery-job', checklist, [('synthetic-recovery-eval', record['conversation_id'])])
result = evaluate_dialog(record, checklist, MockProvider())
result['criteria'][0].update(answer=None, needs_review=True, problems=['synthetic invalid model answer'])
store.finish_evaluation('synthetic-recovery-eval', 'synthetic-recovery-job', result)
