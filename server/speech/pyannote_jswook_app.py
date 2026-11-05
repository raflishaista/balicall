"""Standalone CPU diarization using JSWOOK segmentation and Community-1 clustering."""

import io
import logging
import os
import secrets
import subprocess
import tempfile
import wave
from contextlib import asynccontextmanager
from pathlib import Path
from threading import Lock

import numpy as np
import torch
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from faster_whisper import WhisperModel
from pyannote.audio import Pipeline
from safetensors.torch import load_file

from alignment import align_words

MODEL = "JSWOOK/pyannote_2_finetuning"
REVISION = "4f36ffa5e5452ce51ecbfaa7edd3f4bb9b2cdea2"
STT_MODEL = "small"
DIARIZER = "pyannote-jswook"
RATE = 16000
MAX_SECONDS = 60
MAX_BYTES = RATE * MAX_SECONDS * 2 + 4096
busy = Lock()


@asynccontextmanager
async def lifespan(app):
    app.state.key = Path(os.environ["PYANNOTE_JSWOOK_KEY_FILE"]).read_text().strip()
    if not app.state.key:
        raise RuntimeError("Diarization service key is empty")
    torch.set_num_threads(2)
    pipeline = Pipeline.from_pretrained(Path(os.environ["PYANNOTE_JSWOOK_BASE"]))
    weights = load_file(str(Path(os.environ["PYANNOTE_JSWOOK_CHECKPOINT"]) / "model.safetensors"))
    pipeline._segmentation.model.load_state_dict(
        {key.removeprefix("model."): value for key, value in weights.items()}, strict=True,
    )
    app.state.pipeline = pipeline.to(torch.device("cpu"))
    app.state.whisper = None
    yield


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health")
def health():
    model_path = os.getenv("PYANNOTE_JSWOOK_WHISPER")
    recording_ready = bool(model_path and (Path(model_path) / "model.bin").is_file())
    return {"diarization": True, "model": MODEL, "revision": REVISION,
            "device": "cpu", "maxSeconds": MAX_SECONDS,
            "recordingTranscription": recording_ready,
            "recordingModels": [{"model": STT_MODEL, "diarizers": [DIARIZER]}] if recording_ready else []}


def decode_wav(payload):
    try:
        with wave.open(io.BytesIO(payload), "rb") as audio:
            if (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) != (RATE, 1, 2):
                raise HTTPException(422, "Expected a mono 16 kHz PCM16 WAV")
            frames = audio.getnframes()
            if frames > RATE * MAX_SECONDS:
                raise HTTPException(413, f"Audio must be at most {MAX_SECONDS} seconds")
            data = audio.readframes(frames)
            if not frames or len(data) != frames * 2:
                raise HTTPException(422, "Empty or incomplete WAV")
    except (wave.Error, EOFError) as error:
        raise HTTPException(422, "Invalid PCM WAV") from error
    return torch.from_numpy(np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768).unsqueeze(0)


def acquire(authorization):
    if not secrets.compare_digest(authorization, f"Bearer {app.state.key}"):
        raise HTTPException(401, "Invalid diarization service credentials")
    if not busy.acquire(blocking=False):
        raise HTTPException(429, "Diarization worker is busy")


def speaker_turns(waveform):
    duration = waveform.shape[-1] / RATE
    with torch.inference_mode():
        output = app.state.pipeline({"waveform": waveform, "sample_rate": RATE})
    turns = []
    for turn, _, speaker in output.exclusive_speaker_diarization.itertracks(yield_label=True):
        start, end = max(0.0, turn.start), min(duration, turn.end)
        if end > start:
            turns.append((start, end, speaker))
    return turns


@app.post("/v1/audio/diarizations")
def diarize(file: UploadFile = File(...), authorization: str = Header("")):
    acquire(authorization)
    try:
        payload = file.file.read(MAX_BYTES + 1)
        if len(payload) > MAX_BYTES:
            raise HTTPException(413, "WAV exceeds the upload limit")
        segments = [{"start": start, "end": end, "speaker": speaker}
                    for start, end, speaker in speaker_turns(decode_wav(payload))]
        return {"segments": segments, "model": MODEL, "speaker_scope": "recording"}
    finally:
        busy.release()


def decode_recording(file, filename):
    extension = Path(filename or "").suffix.lower()
    formats = {".mp3": "mp3", ".mp4": "mp4"}
    if extension not in formats:
        raise HTTPException(415, "Hanya file MP3 dan MP4 yang didukung.")
    with tempfile.NamedTemporaryFile(suffix=extension) as recording:
        total = 0
        while chunk := file.read(1024 * 1024):
            total += len(chunk)
            if total > 500 * 1024 * 1024:
                raise HTTPException(413, "Ukuran rekaman melebihi 500 MB.")
            recording.write(chunk)
        recording.flush()
        try:
            pcm = subprocess.run(
                ["ffmpeg", "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe",
                 "-f", formats[extension], "-threads", "1", "-i", recording.name, "-map", "0:a:0",
                 "-t", str(MAX_SECONDS + 1), "-ac", "1", "-ar", str(RATE), "-f", "s16le", "pipe:1"],
                capture_output=True, check=True, timeout=30,
            ).stdout
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            raise HTTPException(422, "Audio rekaman tidak dapat dibaca.") from error
    if not pcm:
        raise HTTPException(422, "Rekaman tidak berisi audio.")
    if len(pcm) > MAX_SECONDS * RATE * 2:
        raise HTTPException(413, "Pyannote JSWOOK mendukung audio hingga 60 detik.")
    return np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768


@app.post("/v1/audio/transcriptions")
def transcribe(file: UploadFile = File(...), language: str = Form("id"), authorization: str = Header("")):
    acquire(authorization)
    try:
        model_path = os.getenv("PYANNOTE_JSWOOK_WHISPER")
        if not model_path:
            raise HTTPException(503, "Whisper Small belum dikonfigurasi.")
        if language not in ("id", "en"):
            raise HTTPException(422, "Bahasa harus id atau en.")
        audio = decode_recording(file.file, file.filename)
        if app.state.whisper is None:
            app.state.whisper = WhisperModel(model_path, device="cpu", compute_type="int8", cpu_threads=2)
        decoded, _ = app.state.whisper.transcribe(audio, language=language, beam_size=1,
                                                 word_timestamps=True, vad_filter=True)
        decoded = list(decoded)
        text = " ".join(s.text.strip() for s in decoded).strip()
        words = [(w.start, w.end, w.word) for s in decoded for w in (s.words or [])]
        try:
            turns = speaker_turns(torch.from_numpy(audio).unsqueeze(0)) if words else []
        except Exception:
            logging.getLogger(__name__).exception("Pyannote recording diarization failed")
            turns = []
        segments = align_words(words, turns)
        diarizer_used = DIARIZER if any(segment["speaker"] != "UNKNOWN" for segment in segments) else "none"
        return {"text": text, "segments": segments if diarizer_used != "none" else [],
                "duration": len(audio) / RATE, "diarizer": diarizer_used,
                "sttModelUsed": STT_MODEL, "diarizerUsed": diarizer_used}
    finally:
        busy.release()
