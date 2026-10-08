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
    app.state.models.get(MODEL)
    if os.getenv("WHISPER_PRELOAD_MODELS") == "true":
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
    return {"model": MODEL, "models": list(SOURCES), "diarization": app.state.diarizer is not None}


def infer(payload, language, diarize, model):
    # Serialize inference to bound model memory; decode once for both models.
    requested_at = perf_counter()
    with lock:
        acquired_at = perf_counter()
        try:
            audio = decode_audio(io.BytesIO(payload), sampling_rate=16000)
        except Exception as error:
            raise HTTPException(400, "Audio cannot be decoded") from error
        if len(audio) > 16000 * 60:
            raise HTTPException(413, "Maximum audio duration is 60 seconds")
        if not len(audio):
            return {"text": "", "segments": []}
        load_at = perf_counter()
        whisper = app.state.models.get(model)
        inference_at = perf_counter()
        decoded, _ = whisper.transcribe(
            audio, language=language, vad_filter=True, word_timestamps=diarize,
            condition_on_previous_text=False, beam_size=BEAM_SIZE, best_of=1,
        )
        decoded = list(decoded)
        logger.info("STT model=%s audio_s=%.2f wait_ms=%.0f load_ms=%.0f inference_ms=%.0f total_ms=%.0f",
                    model, len(audio) / 16000, (acquired_at-requested_at)*1000,
                    (inference_at-load_at)*1000, (perf_counter()-inference_at)*1000,
                    (perf_counter()-requested_at)*1000)
        if not diarize:
            return {"text": " ".join(s.text.strip() for s in decoded).strip()}
        if not decoded:
            return {"text": "", "segments": []}
        output = app.state.diarizer({
            "waveform": torch.from_numpy(audio.copy()).unsqueeze(0), "sample_rate": 16000,
        })
        turns = [(turn.start, turn.end, speaker)
                 for turn, speaker in output.exclusive_speaker_diarization]
        words = [(w.start, w.end, w.word) for s in decoded for w in (s.words or [])]
        segments = align_words(words, turns)
        return {"text": " ".join(s["text"] for s in segments), "segments": segments}


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
