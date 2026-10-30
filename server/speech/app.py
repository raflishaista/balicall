"""Local Whisper STT with optional pyannote speaker diarization.

Run from this directory: python -m uvicorn app:app --host 127.0.0.1 --port 8001
Speaker labels belong to one upload, not a persistent meeting identity.
"""
import io
import os
import secrets
import logging
from time import perf_counter
from contextlib import asynccontextmanager
from threading import Lock

# import library fitur upload file meeting
import tempfile
import threading
import time
import uuid

import json
import urllib.request
import numpy as np

import torch
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from faster_whisper import WhisperModel, decode_audio
from starlette.concurrency import run_in_threadpool

from alignment import align_words
from models import ModelRegistry, model_sources

MODEL = os.getenv("WHISPER_MODEL", "small")
DEVICE = os.getenv("SPEECH_DEVICE", "cpu")
API_KEY = os.getenv("SPEECH_API_KEY", "")
HF_TOKEN = os.getenv("HF_TOKEN", "")
DIARIZATION_ONLY = os.getenv("SPEECH_DIARIZATION_ONLY") == "true"
lock = Lock()
SOURCES = model_sources(MODEL, os.getenv("WHISPER_SMALL_ID_PATH", ""))
BEAM_SIZE = int(os.getenv("WHISPER_BEAM_SIZE", "1"))
CPU_THREADS = int(os.getenv("WHISPER_CPU_THREADS", "4"))
logger = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(app):
    app.state.models = ModelRegistry(SOURCES, lambda source: WhisperModel(
        source, device=DEVICE,
        cpu_threads=CPU_THREADS,
        compute_type=os.getenv("WHISPER_COMPUTE_TYPE", "int8" if DEVICE == "cpu" else "float16"),
    ), capacity=int(os.getenv("WHISPER_MODEL_CACHE_SIZE", "1")))
    if not DIARIZATION_ONLY:
        app.state.models.get(MODEL)
    if not DIARIZATION_ONLY and os.getenv("WHISPER_PRELOAD_MODELS") == "true":
        for alias in SOURCES:
            app.state.models.get(alias)
    app.state.diarizer = None
    if HF_TOKEN:
        from pyannote.audio import Pipeline
        app.state.diarizer = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-community-1", token=HF_TOKEN,
        ).to(torch.device(DEVICE))
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/health")
def health():
    return {"model": app.state.models.active, "models": list(SOURCES), "diarization": app.state.diarizer is not None,
            "diarizers": [name for name, ok in (("pyannote", app.state.diarizer is not None),
                                                 ("nemotron", bool(NEMOTRON_URL))) if ok]}


def decode_waveform(payload):
    try:
        audio = decode_audio(io.BytesIO(payload), sampling_rate=16000)
    except Exception as error:
        raise HTTPException(400, "Audio cannot be decoded") from error
    if len(audio) > 16000 * 60:
        raise HTTPException(413, "Maximum audio duration is 60 seconds")
    return audio


def transcribe_waveform(audio, language, diarize, whisper):
    decoded, _ = whisper.transcribe(
        audio, language=language, vad_filter=True, word_timestamps=diarize,
        condition_on_previous_text=False, beam_size=BEAM_SIZE, best_of=1,
    )
    return list(decoded)


def diarize_waveform(audio):
    if app.state.diarizer is None:
        raise HTTPException(503, "Diarization model is not available")
    try:
        output = app.state.diarizer({
            "waveform": torch.from_numpy(audio.copy()).unsqueeze(0), "sample_rate": 16000,
        })
        return [(turn.start, turn.end, speaker) for turn, speaker in output.exclusive_speaker_diarization]
    except Exception as error:
        raise HTTPException(502, "Diarization inference failed") from error


def infer(payload, language, diarize, model):
    # Serialize inference to bound model memory; decode once for both models.
    requested_at = perf_counter()
    with lock:
        acquired_at = perf_counter()
        audio = decode_waveform(payload)
        if not len(audio):
            return {"text": "", "segments": []}
        load_at = perf_counter()
        whisper = app.state.models.get(model)
        inference_at = perf_counter()
        decoded = transcribe_waveform(audio, language, diarize, whisper)
        logger.info("STT model=%s audio_s=%.2f wait_ms=%.0f load_ms=%.0f inference_ms=%.0f total_ms=%.0f",
                    model, len(audio) / 16000, (acquired_at-requested_at)*1000,
                    (inference_at-load_at)*1000, (perf_counter()-inference_at)*1000,
                    (perf_counter()-requested_at)*1000)
        if not diarize:
            return {"text": " ".join(s.text.strip() for s in decoded).strip()}
        if not decoded:
            return {"text": "", "segments": []}
        turns = diarize_waveform(audio)
        words = [(w.start, w.end, w.word) for s in decoded for w in (s.words or [])]
        segments = align_words(words, turns)
        return {"text": " ".join(s["text"] for s in segments), "segments": segments}


