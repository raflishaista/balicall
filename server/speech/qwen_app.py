"""Opt-in Qwen STT worker. Run in its own venv on loopback port 8006.

python -m uvicorn qwen_app:app --host 127.0.0.1 --port 8006
faster-whisper is used ONLY for audio decoding and Silero VAD here.
Transcription uses Qwen; word timestamps and diarization are unsupported.
"""
import io
import os
import secrets
import logging
from contextlib import asynccontextmanager
from threading import Lock, BoundedSemaphore
from time import perf_counter
import tempfile
import threading
import time
import uuid

import numpy as np
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from faster_whisper.audio import decode_audio
from faster_whisper.vad import VadOptions, get_speech_timestamps
from starlette.concurrency import run_in_threadpool

MODEL_ALIAS = 'qwen3-asr-0.6b'
LANGUAGES = {'id': 'Indonesian', 'en': 'English'}
inference_lock = Lock()
MAX_PENDING = int(os.getenv('QWEN_MAX_PENDING', '3'))
QUEUE_WAIT_SECONDS = float(os.getenv('QWEN_QUEUE_WAIT_SECONDS', '30'))
if not 0 <= MAX_PENDING <= 16 or not 0 < QUEUE_WAIT_SECONDS <= 45:
    raise ValueError('Qwen pending limit must be 0–16 and queue wait must be >0–45 seconds')
admission = BoundedSemaphore(MAX_PENDING + 1)
logger = logging.getLogger('uvicorn.error')


def precision_name(device):
    value = os.getenv('QWEN_DTYPE', 'float32' if device == 'cpu' else 'float16')
    if value not in ('float32', 'bfloat16', 'float16') or (device == 'cpu' and value == 'float16'):
        raise ValueError('QWEN_DTYPE must be float32/bfloat16 on CPU or float32/bfloat16/float16 on GPU')
    return value


def speech_regions(audio):
    return get_speech_timestamps(audio, VadOptions(
        threshold=0.5, min_speech_duration_ms=120, min_silence_duration_ms=300,
    ))


def recognize_audio(audio, language, recognize, detect_speech=speech_regions):
    if not len(audio) or not detect_speech(audio):
        return {'text': ''}
    # Keep the original clip for context; VAD gates inference, not identity.
    text = recognize(audio, LANGUAGES[language])
    if not isinstance(text, str):
        raise HTTPException(502, 'Qwen returned invalid transcription')
    return {'text': text.strip()}


@asynccontextmanager
async def lifespan(app):
    import torch
    from qwen_asr import Qwen3ASRModel

    app.state.recognize = None
    app.state.api_key = os.getenv('SPEECH_API_KEY', '')
    if os.getenv('NODE_ENV') == 'production' and not app.state.api_key:
        raise RuntimeError('Production Qwen worker requires SPEECH_API_KEY')
    device = os.getenv('SPEECH_DEVICE', 'cpu')
    precision = precision_name(device)
    app.state.device = device
    app.state.precision = precision
    torch.set_num_threads(int(os.getenv('QWEN_CPU_THREADS', '4')))
    checkpoint = os.getenv('QWEN_MODEL_PATH', 'Qwen/Qwen3-ASR-0.6B')
    options = dict(dtype=getattr(torch, precision),
        device_map=device, attn_implementation='eager',
        max_inference_batch_size=1, max_new_tokens=256,
        local_files_only=os.getenv('QWEN_LOCAL_FILES_ONLY') == 'true')
    if checkpoint == 'Qwen/Qwen3-ASR-0.6B':
        options['revision'] = os.getenv('QWEN_MODEL_REVISION', '5eb144179a02acc5e5ba31e748d22b0cf3e303b0')
    model = Qwen3ASRModel.from_pretrained(checkpoint, **options)
    speech_regions(np.zeros(16000, dtype=np.float32))

    def recognize(audio, language):
        with torch.inference_mode():
            return model.transcribe(audio=(audio, 16000), language=language,
                                    return_time_stamps=False)[0].text

    app.state.recognize = recognize
    logger.info('Qwen worker ready; device=%s; precision=%s; Silero VAD enabled; diarization unsupported', device, precision)
    try:
        yield
    finally:
        app.state.recognize = None


