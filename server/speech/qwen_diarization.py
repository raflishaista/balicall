"""Qwen adapter for a separate speaker-turn service. No word timestamps/voice identity.

Turns are scoped to one upload. Overlapping turns are rejected: slicing mixed
audio cannot isolate simultaneous voices. Exclusive diarizer output may itself
hide overlap, so success does not guarantee absence of overlapping speech.
"""
import io
import json
import math
import os
import urllib.error
import urllib.request
import uuid
import wave
from urllib.parse import urlparse

import numpy as np
from fastapi import HTTPException

RATE = 16000


def diarizer_ready():
    url = os.getenv('QWEN_DIARIZATION_URL', '')
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
        return False
    # Both supported standalone services expose /health at their origin.
    request = urllib.request.Request(f'{parsed.scheme}://{parsed.netloc}/health')
    key = os.getenv('QWEN_DIARIZATION_API_KEY', '')
    if key:
        request.add_header('Authorization', 'Bearer ' + key)
    try:
        with urllib.request.urlopen(request, timeout=0.75) as response:
            return json.loads(response.read(65536)).get('diarization') is True
    except Exception:
        return False


def request_turns(audio):
    url = os.getenv('QWEN_DIARIZATION_URL', '')
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
        raise HTTPException(503, 'Configure a valid QWEN_DIARIZATION_URL')
    # Existing standalone diarization endpoints accept at most 60 seconds.
    # Do not split uploads here: that would reset speaker labels between chunks.
    limit = int(os.getenv('QWEN_DIARIZATION_MAX_SECONDS', '60'))
    if not 1 <= limit <= 7200:
        raise HTTPException(503, 'QWEN_DIARIZATION_MAX_SECONDS must be 1–7200')
    if len(audio) > RATE * limit:
        raise HTTPException(413, f'Diarization service limit is {limit} seconds; do not split speaker identity across jobs')
    output = io.BytesIO()
    with wave.open(output, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        wav.writeframes((np.clip(audio, -1, 1) * 32767).astype('<i2').tobytes())
    boundary = uuid.uuid4().hex
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\n'
            'Content-Type: audio/wav\r\n\r\n').encode() + output.getvalue() + f'\r\n--{boundary}--\r\n'.encode()
    headers = {'Content-Type': f'multipart/form-data; boundary={boundary}'}
    key = os.getenv('QWEN_DIARIZATION_API_KEY', '')
    if key:
        headers['Authorization'] = 'Bearer ' + key
    request = urllib.request.Request(url, data=body, headers=headers, method='POST')
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = response.read(2 * 1024 * 1024 + 1)
        if len(payload) > 2 * 1024 * 1024:
            raise ValueError('Oversized diarization result')
        result = json.loads(payload)
        turns = result['segments']
        if not isinstance(turns, list):
            raise ValueError('Invalid segments')
        return turns
    except urllib.error.HTTPError as error:
        status = error.code if error.code in (413, 422, 429, 503) else 502
        raise HTTPException(status, 'Diarization service rejected audio; check its configuration, limits and model readiness') from error
    except Exception as error:
        raise HTTPException(502, 'Diarization service unavailable or returned invalid turns') from error


def transcribe_turns(audio, language, recognize, turns, has_speech):
    if not isinstance(turns, list) or not turns or len(turns) > 10000:
        raise HTTPException(502, 'Diarization returned no valid speaker turns for speech')
    duration = len(audio) / RATE
    checked = []
    for turn in turns:
        if not isinstance(turn, dict):
            raise HTTPException(502, 'Invalid diarization turn')
        start, end, speaker = turn.get('start'), turn.get('end'), turn.get('speaker')
        if (type(start) not in (int, float) or type(end) not in (int, float)
                or not math.isfinite(start) or not math.isfinite(end)
                or not 0 <= start < end <= duration + 1 / RATE
                or not isinstance(speaker, str) or not speaker.strip() or len(speaker) > 100):
            raise HTTPException(502, 'Invalid diarization turn bounds or speaker')
        checked.append((max(0, round(start * RATE)), min(len(audio), round(end * RATE)), speaker))
    checked.sort(key=lambda turn: (turn[0], turn[1]))
    for previous, current in zip(checked, checked[1:]):
        if current[0] < previous[1]:
            raise HTTPException(422, 'Overlapping speaker turns require source separation; Qwen slicing cannot separate simultaneous voices')
    segments = []
    for start, end, speaker in checked:
        for offset in range(start, end, 30 * RATE):
            stop = min(end, offset + 30 * RATE)
            clip = audio[offset:stop]
            if not len(clip) or not has_speech(clip):
                continue
            text = recognize(clip, language)
            if not isinstance(text, str):
                raise HTTPException(502, 'Qwen returned invalid transcription')
            if text.strip():
                segments.append({'speaker': speaker, 'start': offset / RATE,
                                 'end': stop / RATE, 'text': text.strip()})
    return {'text': ' '.join(segment['text'] for segment in segments), 'segments': segments}
