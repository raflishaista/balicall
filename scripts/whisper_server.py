"""
Local Hugging Face Whisper Inference Server for BaliCall
Compatible with OpenAI /audio/transcriptions API format.

Usage:
  python scripts/whisper_server.py
  python scripts/whisper_server.py --model openai/whisper-large-v3 --port 8000
  python scripts/whisper_server.py --model openai/whisper-small --port 8000 (Faster on CPU)
"""

import argparse
import asyncio
import io
import os
import sys
import tempfile
import torch
from typing import Optional

try:
    import av
    import numpy as np
    from fastapi import FastAPI, File, Form, UploadFile, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse
    import uvicorn
    from transformers import AutoProcessor, AutoModelForSpeechSeq2Seq, pipeline
except ImportError as err:
    print(f"Missing required dependency: {err}")
    print("Please install requirements: pip install transformers accelerate fastapi uvicorn av soundfile")
    sys.exit(1)

# Default configuration from environment or flags
DEFAULT_MODEL = os.getenv("WHISPER_MODEL", "openai/whisper-small")
DEFAULT_PORT = int(os.getenv("WHISPER_PORT", "8000"))
DEFAULT_HOST = os.getenv("WHISPER_HOST", "0.0.0.0")

app = FastAPI(title="BaliCall Local Whisper STT Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global model state
pipe = None
loaded_model_id = None
device_name = "cpu"


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


def load_whisper_pipeline(model_id: str):
    global pipe, loaded_model_id, device_name

    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    torch_dtype = torch.float16 if torch.cuda.is_available() else torch.float32
    device_name = "cuda" if torch.cuda.is_available() else "cpu"

    print(f"[*] Loading Hugging Face Whisper model: '{model_id}' on {device_name} ({torch_dtype})...")
    print(f"[*] Note: If this is the first run, weights will be downloaded from Hugging Face.")

    processor = AutoProcessor.from_pretrained(model_id)
    model = AutoModelForSpeechSeq2Seq.from_pretrained(
        model_id,
        torch_dtype=torch_dtype,
        low_cpu_mem_usage=True,
        use_safetensors=True,
    )

    if device == "cpu":
        model = model.to("cpu")
    else:
        model = model.to(device)

    pipe = pipeline(
        "automatic-speech-recognition",
        model=model,
        tokenizer=processor.tokenizer,
        feature_extractor=processor.feature_extractor,
        max_new_tokens=128,
        chunk_length_s=30,
        batch_size=8 if device != "cpu" else 1,
        torch_dtype=torch_dtype,
        device=device,
    )
    loaded_model_id = model_id
    print(f"[OK] Whisper model '{model_id}' loaded successfully on {device_name}!")
    try:
        # Warm up pipeline so initial PyTorch allocation/compilation happens at startup
        dummy = np.zeros(8000, dtype=np.float32)
        pipe(dummy)
        print("[OK] Whisper pipeline warmed up and ready.")
    except Exception as warmup_err:
        print(f"[*] Warmup note: {warmup_err}")


@app.get("/")
@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "BaliCall Local Whisper STT",
        "model": loaded_model_id,
        "device": device_name,
        "cuda_available": torch.cuda.is_available(),
    }


@app.get("/v1/models")
def list_models():
    return {
        "object": "list",
        "data": [
            {
                "id": loaded_model_id or DEFAULT_MODEL,
                "object": "model",
                "owned_by": "openai/huggingface",
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
    if pipe is None:
        raise HTTPException(status_code=503, detail="Whisper model is still loading or not initialized.")

    audio_bytes = await file.read()
    if not audio_bytes:
        return {"text": ""}

    waveform = decode_audio_to_numpy(audio_bytes, target_sr=16000)
    if waveform.size == 0 or len(waveform) < 1600:  # < 0.1s
        return {"text": ""}

    # Language mapping for Indonesian and English
    generate_kwargs = {}
    if language:
        clean_lang = language.lower().split("-")[0].split("_")[0]
        if clean_lang == "id":
            generate_kwargs["language"] = "indonesian"
        elif clean_lang == "en":
            generate_kwargs["language"] = "english"
        else:
            generate_kwargs["language"] = clean_lang

    try:
        # Run inference in a worker thread to keep the FastAPI event loop responsive
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(None, lambda: pipe(waveform, generate_kwargs=generate_kwargs))
        transcribed_text = result.get("text", "").strip()
        print(f"[STT] Transcribed ({len(waveform)/16000:.1f}s): \"{transcribed_text}\"")
        return {"text": transcribed_text}
    except Exception as e:
        print(f"[ERROR] Inference failed: {e}")
        raise HTTPException(status_code=500, detail=f"Inference error: {e}")


def main():
    parser = argparse.ArgumentParser(description="BaliCall Local Hugging Face Whisper Server")
    parser.add_argument("--model", type=str, default=DEFAULT_MODEL, help=f"HuggingFace model ID (default: {DEFAULT_MODEL})")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Port to bind to (default: {DEFAULT_PORT})")
    parser.add_argument("--host", type=str, default=DEFAULT_HOST, help=f"Host to bind to (default: {DEFAULT_HOST})")
    args = parser.parse_args()

    # Pre-load model before starting server
    load_whisper_pipeline(args.model)

    print(f"[*] Starting Whisper API server on http://{args.host}:{args.port}")
    print(f"[*] OpenAI-compatible endpoint: http://127.0.0.1:{args.port}/v1/audio/transcriptions")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
