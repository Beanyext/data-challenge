"""Submission preflight regressions: synthetic data, mock provider, no external calls."""

import io
import json
import time

import pytest
from fastapi.testclient import TestClient

from app import data_api
from app.evaluator.dialog import display_times
from app.server import audio
from app.server.main import create_app


def mixed_record():
    return {
        'conversation_id': 'synthetic-time-ҚАЗ-&', 'channel': 'voice call', 'language': 'KZ',
        'audio_url': 'https://synthetic.invalid/audio',
        'transcript': [
            {'speaker': 'client', 'timestamp': '2026-11-07T12:00:00+00:00', 'text': 'Вымышленный вопрос «Сұрақ» & <тест>.'},
            {'speaker': 'operator', 'timestamp': '2026-11-07T12:00:02', 'text': 'Вымышленный ответ «Жауап».'},
        ],
    }


def test_mixed_timezone_times_preserve_raw_text_without_guessing_offsets():
    transcript = mixed_record()['transcript']
    assert display_times(transcript) == [turn['timestamp'] for turn in transcript]
    assert audio.turn_offsets(transcript) == {}
    assert display_times([{'timestamp': '2026-11-07T12:00:00'}, {'timestamp': '2026-11-07T12:00:02'}]) == ['00:00', '00:02']
    assert display_times([{'timestamp': '2026-11-07T12:00:00+00:00'}, {'timestamp': '2026-11-07T17:00:02+05:00'}]) == ['00:00', '00:02']


def test_upload_mixed_timezone_record_remains_readable_and_evaluable(tmp_path, monkeypatch):
    app = create_app(db_path=tmp_path / 'test.sqlite3', provider='mock', web_dir=False, data_dir=tmp_path / 'raw', env_file=None)
    record = mixed_record()
    monkeypatch.setattr(audio, 'fresh_audio_url', lambda _: 'https://synthetic.invalid/fake.mp3')
    with TestClient(app) as client:
        def upload(value):
            return client.post('/api/dialogs/upload', files={'file': ('synthetic.json', json.dumps(value, ensure_ascii=False).encode(), 'application/json')})
        assert upload(record).status_code == 200
        assert upload(record).json()['same'] == 1
        response = client.get('/api/dialogs')
        assert response.status_code == 200 and len(response.json()) == 1
        detail = client.get(f"/api/dialogs/{record['conversation_id']}")
        assert detail.status_code == 200
        assert detail.json()['transcript'][1]['display_time'] == record['transcript'][1]['timestamp']
        response = client.get(f"/api/dialogs/{record['conversation_id']}/audio")
        assert response.status_code == 200 and response.json()['offsets_available'] is False
        job = client.post('/api/evaluations', json={'conversation_ids': [record['conversation_id']], 'checklist_id': 'freedom-chat'}).json()
        deadline = time.monotonic() + 5
        while True:
            status = client.get(f"/api/jobs/{job['id']}").json()
            if status['status'] in ('completed', 'failed'):
                break
            assert time.monotonic() < deadline
            time.sleep(0.01)
        assert status['status'] == 'completed' and status['failed'] == 0
        assert client.get('/api/dialogs').status_code == 200


@pytest.mark.parametrize('error', [
    'upstream failed https://synthetic.invalid/run?sig=SYNTHETIC_PRIVATE',
    {'url': 'https://synthetic.invalid/run?sig=SYNTHETIC_PRIVATE'},
    'token=SYNTHETIC_PRIVATE',
])
def test_raw_upstream_errors_cannot_disclose_credentials(monkeypatch, tmp_path, error):
    class Response(io.BytesIO):
        def __enter__(self): return self
        def __exit__(self, *args): return False
    monkeypatch.setenv('CQA_API_URL', 'https://synthetic.invalid/?sig=SYNTHETIC_PRIVATE')
    monkeypatch.setattr(data_api.urllib.request, 'urlopen', lambda *args, **kwargs: Response(json.dumps({'isSuccess': False, 'error': error}).encode()))
    with pytest.raises(data_api.DataApiError) as caught:
        data_api.fetch_group('SYNTHETIC')
    assert 'SYNTHETIC_PRIVATE' not in str(caught.value)
    assert 'https://' not in str(caught.value)
    app = create_app(db_path=tmp_path / 'test.sqlite3', provider='mock', web_dir=False, data_dir=tmp_path / 'raw', env_file=None)
    with TestClient(app) as client:
        response = client.post('/api/dialogs/import', json={'group_id': 'SYNTHETIC'})
        assert response.status_code == 502
        assert 'SYNTHETIC_PRIVATE' not in response.text
        assert 'https://' not in response.text


def test_partial_batch_failure_and_retry_keep_successful_results(tmp_path, monkeypatch):
    from app.server import main as server
    evaluate = server.evaluate_dialog
    def partial(record, checklist, provider):
        if record['conversation_id'] == 'synthetic-fail':
            raise RuntimeError('Synthetic evaluation failure')
        return evaluate(record, checklist, provider)
    monkeypatch.setattr(server, 'evaluate_dialog', partial)
    app = create_app(db_path=tmp_path / 'partial.sqlite3', provider='mock', web_dir=False, data_dir=tmp_path / 'raw', env_file=None)
    with TestClient(app) as client:
        records = [{**mixed_record(), 'conversation_id': cid} for cid in ('synthetic-ok', 'synthetic-fail')]
        assert client.post('/api/dialogs/upload', files={'file': ('synthetic.json', json.dumps(records).encode(), 'application/json')}).status_code == 200
        def run(ids):
            response = client.post('/api/evaluations', json={'conversation_ids': ids, 'checklist_id': 'freedom-chat'})
            assert response.status_code == 200
            job = response.json()
            deadline = time.monotonic() + 5
            while True:
                current = client.get(f"/api/jobs/{job['id']}").json()
                if current['status'] in ('completed', 'failed'):
                    return current
                assert time.monotonic() < deadline
                time.sleep(0.01)
        batch = run(['synthetic-ok', 'synthetic-fail'])
        assert batch['status'] == 'completed' and batch['completed'] == 2 and batch['failed'] == 1
        assert batch['errors'][0]['conversation_id'] == 'synthetic-fail'
        rows = {row['conversation_id']: row for row in client.get('/api/dialogs').json()}
        assert rows['synthetic-ok']['status'] == 'evaluated' and rows['synthetic-fail']['status'] == 'error'
        saved_ok = rows['synthetic-ok']['evaluation_id']
        monkeypatch.setattr(server, 'evaluate_dialog', evaluate)
        retry = run(['synthetic-fail'])
        assert retry['status'] == 'completed' and retry['failed'] == 0 and retry['total'] == 1
        rows = {row['conversation_id']: row for row in client.get('/api/dialogs').json()}
        assert rows['synthetic-ok']['evaluation_id'] == saved_ok
        assert rows['synthetic-fail']['status'] == 'evaluated'
