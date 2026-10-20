"""Nemotron-3 diarization worker. Accepts raw 16 kHz mono int16 PCM, returns speaker turns."""
import logging
import os
import secrets
from contextlib import asynccontextmanager
from threading import Lock
from time import perf_counter

import numpy as np
import torch
from fastapi import FastAPI, Header, HTTPException, Request
from starlette.concurrency import run_in_threadpool
from transformers import AutoModelForAudioFrameClassification, AutoProcessor

MODEL_PATH = os.getenv("NEMOTRON_MODEL_PATH", "/models/nemotron3-diarization")
DEVICE = os.getenv("SPEECH_DEVICE", "cpu")
API_KEY = os.getenv("SPEECH_API_KEY", "")
STREAMING_MODE = os.getenv("NEMOTRON_STREAMING_MODE", "low_latency")
MAX_BYTES = int(os.getenv("NEMOTRON_MAX_MB", "600")) * 1024 * 1024
SAMPLE_RATE = 16000
lock = Lock()
logger = logging.getLogger("uvicorn.error")
torch.set_num_threads(int(os.getenv("NEMOTRON_CPU_THREADS", "4")))


@asynccontextmanager
async def lifespan(app):
    app.state.processor = AutoProcessor.from_pretrained(MODEL_PATH)
    app.state.model = AutoModelForAudioFrameClassification.from_pretrained(MODEL_PATH).to(DEVICE).eval()
    logger.info("Nemotron diarization ready; device=%s; mode=%s", DEVICE, STREAMING_MODE)
    try:
        yield
    finally:
        app.state.model = None


app = FastAPI(lifespan=lifespan)
app.state.model = None
app.state.processor = None


@app.get("/health")
def health():
    return {"ready": app.state.model is not None, "model": "nemotron-3-diarization", "mode": STREAMING_MODE}


def run_diarization(audio):
    processor, model = app.state.processor, app.state.model
    processor.set_streaming_mode(STREAMING_MODE)

    def inputs_generator():
        yield processor(audio[: processor.num_samples_first_audio_chunk], sampling_rate=SAMPLE_RATE,
                        is_streaming=True, is_first_audio_chunk=True)
        mel_frame_idx = processor.num_mel_frames_per_step
        start_idx = processor.audio_chunk_start(mel_frame_idx)
        while (end_idx := start_idx + processor.num_samples_per_audio_chunk) <= audio.shape[0]:
            yield processor(audio[start_idx:end_idx], sampling_rate=SAMPLE_RATE,
                            is_streaming=True, is_first_audio_chunk=False)
            mel_frame_idx += processor.num_mel_frames_per_step
            start_idx = processor.audio_chunk_start(mel_frame_idx)
        yield processor(audio[start_idx:], sampling_rate=SAMPLE_RATE, is_streaming=True,
                        is_first_audio_chunk=False, is_last_audio_chunk=True)

    speaker_cache, logits = None, []
    with torch.inference_mode():
        for inputs in inputs_generator():
            inputs = inputs.to(model.device, dtype=model.dtype)
            outputs = model(**inputs, speaker_cache=speaker_cache)
            logits.append(outputs.logits)
            speaker_cache = outputs.speaker_cache
    logits = torch.cat(logits, dim=1)
    segments = processor.extract_speaker_dict(logits)[0]
    return [{"start": round(float(s["Start"]), 2), "end": round(float(s["End"]), 2),
             "speaker": f"Pembicara {int(s['Speaker']) + 1}"}
            for s in segments if float(s["End"]) >= float(s["Start"])]


def locked_diarization(audio):
    started = perf_counter()
    with lock:
        turns = run_diarization(audio)
    logger.info("Nemotron audio_s=%.1f turns=%d processing_s=%.1f",
                len(audio) / SAMPLE_RATE, len(turns), perf_counter() - started)
    return turns


@app.post("/v1/diarize")
async def diarize(request: Request, authorization: str = Header("")):
    if API_KEY and not secrets.compare_digest(authorization, f"Bearer {API_KEY}"):
        raise HTTPException(401, "Invalid speech service credentials")
    if app.state.model is None:
        raise HTTPException(503, "Nemotron is not ready")
    body = await request.body()
    if not body or len(body) % 2:
        raise HTTPException(400, "Body must be raw 16 kHz mono int16 PCM")
    if len(body) > MAX_BYTES:
        raise HTTPException(413, "Audio too large")
    audio = np.frombuffer(body, dtype="<i2").astype(np.float32) / 32768.0
    duration = len(audio) / SAMPLE_RATE
    if len(audio) < SAMPLE_RATE:
        return {"turns": [], "duration": duration}
    try:
        turns = await run_in_threadpool(locked_diarization, audio)
    except Exception as error:
        logger.exception("Nemotron diarization failed")
        raise HTTPException(502, "Nemotron diarization failed") from error
    return {"turns": turns, "duration": duration} 