app = FastAPI(lifespan=lifespan)
app.state.recognize = None
app.state.api_key = os.getenv('SPEECH_API_KEY', '')


@app.get('/health')
def health():
    ready = app.state.recognize is not None
    return {'ready': ready, 'model': MODEL_ALIAS, 'models': [MODEL_ALIAS] if ready else [],
            'vad': 'silero', 'diarization': False, 'wordTimestamps': False}


def infer(payload, language):
    requested_at = perf_counter()
    if not admission.acquire(blocking=False):
        raise HTTPException(429, 'Qwen queue is full; retry this audio request', headers={'Retry-After': '2'})
    acquired = False
    try:
        acquired = inference_lock.acquire(timeout=QUEUE_WAIT_SECONDS)
        if not acquired:
            raise HTTPException(503, 'Qwen queue wait exceeded; retry this audio request', headers={'Retry-After': '2'})
        acquired_at = perf_counter()
        try:
            audio = decode_audio(io.BytesIO(payload), sampling_rate=16000)
        except Exception as error:
            raise HTTPException(400, 'Audio cannot be decoded') from error
        if len(audio) > 16000 * 60:
            raise HTTPException(413, 'Maximum audio duration is 60 seconds')
        if not np.isfinite(audio).all():
            raise HTTPException(400, 'Audio contains invalid samples')
        result = recognize_audio(audio, language, app.state.recognize)
        logger.info('Qwen audio_s=%.2f wait_ms=%.0f processing_ms=%.0f', len(audio) / 16000,
                    (acquired_at - requested_at) * 1000, (perf_counter() - acquired_at) * 1000)
        return result
    except HTTPException:
        raise
    except Exception as error:
        logger.exception('Qwen inference failed')
        raise HTTPException(502, 'Qwen transcription failed') from error
    finally:
        if acquired:
            inference_lock.release()
        admission.release()


@app.post('/v1/audio/transcriptions')
async def transcribe(file: UploadFile = File(...), model: str = Form(...),
    language: str = Form('id'), response_format: str = Form('json'),
    diarize: bool = Form(False), authorization: str = Header('')):
    if app.state.api_key and not secrets.compare_digest(authorization, 'Bearer ' + app.state.api_key):
        raise HTTPException(401, 'Invalid speech service credentials')
    if model != MODEL_ALIAS or language not in LANGUAGES or response_format != 'json':
        raise HTTPException(400, 'Unsupported model, language or response format')
    if diarize:
        raise HTTPException(400, 'Qwen does not support diarization in this integration')
    if app.state.recognize is None:
        raise HTTPException(503, 'Qwen is not ready')
    payload = await file.read(5 * 1024 * 1024 + 1)
    if not payload or len(payload) > 5 * 1024 * 1024:
        raise HTTPException(413, 'Audio must contain 1 byte to 5 MB')
    return await run_in_threadpool(infer, payload, language)

# ---------------------------------------------------------------------------
# Long recordings: asynchronous job API (upload -> job_id -> poll).
# VAD splits audio into chunks of at most CHUNK_SECONDS; each chunk takes the
# inference lock separately, so live requests can interleave between chunks.
# ---------------------------------------------------------------------------
LONG_MAX_BYTES = int(os.getenv('LONG_AUDIO_MAX_MB', '500')) * 1024 * 1024
LONG_MAX_SECONDS = int(os.getenv('LONG_AUDIO_MAX_MINUTES', '120')) * 60
LONG_TMP_DIR = os.getenv('LONG_AUDIO_TMP_DIR') or None
JOB_TTL_SECONDS = int(os.getenv('LONG_JOB_TTL_MINUTES', '120')) * 60
CHUNK_SECONDS = 30
CHUNK_PAD = int(0.3 * 16000)
jobs = {}


def check_auth(authorization):
    if app.state.api_key and not secrets.compare_digest(authorization, 'Bearer ' + app.state.api_key):
        raise HTTPException(401, 'Invalid speech service credentials')


def purge_jobs():
    now = time.time()
    for job_id in [k for k, j in jobs.items()
                   if j.get('finished_at') and now - j['finished_at'] > JOB_TTL_SECONDS]:
        jobs.pop(job_id, None)