def infer_diarization(payload):
    with lock:
        audio = decode_waveform(payload)
        turns = diarize_waveform(audio) if len(audio) else []
        return {"segments": [{"speaker": speaker, "start": start, "end": end} for start, end, speaker in turns]}


@app.post("/v1/audio/diarizations")
async def diarize_audio(file: UploadFile = File(...), authorization: str = Header("")):
    if API_KEY and not secrets.compare_digest(authorization, f"Bearer {API_KEY}"):
        raise HTTPException(401, "Invalid speech service credentials")
    if app.state.diarizer is None:
        raise HTTPException(503, "Diarization model is not available")
    payload = await file.read(5 * 1024 * 1024 + 1)
    if not payload or len(payload) > 5 * 1024 * 1024:
        raise HTTPException(413, "Audio must contain 1 byte to 5 MB")
    return await run_in_threadpool(infer_diarization, payload)


@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...), model: str = Form(...),
    language: str = Form("id"), response_format: str = Form("json"),
    diarize: bool = Form(False), authorization: str = Header(""),
):
    if API_KEY and not secrets.compare_digest(authorization, f"Bearer {API_KEY}"):
        raise HTTPException(401, "Invalid speech service credentials")
    if model not in SOURCES or language not in ("id", "en") or response_format != "json":
        raise HTTPException(400, "Unsupported model, language or response format")
    if diarize and app.state.diarizer is None:
        raise HTTPException(503, "Diarization requires HF_TOKEN and accepted model access")
    payload = await file.read(5 * 1024 * 1024 + 1)
    if not payload or len(payload) > 5 * 1024 * 1024:
        raise HTTPException(413, "Audio must contain 1 byte to 5 MB")
    return await run_in_threadpool(infer, payload, language, diarize, model)

# ---------------------------------------------------------------------------
# Long recordings: asynchronous job API (upload -> job_id -> poll).
# Reuses the same `lock` as live STT, so live requests queue while a long
# recording is processed. Run a second worker on another port to avoid that.
# ---------------------------------------------------------------------------
LONG_MAX_BYTES = int(os.getenv("LONG_AUDIO_MAX_MB", "500")) * 1024 * 1024
LONG_MAX_SECONDS = int(os.getenv("LONG_AUDIO_MAX_MINUTES", "120")) * 60
LONG_TMP_DIR = os.getenv("LONG_AUDIO_TMP_DIR") or None
JOB_TTL_SECONDS = int(os.getenv("LONG_JOB_TTL_MINUTES", "120")) * 60
jobs = {}


def check_auth(authorization):
    if API_KEY and not secrets.compare_digest(authorization, f"Bearer {API_KEY}"):
        raise HTTPException(401, "Invalid speech service credentials")


def purge_jobs():
    now = time.time()
    for job_id in [k for k, j in jobs.items()
                   if j.get("finished_at") and now - j["finished_at"] > JOB_TTL_SECONDS]:
        jobs.pop(job_id, None)

NEMOTRON_URL = os.getenv("NEMOTRON_URL", "")
NEMOTRON_API_KEY = os.getenv("NEMOTRON_API_KEY", "")
NEMOTRON_TIMEOUT = int(os.getenv("NEMOTRON_TIMEOUT_SECONDS", "3600"))


def nemotron_turns(audio):
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    headers = {"Content-Type": "application/octet-stream"}
    if NEMOTRON_API_KEY:
        headers["Authorization"] = f"Bearer {NEMOTRON_API_KEY}"
    request = urllib.request.Request(NEMOTRON_URL.rstrip("/") + "/v1/diarize",
                                     data=pcm, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=NEMOTRON_TIMEOUT) as response:
            data = json.load(response)
    except Exception as error:
        raise ValueError("Worker Nemotron tidak dapat dijangkau atau gagal memproses audio") from error
    return [(t["start"], t["end"], t["speaker"]) for t in data.get("turns", [])]

