import unittest
import io
import json
import urllib.error
from unittest.mock import patch
import numpy as np
from fastapi import HTTPException
from fastapi.testclient import TestClient
from qwen_diarization import transcribe_turns, request_turns
import qwen_app


class QwenDiarizationTests(unittest.TestCase):
    def test_turn_changes_gaps_and_returning_speaker_preserve_offsets(self):
        audio = np.ones(6 * 16000, dtype=np.float32)
        calls = []
        turns = [{'speaker': s, 'start': a, 'end': b} for s, a, b in
                 [('A', 0, 1), ('B', 2, 3), ('A', 4, 5)]]
        def recognize(clip, language):
            calls.append((len(clip), language))
            return 'kalimat'
        result = transcribe_turns(audio, 'Indonesian', recognize, turns, lambda _: True)
        self.assertEqual(result['segments'], [{**turn, 'text': 'kalimat'} for turn in turns])
        self.assertEqual(calls, [(16000, 'Indonesian')] * 3)
        self.assertEqual(result['text'], 'kalimat kalimat kalimat')

    def test_long_turn_is_bounded_without_changing_speaker(self):
        audio = np.ones(65 * 16000, dtype=np.float32)
        result = transcribe_turns(audio, 'English', lambda clip, _: str(len(clip)),
                                 [{'speaker': 'A', 'start': 0, 'end': 65}], lambda _: True)
        self.assertEqual([(s['start'], s['end']) for s in result['segments']], [(0, 30), (30, 60), (60, 65)])
        self.assertEqual({s['speaker'] for s in result['segments']}, {'A'})

    def test_silence_does_not_call_qwen(self):
        def forbidden(*_):
            self.fail('Silence reached ASR')
        result = transcribe_turns(np.zeros(16000), 'English', forbidden,
                                 [{'speaker': 'A', 'start': 0, 'end': 1}], lambda _: False)
        self.assertEqual(result, {'text': '', 'segments': []})

    def test_overlap_fails_without_duplicate_or_invented_speaker_text(self):
        calls = []
        with self.assertRaises(HTTPException) as caught:
            transcribe_turns(np.ones(3 * 16000), 'English', lambda *_: calls.append(1),
                             [{'speaker': 'A', 'start': 0, 'end': 2},
                              {'speaker': 'B', 'start': 1, 'end': 3}], lambda _: True)
        self.assertEqual(caught.exception.status_code, 422)
        self.assertEqual(calls, [])

    def test_invalid_bounds_and_missing_turns_fail_closed(self):
        for turns in [[], [{'speaker': 'A', 'start': -1, 'end': 1}],
                      [{'speaker': 'A', 'start': 0, 'end': 2}],
                      [{'speaker': '', 'start': 0, 'end': 1}],
                      [{'speaker': 'A', 'start': 0, 'end': float('nan')}]]:
            with self.subTest(turns=turns), self.assertRaises(HTTPException):
                transcribe_turns(np.ones(16000), 'English', lambda *_: 'text', turns, lambda _: True)

    def test_adapter_posts_audio_not_text_with_separate_credentials(self):
        turns = [{'speaker': 'A', 'start': 0, 'end': 1}]
        def receive(request, timeout):
            self.assertEqual(request.full_url, 'http://127.0.0.1:8001/v1/audio/diarizations')
            self.assertEqual(request.get_header('Authorization'), 'Bearer diarizer-only')
            self.assertIn(b'RIFF', request.data)
            self.assertEqual(timeout, 60)
            return io.BytesIO(json.dumps({'segments': turns}).encode())
        with patch.dict('os.environ', {'QWEN_DIARIZATION_URL': 'http://127.0.0.1:8001/v1/audio/diarizations',
                                      'QWEN_DIARIZATION_API_KEY': 'diarizer-only'}), patch('urllib.request.urlopen', receive):
            self.assertEqual(request_turns(np.ones(16000)), turns)
            with self.assertRaises(HTTPException) as caught:
                request_turns(np.ones(61 * 16000))
            self.assertEqual(caught.exception.status_code, 413)

    def test_worker_api_and_long_job_preserve_segment_contract(self):
        qwen_app.app.state.recognize = lambda clip, language: 'Rapat dimulai.'
        qwen_app.app.state.api_key = 'qwen-only'
        turns = [{'speaker': 'A', 'start': 0, 'end': 1}]
        import wave
        stream = io.BytesIO()
        with wave.open(stream, 'wb') as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000)
            wav.writeframes(bytes(16000 * 2))
        with patch.dict('os.environ', {'QWEN_DIARIZATION_URL': 'http://diarizer/v1/audio/diarizations'}), \
                patch('qwen_app.request_turns', return_value=turns), \
                patch('qwen_app.speech_regions', return_value=[{'start': 0, 'end': 16000}]):
            response = TestClient(qwen_app.app).post('/v1/audio/transcriptions',
                headers={'Authorization': 'Bearer qwen-only'},
                files={'file': ('audio.wav', stream.getvalue(), 'audio/wav')},
                data={'model': qwen_app.MODEL_ALIAS, 'diarize': 'true'})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['segments'], [{**turns[0], 'text': 'Rapat dimulai.'}])
            with patch('qwen_app.decode_audio', return_value=np.ones(16000)):
                result = qwen_app.infer_long({}, 'fake-local-file', 'id', True)
            self.assertEqual(result, {**response.json(), 'duration': 1.0})

    def test_health_does_not_claim_real_diarization_validation(self):
        with patch.dict('os.environ', {'QWEN_DIARIZATION_URL': 'http://diarizer/v1/audio/diarizations'}):
            health = qwen_app.health()
        self.assertTrue(health['diarizationConfigured'])
        self.assertFalse(health['diarization'])

    def test_diarization_unavailable_fails_without_asr_fallback(self):
        with patch.dict('os.environ', {'QWEN_DIARIZATION_URL': 'http://diarizer/v1/audio/diarizations'}), \
                patch('urllib.request.urlopen', side_effect=urllib.error.HTTPError('http://diarizer', 503, 'not ready', {}, None)):
            with self.assertRaises(HTTPException) as caught:
                request_turns(np.ones(16000))
        self.assertEqual(caught.exception.status_code, 503)

    def test_failed_job_keeps_actionable_overlap_reason_and_cleans_tempfile(self):
        import tempfile
        from pathlib import Path
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            path = tmp.name
        job = {}
        with patch('qwen_app.infer_long', side_effect=HTTPException(422, 'Overlapping speaker turns require source separation')):
            qwen_app.run_job(job, path, 'id', True)
        self.assertEqual(job['status'], 'failed')
        self.assertIn('Overlapping', job['error'])
        self.assertFalse(Path(path).exists())


if __name__ == '__main__':
    unittest.main()