def plan_chunks(regions):
    """Group VAD regions (sample indices) into chunks no longer than CHUNK_SECONDS."""
    limit = CHUNK_SECONDS * 16000
    chunks, current = [], None
    for region in regions:
        start, end = region['start'], region['end']
        while end - start > limit:  # one long region: cut it hard
            if current:
                chunks.append(current)
                current = None
            chunks.append((start, start + limit))
            start += limit
        if current and end - current[0] <= limit:
            current = (current[0], end)
        else:
            if current:
                chunks.append(current)
            current = (start, end)
    if current:
        chunks.append(current)
    return chunks


def infer_long(job, path, language):
    job['status'] = 'running'
    try:
        audio = decode_audio(path, sampling_rate=16000)
    except Exception as error:
        raise ValueError('Audio cannot be decoded') from error
    duration = len(audio) / 16000
    if duration > LONG_MAX_SECONDS:
        raise ValueError(f'Maximum audio duration is {LONG_MAX_SECONDS // 60} minutes')
    if not len(audio):
        return {'text': '', 'segments': [], 'duration': 0.0}
    if not np.isfinite(audio).all():
        raise ValueError('Audio contains invalid samples')
    started = perf_counter()
    parts = []
    chunks = plan_chunks(speech_regions(audio))
    for start, end in chunks:
        clip = audio[max(0, start - CHUNK_PAD):min(len(audio), end + CHUNK_PAD)]
        with inference_lock:
            text = app.state.recognize(clip, LANGUAGES[language])
        if not isinstance(text, str):
            raise ValueError('Qwen returned invalid transcription')
        if text.strip():
            parts.append(text.strip())
    logger.info('Qwen LONG audio_s=%.1f chunks=%d inference_s=%.1f',
                duration, len(chunks), perf_counter() - started)
    return {'text': ' '.join(parts), 'segments': [], 'duration': duration}


def run_job(job, path, language):
    try:
        job['result'] = infer_long(job, path, language)
        job['status'] = 'done'
    except Exception as error:
        logger.exception('Qwen long transcription job failed')
        job['status'] = 'failed'
        job['error'] = str(error) if isinstance(error, ValueError) else 'Transcription failed'
    finally:
        job['finished_at'] = time.time()
        try:
            os.remove(path)
        except OSError:
            pass


@app.post('/v1/audio/transcriptions/jobs', status_code=202)
async def submit_long(file: UploadFile = File(...), model: str = Form(...),
                      language: str = Form('id'), diarize: bool = Form(False),
                      authorization: str = Header('')):
    check_auth(authorization)
    if model != MODEL_ALIAS or language not in LANGUAGES:
        raise HTTPException(400, 'Unsupported model or language')
    if diarize:
        raise HTTPException(400, 'Qwen does not support diarization in this integration')
    if app.state.recognize is None:
        raise HTTPException(503, 'Qwen is not ready')
    purge_jobs()
    fd, path = tempfile.mkstemp(suffix='.upload', dir=LONG_TMP_DIR)
    size = 0
    try:
        with os.fdopen(fd, 'wb') as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > LONG_MAX_BYTES:
                    raise HTTPException(413, f'Maximum file size is {LONG_MAX_BYTES // (1024 * 1024)} MB')
                await run_in_threadpool(out.write, chunk)
        if size == 0:
            raise HTTPException(400, 'Audio file is empty')
    except Exception:
        try:
            os.remove(path)
        except OSError:
            pass
        raise
    job_id = uuid.uuid4().hex
    job = {'status': 'queued', 'error': None, 'result': None, 'finished_at': None}
    jobs[job_id] = job
    threading.Thread(target=run_job, args=(job, path, language), daemon=True).start()
    return {'job_id': job_id, 'status': 'queued'}


@app.get('/v1/audio/transcriptions/jobs/{job_id}')
def job_status(job_id: str, authorization: str = Header('')):
    check_auth(authorization)
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, 'Job not found')
    return {'status': job['status'], 'error': job['error'],
            'result': job['result'] if job['status'] == 'done' else None}