"""
Local Whisper Inference Server for BaliCall (CTranslate2 / faster-whisper)
Compatible with OpenAI /audio/transcriptions API format.

Highlights:
- Uses faster-whisper (CTranslate2 INT8 quantization) for up to 4x faster CPU inference.
- Built-in Silero VAD (Voice Activity Detection) eliminates hallucinations and repetition loops on silence.
- Compatible with all browsers (Chrome, Edge, Firefox, Safari).
"""

import argparse
import asyncio
import io
import os
import sys
from typing import Optional

try:
    import av
    import numpy as np
    from fastapi import FastAPI, File, Form, UploadFile, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse
    import uvicorn
    from faster_whisper import WhisperModel
except ImportError as err:
    print(f"Missing required dependency: {err}")
    print("Please install requirements: pip install faster-whisper av fastapi uvicorn")
    sys.exit(1)

# Default configuration
DEFAULT_MODEL = os.getenv("WHISPER_MODEL", "small")
DEFAULT_PORT = int(os.getenv("WHISPER_PORT", "8000"))
DEFAULT_HOST = os.getenv("WHISPER_HOST", "0.0.0.0")

app = FastAPI(title="BaliCall Local Whisper STT Server (faster-whisper)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global model state
whisper_model: Optional[WhisperModel] = None
loaded_model_id = None
device_name = "cpu"


def normalize_model_name(name: str) -> str:
    """Normalizes models like 'openai/whisper-small' -> 'small'."""
    raw = name.strip()
    if "/" in raw:
        raw = raw.split("/")[-1]
    if raw.startswith("whisper-"):
        raw = raw.replace("whisper-", "")
    return raw


def decode_audio_to_numpy(audio_bytes: bytes, target_sr: int = 16000) -> np.ndarray:
    """Decodes any audio format (WebM, Ogg Opus, WAV, MP4, MP3) to 16kHz mono float32."""
    try:
        buffer = io.BytesIO(audio_bytes)
        container = av.open(buffer)
        resampler = av.AudioResampler(format="fltp", layout="mono", rate=target_sr)

        frames = []
        for frame in container.decode(audio=0):
            resampled = resampler.resample(frame)
            if resampled:
                for r in resampled:
                    frames.append(r.to_ndarray())

        if not frames:
            return np.zeros(0, dtype=np.float32)

        waveform = np.concatenate(frames, axis=1).squeeze(0)
        return waveform
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to decode audio file: {e}")


def load_model(model_name: str):
    global whisper_model, loaded_model_id, device_name

    normalized = normalize_model_name(model_name)
    threads = min(8, os.cpu_count() or 4)

    print(f"[*] Loading faster-whisper model: '{normalized}' (device=cpu, compute_type=int8, threads={threads})...")
    whisper_model = WhisperModel(
        normalized,
        device="cpu",
        compute_type="int8",
        cpu_threads=threads,
    )
    loaded_model_id = normalized
    print(f"[OK] faster-whisper model '{normalized}' loaded successfully!")

    # Warmup with small dummy slice
    try:
        dummy = np.zeros(8000, dtype=np.float32)
        whisper_model.transcribe(dummy, vad_filter=True)
        print("[OK] faster-whisper pipeline warmed up and ready.")
    except Exception as e:
        print(f"[*] Warmup note: {e}")


@app.get("/")
@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "BaliCall Local Whisper STT (faster-whisper)",
        "model": loaded_model_id,
        "engine": "faster-whisper / ctranslate2",
        "device": device_name,
    }


@app.get("/v1/models")
def list_models():
    return {
        "object": "list",
        "data": [
            {
                "id": loaded_model_id or DEFAULT_MODEL,
                "object": "model",
                "owned_by": "systran/faster-whisper",
            }
        ],
    }


@app.post("/audio/transcriptions")
@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    model: Optional[str] = Form(None),
    language: Optional[str] = Form(None),
    response_format: Optional[str] = Form("json"),
):
    if whisper_model is None:
        raise HTTPException(status_code=503, detail="Whisper model is still loading or not initialized.")

    audio_bytes = await file.read()
    if not audio_bytes:
        return {"text": ""}

    waveform = decode_audio_to_numpy(audio_bytes, target_sr=16000)
    if waveform.size == 0 or len(waveform) < 1600:  # < 0.1s
        return {"text": ""}

    # Language mapping for Indonesian and English
    lang = None
    if language:
        clean_lang = language.lower().split("-")[0].split("_")[0]
        if clean_lang in ("id", "indonesian"):
            lang = "id"
        elif clean_lang in ("en", "english"):
            lang = "en"
        else:
            lang = clean_lang

    try:
        # Offload CTranslate2 inference to a worker thread so the FastAPI event loop stays responsive
        loop = asyncio.get_running_loop()

        def _infer():
            # vad_filter=True uses Silero VAD to eliminate silence, noise, and repetition loops
            segments, info = whisper_model.transcribe(
                waveform,
                language=lang,
                vad_filter=True,
                vad_parameters=dict(min_silence_duration_ms=400),
                condition_on_previous_text=False,  # Prevents repeating previous text loops
                beam_size=1,  # Greedy search for fastest CPU response
                best_of=1,
            )
            return " ".join(seg.text.strip() for seg in segments).strip()

        transcribed_text = await loop.run_in_executor(None, _infer)
        if transcribed_text:
            print(f"[STT] Transcribed ({len(waveform)/16000:.1f}s): \"{transcribed_text}\"")
        return {"text": transcribed_text}
    except Exception as e:
        print(f"[ERROR] Inference failed: {e}")
        raise HTTPException(status_code=500, detail=f"Inference error: {e}")


def main():
    parser = argparse.ArgumentParser(description="BaliCall Local faster-whisper Server")
    parser.add_argument("--model", type=str, default=DEFAULT_MODEL, help=f"Model size/path (default: {DEFAULT_MODEL})")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Port to bind to (default: {DEFAULT_PORT})")
    parser.add_argument("--host", type=str, default=DEFAULT_HOST, help=f"Host to bind to (default: {DEFAULT_HOST})")
    args = parser.parse_args()

    load_model(args.model)

    print(f"[*] Starting faster-whisper API server on http://{args.host}:{args.port}")
    print(f"[*] OpenAI-compatible endpoint: http://127.0.0.1:{args.port}/v1/audio/transcriptions")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
