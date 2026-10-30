import io
import sys
import unittest
import wave
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
import whisper_server as worker


def sample_audio():
    output = io.BytesIO()
    with wave.open(output, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(bytes(16000 * 2))
    return output.getvalue()


class PipelineTests(unittest.TestCase):
    def test_batch_uncovered_words_keep_upstream_previous_speaker(self):
        words = [SimpleNamespace(start=0, end=.4, word=' Halo'), SimpleNamespace(start=.6, end=.9, word=' Budi')]
        whisper = Mock()
        whisper.transcribe.return_value = ([SimpleNamespace(text='Halo Budi', words=words)], None)
        with patch.object(worker, 'whisper_model', whisper), patch.object(worker, 'diar_model', object()), patch.object(worker, 'diar_processor', object()), patch.object(worker, 'run_diarization', return_value=[(0, .4, 'Pembicara 2')]):
            response = self.upload('/v1/audio/batch-diarize')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['speaker_count'], 1)
        self.assertEqual(response.json()['segments'][0]['speaker'], 'Pembicara 2')
        self.assertEqual(response.json()['segments'][0]['text'], 'Halo Budi')

    def test_live_route_preserves_upstream_diarization_threshold(self):
        words = [SimpleNamespace(start=0, end=.5, word=' Halo')]
        whisper = Mock()
        whisper.transcribe.return_value = ([SimpleNamespace(text='Halo', words=words)], None)
        with patch.object(worker, 'whisper_model', whisper), patch.object(worker, 'diar_model', object()), patch.object(worker, 'diar_processor', object()), patch.object(worker, 'run_diarization', return_value=[(0, .5, 'Pembicara 1')]) as diarize:
            response = self.upload('/v1/audio/transcriptions', diarize='true', diarization_threshold='0.27')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(diarize.call_args.kwargs.get('threshold'), .27)

    def test_batch_route_preserves_upstream_threshold_and_output(self):
        words = [SimpleNamespace(start=0, end=.5, word=' Halo')]
        whisper = Mock()
        whisper.transcribe.return_value = ([SimpleNamespace(text='Halo', words=words)], None)
        with patch.object(worker, 'whisper_model', whisper), patch.object(worker, 'diar_model', object()), patch.object(worker, 'diar_processor', object()), patch.object(worker, 'run_diarization', return_value=[(0, .5, 'Pembicara 1')]) as diarize:
            response = self.upload('/v1/audio/batch-diarize', threshold='0.24')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['text'], 'Halo')
        self.assertEqual(response.json()['speaker_count'], 1)
        self.assertEqual(diarize.call_args.kwargs.get('threshold'), .24)

    def setUp(self):
        self.client = TestClient(worker.app)
        self.audio = sample_audio()

    def upload(self, endpoint, **data):
        return self.client.post(endpoint, files={'file': ('speech.wav', self.audio, 'audio/wav')}, data=data)

    def test_diarization_only_does_not_require_whisper_or_emit_text(self):
        with patch.object(worker, 'whisper_model', None), patch.object(worker, 'diar_model', object()), patch.object(worker, 'diar_processor', object()), patch.object(worker, 'run_diarization', return_value=[(0, .5, 'Pembicara 1'), (.5, 1, 'Pembicara 2')]) as diarize:
            response = self.upload('/v1/audio/diarizations')
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('text', response.json())
        self.assertEqual(len(response.json()['segments']), 2)
        self.assertEqual(response.json()['segments'][1]['speaker'], 'Pembicara 2')
        self.assertEqual(diarize.call_count, 1)

    def test_missing_diarization_is_explicit_for_direct_and_combined_routes(self):
        whisper = Mock()
        whisper.transcribe.return_value = ([SimpleNamespace(text='hello', words=[], start=0, end=1)], None)
        with patch.object(worker, 'whisper_model', whisper), patch.object(worker, 'diar_model', None), patch.object(worker, 'diar_processor', None):
            self.assertEqual(self.upload('/v1/audio/diarizations').status_code, 503)
            self.assertEqual(self.upload('/v1/audio/transcriptions', diarize='true').status_code, 503)
        whisper.transcribe.assert_not_called()

    def test_transcription_still_works_without_diarization(self):
        whisper = Mock()
        whisper.transcribe.return_value = ([SimpleNamespace(text=' Halo ', words=[], start=0, end=1)], None)
        with patch.object(worker, 'whisper_model', whisper), patch.object(worker, 'diar_model', None):
            response = self.upload('/v1/audio/transcriptions', language='id')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'text': 'Halo'})

    def test_combined_route_aligns_words_and_marks_uncovered_words_unknown(self):
        words = [SimpleNamespace(start=0, end=.4, word=' Halo'), SimpleNamespace(start=.6, end=.9, word=' Budi')]
        whisper = Mock()
        whisper.transcribe.return_value = ([SimpleNamespace(text='Halo Budi', words=words)], None)
        with patch.object(worker, 'whisper_model', whisper), patch.object(worker, 'diar_model', object()), patch.object(worker, 'diar_processor', object()), patch.object(worker, 'run_diarization', return_value=[(0, .4, 'Pembicara 1')]):
            response = self.upload('/v1/audio/transcriptions', diarize='true', language='id')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['segments'][1]['speaker'], 'UNKNOWN')
        self.assertTrue(whisper.transcribe.call_args.kwargs['word_timestamps'])

    def test_diarizer_exception_is_not_a_successful_single_speaker_fallback(self):
        with patch.object(worker, 'diar_model', object()), patch.object(worker, 'diar_processor', Mock(side_effect=RuntimeError('fixture failure'))):
            response = self.upload('/v1/audio/diarizations')
        self.assertEqual(response.status_code, 502)

    def test_direct_route_rejects_empty_and_oversized_audio(self):
        with patch.object(worker, 'diar_model', object()), patch.object(worker, 'diar_processor', object()):
            empty = self.client.post('/v1/audio/diarizations', files={'file': ('empty.wav', b'', 'audio/wav')})
            huge = self.client.post('/v1/audio/diarizations', files={'file': ('huge.wav', bytes(5*1024*1024+1), 'audio/wav')})
        self.assertEqual(empty.status_code, 400)
        self.assertEqual(huge.status_code, 413)

    def test_service_key_is_required_for_both_routes_when_configured(self):
        with patch.object(worker, 'SPEECH_API_KEY', 'fixture-secret'):
            self.assertEqual(self.upload('/v1/audio/diarizations').status_code, 401)
            self.assertEqual(self.upload('/v1/audio/transcriptions').status_code, 401)

    def test_direct_route_checks_audio_duration(self):
        with patch.object(worker, 'diar_model', object()), patch.object(worker, 'diar_processor', object()), patch.object(worker, 'decode_audio_to_numpy', return_value=worker.np.zeros(16000*61)):
            self.assertEqual(self.upload('/v1/audio/diarizations').status_code, 413)

    def test_diarization_only_cli_skips_whisper_loading(self):
        with patch.object(sys, 'argv', ['whisper_server', '--diarization-only']), patch.object(worker, 'load_model') as load_whisper, patch.object(worker, 'load_diarization_model') as load_diarizer, patch.object(worker.uvicorn, 'run'):
            worker.main()
        load_whisper.assert_not_called()
        load_diarizer.assert_called_once()


if __name__ == '__main__':
    unittest.main()
