import io
import unittest
import wave
import time
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import numpy as np
import qwen_app
from fastapi.testclient import TestClient

from qwen_app import app, recognize_audio, infer


def wav(seconds=3):
    output = io.BytesIO()
    with wave.open(output, 'wb') as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(16000)
        stream.writeframes(bytes(int(seconds * 16000) * 2))
    return output.getvalue()


class QwenTests(unittest.TestCase):
    def test_cpu_precision_is_explicit_and_rejects_invalid_configuration(self):
        with patch.dict('os.environ', {'QWEN_DTYPE': 'bfloat16'}):
            self.assertEqual(qwen_app.precision_name('cpu'), 'bfloat16')
        with patch.dict('os.environ', {'QWEN_DTYPE': 'invalid'}):
            with self.assertRaises(ValueError):
                qwen_app.precision_name('cpu')

    def test_two_participants_wait_for_inference_without_exhausting_client_retries(self):
        def recognize(*_):
            time.sleep(0.2)
            return 'Jaringan aktif.'
        app.state.recognize = recognize
        with patch('qwen_app.speech_regions', return_value=[{'start': 0, 'end': 16000}]), patch('qwen_app.recognize_audio', wraps=lambda audio, language, recognize: {'text': recognize(audio, language)}):
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(infer, wav(1), 'id') for _ in range(2)]
                self.assertEqual([f.result() for f in futures], [{'text': 'Jaringan aktif.'}] * 2)

    def test_real_silero_vad_skips_silence_without_invoking_asr(self):
        def forbidden(*args):
            self.fail('Silence must never reach Qwen inference')
        self.assertEqual(recognize_audio(np.zeros(16000 * 3, dtype=np.float32), 'id', forbidden), {'text': ''})

    def test_speech_gate_preserves_waveform_and_maps_language(self):
        audio = np.ones(16000, dtype=np.float32)
        calls = []
        def recognize(received, language):
            self.assertIs(received, audio)
            calls.append(language)
            return '  Jaringan aktif. '
        self.assertEqual(recognize_audio(audio, 'id', recognize, lambda a: [{'start': 0, 'end': len(a)}]), {'text': 'Jaringan aktif.'})
        self.assertEqual(calls, ['Indonesian'])

    def test_endpoint_validates_auth_diarization_model_and_audio(self):
        app.state.recognize = lambda *_: 'should not run on silence'
        app.state.api_key = 'worker-only'
        client = TestClient(app)
        data = {'model': 'qwen3-asr-0.6b', 'language': 'id', 'response_format': 'json'}
        upload = {'file': ('clip.wav', wav(), 'audio/wav')}
        headers = {'Authorization': 'Bearer worker-only'}
        self.assertEqual(client.post('/v1/audio/transcriptions', data=data, files=upload).status_code, 401)
        self.assertEqual(client.post('/v1/audio/transcriptions', data={**data, 'diarize': 'true'}, files=upload, headers=headers).status_code, 400)
        self.assertEqual(client.post('/v1/audio/transcriptions', data={**data, 'model': 'small'}, files=upload, headers=headers).status_code, 400)
        self.assertEqual(client.post('/v1/audio/transcriptions', data={**data, 'language': 'xx'}, files=upload, headers=headers).status_code, 400)
        self.assertEqual(client.post('/v1/audio/transcriptions', data=data, files={'file': ('bad.wav', b'bad')}, headers=headers).status_code, 400)
        self.assertEqual(client.post('/v1/audio/transcriptions', data=data, files={'file': ('long.wav', wav(61))}, headers=headers).status_code, 413)
        self.assertEqual(client.post('/v1/audio/transcriptions', data=data, files=upload, headers=headers).json(), {'text': ''})


if __name__ == '__main__':
    unittest.main()