def infer_long(job, path, language, diarize, model, diarizer="pyannote"):
    with lock:
        job["status"] = "running"
        try:
            audio = decode_audio(path, sampling_rate=16000)
        except Exception as error:
            raise ValueError("Audio cannot be decoded") from error
        duration = len(audio) / 16000
        if duration > LONG_MAX_SECONDS:
            raise ValueError(f"Maximum audio duration is {LONG_MAX_SECONDS // 60} minutes")
        if not len(audio):
            return {"text": "", "segments": [], "duration": 0.0}
        whisper = app.state.models.get(model)
        started = perf_counter()
        decoded, _ = whisper.transcribe(
            audio, language=language, vad_filter=True, word_timestamps=diarize,
            condition_on_previous_text=False, beam_size=BEAM_SIZE, best_of=1,
        )
        decoded = list(decoded)
        logger.info("LONG STT model=%s audio_s=%.1f inference_s=%.1f",
                    model, duration, perf_counter() - started)
        if not diarize:
            return {"text": " ".join(s.text.strip() for s in decoded).strip(),
                    "segments": [], "duration": duration}
        if not decoded:
            return {"text": "", "segments": [], "duration": duration}
        if diarizer == "nemotron":
            turns = nemotron_turns(audio)
        else:
            output = app.state.diarizer({
                "waveform": torch.from_numpy(audio.copy()).unsqueeze(0), "sample_rate": 16000,
            })
            turns = [(turn.start, turn.end, speaker)
                     for turn, speaker in output.exclusive_speaker_diarization]
        words = [(w.start, w.end, w.word) for s in decoded for w in (s.words or [])]
        segments = align_words(words, turns)
        return {"text": " ".join(s["text"] for s in segments),
                "segments": segments, "duration": duration}


def run_job(job, path, language, diarize, model, diarizer="pyannote"):
    try:
        job["result"] = infer_long(job, path, language, diarize, model, diarizer)
        job["status"] = "done"
    except Exception as error:
        logger.exception("Long transcription job failed")
        job["status"] = "failed"
        job["error"] = str(error) if isinstance(error, ValueError) else "Transcription failed"
    finally:
        job["finished_at"] = time.time()
        try:
            os.remove(path)
        except OSError:
            pass


@app.post("/v1/audio/transcriptions/jobs", status_code=202)
async def submit_long(
    file: UploadFile = File(...), model: str = Form(...),
    language: str = Form("id"), diarize: bool = Form(False),
    diarizer: str = Form("pyannote"),
    authorization: str = Header(""),
):
    check_auth(authorization)
    if model not in SOURCES or language not in ("id", "en"):
        raise HTTPException(400, "Unsupported model or language")
    if diarize and diarizer not in ("pyannote", "nemotron"):
        raise HTTPException(400, "Unsupported diarizer")
    if diarize and diarizer == "pyannote" and app.state.diarizer is None:
        raise HTTPException(503, "Diarization requires HF_TOKEN and accepted model access")
    if diarize and diarizer == "nemotron" and not NEMOTRON_URL:
        raise HTTPException(503, "Nemotron worker is not configured (NEMOTRON_URL)")
    purge_jobs()
    fd, path = tempfile.mkstemp(suffix=".upload", dir=LONG_TMP_DIR)
    size = 0
    try:
        with os.fdopen(fd, "wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > LONG_MAX_BYTES:
                    raise HTTPException(413, f"Maximum file size is {LONG_MAX_BYTES // (1024 * 1024)} MB")
                await run_in_threadpool(out.write, chunk)
        if size == 0:
            raise HTTPException(400, "Audio file is empty")
    except Exception:
        try:
            os.remove(path)
        except OSError:
            pass
        raise
    job_id = uuid.uuid4().hex
    job = {"status": "queued", "error": None, "result": None, "finished_at": None}
    jobs[job_id] = job
    threading.Thread(target=run_job, args=(job, path, language, diarize, model, diarizer), daemon=True).start()
    return {"job_id": job_id, "status": "queued"}


@app.get("/v1/audio/transcriptions/jobs/{job_id}")
def job_status(job_id: str, authorization: str = Header("")):
    check_auth(authorization)
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    return {"status": job["status"], "error": job["error"],
            "result": job["result"] if job["status"] == "done" else None}