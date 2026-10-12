"""
Local Whisper Inference Server for BaliCall (CTranslate2 / faster-whisper)
Compatible with OpenAI /audio/transcriptions API format.

Highlights:
- Uses faster-whisper (CTranslate2 INT8 quantization) for up to 4x faster CPU inference.
- Built-in Silero VAD (Voice Activity Detection) eliminates hallucinations and repetition loops on silence.
- Compatible with all browsers (Chrome, Edge, Firefox, Safari).
- Supports NVIDIA Nemotron-3 Diarization for multi-speaker recognition and alignment.
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

# Diarization dependencies (optional/lazy load)
try:
    import torch
    from transformers import AutoProcessor, AutoModelForAudioFrameClassification
    DIARIZATION_CAPABLE = True
except ImportError:
    DIARIZATION_CAPABLE = False

# Default configuration
DEFAULT_MODEL = os.getenv("WHISPER_MODEL", "small")
DEFAULT_PORT = int(os.getenv("WHISPER_PORT", "8000"))
DEFAULT_HOST = os.getenv("WHISPER_HOST", "0.0.0.0")

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DIAR_DIR = os.getenv(
    "DIARIZATION_MODEL_DIR",
    os.path.join(ROOT_DIR, "models", "nemotron3-diarization")
)

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

diar_processor = None
diar_model = None
loaded_diar_model_id = None


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


def align_words(words, turns, default_speaker="Pembicara 1"):
    """Assign word timestamps to the speaker turn with greatest temporal overlap."""
    segments = []
    for word in words:
        start, end, text = word
        overlaps = [
            (max(0.0, min(end, stop) - max(start, begin)), speaker)
            for begin, stop, speaker in turns
        ]
        overlap, speaker = max(overlaps, default=(0.0, default_speaker))
        if overlap <= 0.0:
            speaker = segments[-1]["speaker"] if segments else default_speaker

        if segments and segments[-1]["speaker"] == speaker:
            segments[-1]["text"] += " " + text
            segments[-1]["end"] = max(segments[-1]["end"], end)
        else:
            segments.append(dict(start=start, end=end, speaker=speaker, text=text))

    for segment in segments:
        segment["text"] = segment["text"].strip()
        segment["start"] = round(float(segment["start"]), 2)
        segment["end"] = round(float(segment["end"]), 2)

    return [s for s in segments if s["text"]]


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


def load_diarization_model(model_dir: str):
    global diar_processor, diar_model, loaded_diar_model_id
    if not DIARIZATION_CAPABLE:
        print("[*] PyTorch / transformers not available; Nemotron-3 diarization disabled.")
        return

    if not os.path.isdir(model_dir):
        print(f"[*] Nemotron-3 Diarization model directory not found at '{model_dir}'; diarization disabled.")
        return

    try:
        print(f"[*] Loading Nemotron-3 Diarization model from '{model_dir}'...")
        diar_processor = AutoProcessor.from_pretrained(model_dir)
        diar_model = AutoModelForAudioFrameClassification.from_pretrained(model_dir)
        diar_model.eval()
        loaded_diar_model_id = "nvidia/Nemotron-3-Diarization"
        print("[OK] Nemotron-3 Diarization model loaded successfully!")

        # Warmup with small dummy slice
        dummy = np.zeros(16000, dtype=np.float32)
        inputs = diar_processor(dummy, sampling_rate=16000, return_tensors="pt")
        with torch.no_grad():
            diar_model(**inputs)
        print("[OK] Nemotron-3 Diarization pipeline warmed up and ready.")
    except Exception as e:
        print(f"[!] Warning: Failed to load Nemotron-3 Diarization model: {e}")
        diar_processor = None
        diar_model = None
        loaded_diar_model_id = None


def run_diarization(waveform: np.ndarray, sr: int = 16000) -> list:
    """Runs Nemotron-3 Diarization and returns turns [(start, end, speaker_label), ...]."""
    if diar_model is None or diar_processor is None:
        return []

    try:
        inputs = diar_processor(waveform, sampling_rate=sr, return_tensors="pt")
        with torch.no_grad():
            outputs = diar_model(**inputs)

        speaker_dicts = diar_processor.extract_speaker_dict(
            outputs.logits, inputs.attention_mask, threshold=0.25
        )
        raw_turns = speaker_dicts[0] if speaker_dicts else []
        turns = [
            (float(t["Start"]), float(t["End"]), f"Pembicara {int(t['Speaker']) + 1}")
            for t in raw_turns
            if float(t["End"]) >= float(t["Start"])
        ]
        return turns
    except Exception as e:
        print(f"[!] Diarization error: {e}")
        return []


@app.get("/")
@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "BaliCall Local Whisper STT (faster-whisper)",
        "model": loaded_model_id,
        "diarization": diar_model is not None,
        "diarization_model": loaded_diar_model_id,
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
    diarize: Optional[str] = Form(None),
):
    if whisper_model is None:
        raise HTTPException(status_code=503, detail="Whisper model is still loading or not initialized.")

    audio_bytes = await file.read()
    if not audio_bytes:
        return {"text": "", "segments": []} if diarize else {"text": ""}

    waveform = decode_audio_to_numpy(audio_bytes, target_sr=16000)
    if waveform.size == 0 or len(waveform) < 1600:  # < 0.1s
        return {"text": "", "segments": []} if diarize else {"text": ""}

    # Parse diarize flag
    do_diarize = False
    if diarize is not None:
        do_diarize = str(diarize).strip().lower() in ("true", "1", "yes")

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
        # Offload inference to worker thread so the FastAPI event loop stays responsive
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
                word_timestamps=do_diarize,
            )
            segments = list(segments)
            transcribed_text = " ".join(seg.text.strip() for seg in segments).strip()

            if not transcribed_text:
                return {"text": "", "segments": []} if do_diarize else {"text": ""}

            if not do_diarize:
                return {"text": transcribed_text}

            # Diarization workflow
            turns = run_diarization(waveform, sr=16000)

            words = []
            for seg in segments:
                if seg.words:
                    for w in seg.words:
                        w_text = w.word.strip()
                        if w_text:
                            words.append((w.start, w.end, w_text))
                elif seg.text.strip():
                    words.append((seg.start, seg.end, seg.text.strip()))

            aligned_segments = align_words(words, turns, default_speaker="Pembicara 1")

            # Fallback if alignment produced no non-empty segments
            if not aligned_segments:
                aligned_segments = [
                    {
                        "speaker": "Pembicara 1",
                        "start": round(float(seg.start), 2),
                        "end": round(float(seg.end), 2),
                        "text": seg.text.strip(),
                    }
                    for seg in segments if seg.text.strip()
                ]

            if not aligned_segments and transcribed_text:
                duration = round(len(waveform) / 16000.0, 2)
                aligned_segments = [{
                    "speaker": "Pembicara 1",
                    "start": 0.0,
                    "end": max(0.1, duration),
                    "text": transcribed_text,
                }]

            return {"text": transcribed_text, "segments": aligned_segments}

        result = await loop.run_in_executor(None, _infer)
        if result.get("text"):
            seg_info = f" with {len(result.get('segments', []))} speaker segments" if do_diarize else ""
            print(f"[STT] Transcribed ({len(waveform)/16000:.1f}s){seg_info}: \"{result['text']}\"")
        return result
    except Exception as e:
        print(f"[ERROR] Inference failed: {e}")
        raise HTTPException(status_code=500, detail=f"Inference error: {e}")


def main():
    parser = argparse.ArgumentParser(description="BaliCall Local faster-whisper Server")
    parser.add_argument("--model", type=str, default=DEFAULT_MODEL, help=f"Model size/path (default: {DEFAULT_MODEL})")
    parser.add_argument("--diarization-model", type=str, default=DEFAULT_DIAR_DIR, help=f"Nemotron-3 Diarization model path (default: {DEFAULT_DIAR_DIR})")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Port to bind to (default: {DEFAULT_PORT})")
    parser.add_argument("--host", type=str, default=DEFAULT_HOST, help=f"Host to bind to (default: {DEFAULT_HOST})")
    args = parser.parse_args()

    load_model(args.model)
    if args.diarization_model:
        load_diarization_model(args.diarization_model)

    print(f"[*] Starting faster-whisper API server on http://{args.host}:{args.port}")
    print(f"[*] OpenAI-compatible endpoint: http://127.0.0.1:{args.port}/v1/audio/transcriptions")
    if loaded_diar_model_id:
        print(f"[*] Speaker Diarization active: {loaded_diar_model_id}")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
