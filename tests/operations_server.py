"""Isolated mock fixtures for browser-operations.js, no organizer/model network calls."""
import copy
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
workspace = Path(tempfile.mkdtemp(prefix='cqa-operations-api-'))
os.environ['CQA_PROVIDER'] = 'mock'
os.environ['CQA_DB'] = str(workspace / 'api.sqlite3')
from app.server.main import create_app
from app.evaluator.evaluate import evaluate_dialog
from app.evaluator.providers import MockProvider

app = create_app(db_path=workspace / 'api.sqlite3', provider='mock', data_dir=workspace / 'raw', env_file=None)
store = app.state.store
for cid, language in [('synthetic-history','RU'), ('synthetic-good','RU'), ('synthetic-en','EN'), ('synthetic-failed-ru','RU'), ('synthetic-failed-kz','KZ'), ('synthetic-pending','RU')]:
    store.upsert_dialog({'conversation_id':cid,'channel':'agent chat','language':language,'audio_url':None,'transcript':[
        {'speaker':'client','timestamp':'00:00','text':'Вымышленный вопрос «Сұрақ» & <тест>.'},
        {'speaker':'bot','timestamp':'00:01','text':'Вымышленный бот.'},
        {'speaker':'operator','timestamp':'00:02','text':'Здравствуйте! Я вымышленный оператор. Вымышленный ответ.'},
        {'speaker':'client','timestamp':'00:03','text':'Вымышленное подтверждение.'},
        {'speaker':'operator','timestamp':'00:04','text':'Вымышленное завершение. Нужна ли ещё помощь? До свидания.'},
    ]}, 'SYNTHETIC')


def saved(cid, version, eid, overrides=None, error=False, pending=False):
    checklist = store.get_checklist('freedom-chat', version)
    store.create_job('job-'+eid, checklist, [(eid,cid)])
    if pending:
        return
    if error:
        store.finish_evaluation(eid, 'job-'+eid, {'conversation_id':cid,'error':'Synthetic failed assessment'})
        return
    result = evaluate_dialog(store.get_dialog(cid)['record'], checklist, MockProvider())
    for item in result['criteria']:
        if overrides and item['criterion_id'] in overrides:
            item.update(answer=overrides[item['criterion_id']], explanation='Synthetic saved assessment for interface verification.')
    store.finish_evaluation(eid, 'job-'+eid, result)

saved('synthetic-history',1,'synthetic-history-old',{'c01':'no'})
saved('synthetic-good',1,'synthetic-good-original')
saved('synthetic-en',1,'synthetic-en-original',{'c07':'no'})
changed = copy.deepcopy(store.get_checklist('freedom-chat',1))
changed['name'] = 'Вымышленный чек-лист v2'
changed['criteria'][0]['title'] = 'Вымышленное правило второй версии'
store.save_checklist(changed)
saved('synthetic-history',2,'synthetic-history-new')
saved('synthetic-failed-ru',2,'synthetic-failed-ru-old',error=True)
saved('synthetic-failed-kz',2,'synthetic-failed-kz-old',error=True)
saved('synthetic-pending',2,'synthetic-pending-old',pending=True)
