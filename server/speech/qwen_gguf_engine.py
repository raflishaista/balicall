"""Isolated Q8 engine adapter for the existing speaker-session protocol.

This adapter emits final text only. It is not a native streaming ASR engine.
It is deliberately not registered as an available meeting model yet.
"""
import io
import json
import threading
import urllib.request
import uuid
import wave
from urllib.parse import urlparse

import numpy as np

RATE = 16000
MAX_SAMPLES = RATE * 60


class QwenGgufEngine:
    def __init__(self, url='http://127.0.0.1:8012/v1/audio/transcriptions', *, transcribe=None, speech=None):
        parsed = urlparse(url)
        if parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost', '::1') or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError('Qwen GGUF worker must use a local HTTP URL')
        self.url = url
        self.lock = threading.Lock()
        self._transcribe = transcribe or self._request
        if speech is None:
            from faster_whisper.vad import get_speech_timestamps, VadOptions
            speech = lambda audio: bool(len(audio) and get_speech_timestamps(audio, VadOptions(min_speech_duration_ms=120, min_silence_duration_ms=300)))
        self._speech = speech

    def create_state(self, language):
        if language not in ('id', 'en'):
            raise ValueError('Unsupported language')
        return {'language': language, 'chunks': [], 'samples': 0}

    def feed(self, audio, state):
        clip = np.asarray(audio, dtype=np.float32).copy()
        if state['samples'] + len(clip) > MAX_SAMPLES:
            raise ValueError('Qwen GGUF audio buffer exceeded 60 seconds')
        state['chunks'].append(clip)
        state['samples'] += len(clip)
        return ''

    def finish(self, state):
        chunks = state['chunks']
        state['chunks'] = []
        state['samples'] = 0
        return self.transcribe_turn(np.concatenate(chunks), state['language']) if chunks else ''

    def transcribe_turn(self, audio, language):
        if language not in ('id', 'en') or len(audio) > MAX_SAMPLES:
            raise ValueError('Invalid Qwen GGUF audio or language')
        if not len(audio): return ''
        with self.lock:
            text = self._transcribe(audio, language)
        if not isinstance(text, str): raise ValueError('Invalid Qwen GGUF response')
        return text.strip()

    def speech(self, audio):
        return bool(self._speech(audio))

    def close(self):
        pass

    def _request(self, audio, language):
        output = io.BytesIO()
        with wave.open(output, 'wb') as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(RATE)
            wav.writeframes((np.clip(audio, -1, 1) * 32767).astype('<i2').tobytes())
        boundary = uuid.uuid4().hex
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n{language}\r\n'
                f'--{boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\njson\r\n'
                f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\n'
                'Content-Type: audio/wav\r\n\r\n').encode() + output.getvalue() + f'\r\n--{boundary}--\r\n'.encode()
        request = urllib.request.Request(self.url, data=body, headers={'Content-Type': f'multipart/form-data; boundary={boundary}'}, method='POST')
        with urllib.request.urlopen(request, timeout=90) as response:
            payload = response.read(1024 * 1024 + 1)
        if len(payload) > 1024 * 1024: raise ValueError('Qwen GGUF response too large')
        return json.loads(payload).get('text')
