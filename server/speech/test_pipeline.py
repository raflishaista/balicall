import asyncio
import io
import unittest
import wave
import numpy as np
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
import app as worker


class IndependentDiarizationTests(unittest.TestCase):
    def test_health_keeps_active_model_and_new_diarizer_choices(self):
        worker.app.state.models = SimpleNamespace(active='small-id')
        worker.app.state.diarizer = None
        with patch.object(worker, 'NEMOTRON_URL', 'http://synthetic-nemotron'):
            status = worker.health()
        self.assertEqual(status['model'], 'small-id')
        self.assertEqual(status['diarizers'], ['nemotron'])

    def test_long_nemotron_upload_does_not_require_pyannote(self):
        word = SimpleNamespace(start=0, end=1, word='Rapat')
        segment = SimpleNamespace(text='Rapat', words=[word])
        whisper = Mock()
        whisper.transcribe.return_value = (iter([segment]), None)
        worker.app.state.models = SimpleNamespace(get=lambda _: whisper)
        worker.app.state.diarizer = None
        with patch.object(worker, 'decode_audio', return_value=np.ones(16000, dtype=np.float32)), \
             patch.object(worker, 'nemotron_turns', return_value=[(0, 1, 'Pembicara 1')]) as diarize:
            result = worker.infer_long({}, 'synthetic', 'id', True, 'small', 'nemotron')
        diarize.assert_called_once()
        self.assertEqual(result['segments'][0]['speaker'], 'Pembicara 1')
        self.assertEqual(result['text'], 'Rapat')

    def audio(self):
        result = io.BytesIO()
        with wave.open(result, 'wb') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(16000)
            wav.writeframes(bytes(16000*2))
        return result.getvalue()

    def test_direct_route_never_reads_whisper_registry(self):
        worker.app.state.models = Mock()
        worker.app.state.models.get.side_effect = AssertionError('Whisper must not be called')
        worker.app.state.diarizer = Mock(return_value=SimpleNamespace(exclusive_speaker_diarization=[(SimpleNamespace(start=0, end=1), 'SPEAKER_00')]))
        response = TestClient(worker.app).post('/v1/audio/diarizations', files={'file': ('speech.wav', self.audio(), 'audio/wav')})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('text', response.json())
        self.assertEqual(response.json()['segments'][0]['speaker'], 'SPEAKER_00')
        worker.app.state.models.get.assert_not_called()

    def test_direct_route_requires_diarizer_and_enforces_service_auth(self):
        worker.app.state.diarizer = None
        client = TestClient(worker.app)
        with patch.object(worker, 'API_KEY', 'fixture-secret'):
            self.assertEqual(client.post('/v1/audio/diarizations', files={'file': ('x.wav', self.audio())}).status_code, 401)
            self.assertEqual(client.post('/v1/audio/diarizations', headers={'Authorization': 'Bearer fixture-secret'}, files={'file': ('x.wav', self.audio())}).status_code, 503)

    def test_diarization_only_startup_does_not_load_whisper(self):
        registry = Mock()
        async def start():
            async with worker.lifespan(worker.app):
                pass
        with patch.object(worker, 'DIARIZATION_ONLY', True, create=True), patch.object(worker, 'HF_TOKEN', ''), patch.object(worker, 'ModelRegistry', return_value=registry):
            asyncio.run(start())
        registry.get.assert_not_called()


if __name__ == '__main__':
    unittest.main()
