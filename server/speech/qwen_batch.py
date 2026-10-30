"""One Nemotron pass over the recording, then bounded Qwen inference per turn.

Labels are recording-scoped anonymous speakers. They are not account identities.
Mixed speech is decoded once and marked overlap; it is never attributed to one
of the simultaneous voices or advertised as separated audio.
"""
import json
import math
import os
import urllib.request
from collections import Counter

import numpy as np

RATE = 16000


def nemotron_turns(audio):
    base = os.environ.get('QWEN_BATCH_NEMOTRON_URL', '').rstrip('/')
    if not base.startswith(('http://', 'https://')):
        raise ValueError('Configure QWEN_BATCH_NEMOTRON_URL')
    key = os.environ.get('QWEN_BATCH_NEMOTRON_KEY', '')
    request = urllib.request.Request(base + '/v1/diarize',
        data=(np.clip(audio, -1, 1) * 32767).astype('<i2').tobytes(),
        headers={'Content-Type': 'application/octet-stream',
                 **({'Authorization': 'Bearer ' + key} if key else {})})
    with urllib.request.urlopen(request, timeout=int(os.getenv('QWEN_BATCH_NEMOTRON_TIMEOUT', '1800'))) as response:
        payload = response.read(16 * 1024 * 1024 + 1)
    if len(payload) > 16 * 1024 * 1024:
        raise ValueError('Nemotron result is too large')
    return json.loads(payload)['turns']


def nemotron_ready():
    base = os.environ.get('QWEN_BATCH_NEMOTRON_URL', '').rstrip('/')
    if not base:
        return False
    key = os.environ.get('QWEN_BATCH_NEMOTRON_KEY', '')
    try:
        request = urllib.request.Request(base + '/health', headers={'Authorization': 'Bearer ' + key} if key else {})
        with urllib.request.urlopen(request, timeout=0.75) as response:
            data = json.loads(response.read(65536))
        return data.get('ready') is True and data.get('model') == 'nemotron-3-diarization'
    except Exception:
        return False


def timeline(turns, duration):
    if not isinstance(turns, list) or not turns or len(turns) > 100000:
        raise ValueError('Nemotron returned no valid turns')
    events = {}
    aliases = {}
    for turn in turns:
        start, end, speaker = turn.get('start'), turn.get('end'), turn.get('speaker')
        if (type(start) not in (int, float) or type(end) not in (int, float)
                or not math.isfinite(start) or not math.isfinite(end)
                or not 0 <= start < end <= duration + 0.02
                or not isinstance(speaker, str) or not speaker.strip() or len(speaker) > 100):
            raise ValueError('Invalid Nemotron turn')
        if speaker not in aliases:
            aliases[speaker] = f'Pembicara {len(aliases) + 1}'
        for at, delta in ((round(start * RATE), 1), (min(round(end * RATE), round(duration * RATE)), -1)):
            events.setdefault(at, []).append((speaker, delta))
    active = Counter()
    previous = 0
    spans = []
    for at in sorted(events):
        speakers = frozenset(key for key, count in active.items() if count > 0)
        if at > previous:
            label = aliases[next(iter(speakers))] if len(speakers) == 1 else 'Bertumpuk' if speakers else 'Belum diketahui'
            overlap = len(speakers) > 1
            if spans and spans[-1]['end'] == previous and spans[-1]['speaker'] == label and spans[-1]['overlap'] == overlap:
                spans[-1]['end'] = at
            else:
                spans.append({'start': previous, 'end': at, 'speaker': label, 'overlap': overlap})
        for speaker, delta in events[at]:
            active[speaker] += delta
        previous = at
    if previous < round(duration * RATE):
        spans.append({'start': previous, 'end': round(duration * RATE), 'speaker': 'Belum diketahui', 'overlap': False})
    return spans


def transcribe_recording(audio, language, recognize, has_speech, turns):
    duration = len(audio) / RATE
    spans = timeline(turns, duration)
    segments = []
    for span in spans:
        for start in range(span['start'], span['end'], 30 * RATE):
            end = min(start + 30 * RATE, span['end'])
            clip = audio[start:end]
            if not len(clip) or not has_speech(clip):
                continue
            text = recognize(clip, language)
            if not isinstance(text, str):
                raise ValueError('Qwen returned invalid text')
            if text.strip():
                segments.append({**span, 'start': start / RATE, 'end': end / RATE, 'text': text.strip()})
    return {'text': ' '.join(s['text'] for s in segments), 'segments': segments,
            'duration': duration, 'model': 'qwen3-asr-0.6b',
            'diarizer': 'nemotron', 'speaker_scope': 'recording'}
