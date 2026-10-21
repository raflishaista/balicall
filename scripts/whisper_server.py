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
import re
import sys
import secrets
import tempfile
import threading
import time
import uuid
from threading import Lock
from typing import Optional, List

try:
    import av
    import numpy as np
    from fastapi import FastAPI, File, Form, Header, UploadFile, HTTPException
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
DEFAULT_PORT = int(os.getenv("WHISPER_PORT", "8001"))
DEFAULT_HOST = os.getenv("WHISPER_HOST", "0.0.0.0")
DEFAULT_BEAM_SIZE = int(os.getenv("WHISPER_BEAM_SIZE", "2"))
DEFAULT_INITIAL_PROMPT = os.getenv(
    "WHISPER_INITIAL_PROMPT",
    "Percakapan rapat kerja teknis Bali Tower / NOC mengenai sistem, jaringan, permohonan admin, speaking permission, logic conditional, nested rules, mikrofon, streaming WebRTC, notulen rapat, dan kehadiran."
)
initial_prompt_text = DEFAULT_INITIAL_PROMPT
beam_size = DEFAULT_BEAM_SIZE

# Domain phonetic corrections for common ASR mishearings in Indonesian-English tech meetings
DOMAIN_CORRECTIONS = [
    (re.compile(r'\bperlombongan\b', re.IGNORECASE), 'permohonan'),
    (re.compile(r'\bnestet(nya)?\b', re.IGNORECASE), lambda m: 'nestednya' if m.group(1) else 'nested'),
    (re.compile(r'\bkondisionil\b', re.IGNORECASE), 'kondisional'),
    (re.compile(r'\bspiking\b', re.IGNORECASE), 'speaking'),
    (re.compile(r'\b(bali\s*tower|balitower)\b', re.IGNORECASE), 'Bali Tower'),
    (re.compile(r'\blive\s*kit\b', re.IGNORECASE), 'LiveKit'),
    (re.compile(r'\benok\b', re.IGNORECASE), 'NOC'),
    (re.compile(r'\bwebrtc\b', re.IGNORECASE), 'WebRTC'),
]

def apply_domain_corrections(text: str) -> str:
    if not text:
        return text
    cleaned = text
    for pattern, replacement in DOMAIN_CORRECTIONS:
        cleaned = pattern.sub(replacement, cleaned)
    return cleaned

SPEECH_API_KEY = os.getenv("SPEECH_API_KEY", "")
inference_lock = Lock()

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DIAR_DIR = os.getenv(
    "DIARIZATION_MODEL_DIR",
    os.path.join(ROOT_DIR, "models", "nemotron3-diarization")
)
DEFAULT_DIAR_THRESHOLD = float(os.getenv("DIARIZATION_THRESHOLD", "0.18"))

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
diar_threshold = DEFAULT_DIAR_THRESHOLD


def normalize_model_name(name: str) -> str:
    """Normalizes models like 'openai/whisper-small' -> 'small'."""
    raw = name.strip()
    if "/" in raw:
        raw = raw.split("/")[-1]
    if raw.startswith("whisper-"):
        raw = raw.replace("whisper-", "")
    return raw


def decode_audio_to_numpy(audio_source, target_sr: int = 16000) -> np.ndarray:
    """Decodes any audio format (WebM, Ogg Opus, WAV, MP4, MP3) to 16kHz mono float32."""
    try:
        if isinstance(audio_source, (bytes, bytearray)):
            container = av.open(io.BytesIO(audio_source))
        else:
            container = av.open(audio_source)
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


def align_words(words, turns, default_speaker="UNKNOWN", carry_previous_speaker=False):
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
            speaker = segments[-1]["speaker"] if carry_previous_speaker and segments else default_speaker

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
        dummy = np.zeros(8001, dtype=np.float32)
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


def run_diarization(waveform: np.ndarray, sr: int = 16000, threshold: Optional[float] = None) -> list:
    """Runs Nemotron-3 Diarization and returns turns [(start, end, speaker_label), ...]."""
    if diar_model is None or diar_processor is None:
        raise HTTPException(503, "Diarization model is not available.")

    thresh = threshold if threshold is not None else diar_threshold

    try:
        inputs = diar_processor(waveform, sampling_rate=sr, return_tensors="pt")
        with torch.no_grad():
            outputs = diar_model(**inputs)

        speaker_dicts = diar_processor.extract_speaker_dict(
            outputs.logits, inputs.attention_mask, threshold=thresh
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
        raise HTTPException(502, "Diarization inference failed.") from e


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


def require_diarization():
    if diar_model is None or diar_processor is None:
        raise HTTPException(503, "Diarization model is not available.")



def authorize(authorization):
    if SPEECH_API_KEY and not secrets.compare_digest(authorization, f"Bearer {SPEECH_API_KEY}"):
        raise HTTPException(401, "Invalid speech service credentials.")



async def read_waveform(file):
    payload = await file.read(5 * 1024 * 1024 + 1)
    if not payload:
        raise HTTPException(400, "Audio is empty.")
    if len(payload) > 5 * 1024 * 1024:
        raise HTTPException(413, "Maximum upload size is 5 MB.")
    waveform = await asyncio.to_thread(decode_audio_to_numpy, payload, 16000)
    if not waveform.size:
        raise HTTPException(400, "Audio contains no samples.")
    if len(waveform) > 16000 * 60:
        raise HTTPException(413, "Maximum audio duration is 60 seconds.")
    return waveform



def transcribe_waveform(waveform, language, diarize=False, prompt=None):
    if whisper_model is None:
        raise HTTPException(503, "Whisper model is not available.")
    effective_prompt = prompt.strip() if prompt and prompt.strip() else initial_prompt_text
    decoded, _ = whisper_model.transcribe(
        waveform, language=language, vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=400),
        condition_on_previous_text=False,
        beam_size=beam_size,
        best_of=beam_size,
        initial_prompt=effective_prompt,
        word_timestamps=diarize,
    )
    return list(decoded)



def infer_transcription(waveform, language, diarize, threshold=None, prompt=None):
    # One bounded inference at a time; both processes read the same audio.
    with inference_lock:
        if diarize:
            require_diarization()
        decoded = transcribe_waveform(waveform, language, diarize, prompt=prompt)
        text = " ".join(segment.text.strip() for segment in decoded).strip()
        text = apply_domain_corrections(text)
        if not diarize:
            return {"text": text}
        if not text:
            return {"text": "", "segments": []}
        turns = run_diarization(waveform, sr=16000, threshold=threshold)
        words = []
        for segment in decoded:
            if segment.words:
                words.extend((word.start, word.end, apply_domain_corrections(word.word.strip())) for word in segment.words if word.word.strip())
            elif segment.text.strip():
                words.append((segment.start, segment.end, apply_domain_corrections(segment.text.strip())))
        aligned = align_words(words, turns)
        for seg in aligned:
            seg["text"] = apply_domain_corrections(seg["text"])
        return {"text": text, "segments": aligned}



def infer_diarization(waveform):
    with inference_lock:
        require_diarization()
        turns = run_diarization(waveform, sr=16000)
        return {"segments": [{"speaker": speaker, "start": start, "end": end} for start, end, speaker in turns]}



@app.post("/audio/diarizations")
@app.post("/v1/audio/diarizations")
async def diarize_audio(file: UploadFile = File(...), authorization: str = Header("")):
    authorize(authorization)
    require_diarization()
    waveform = await read_waveform(file)
    return await asyncio.to_thread(infer_diarization, waveform)



@app.post("/audio/transcriptions")
@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...), model: Optional[str] = Form(None),
    language: Optional[str] = Form(None), response_format: Optional[str] = Form("json"),
    prompt: Optional[str] = Form(None),
    diarize: Optional[str] = Form(None), authorization: str = Header(""),
    diarization_threshold: Optional[float] = Form(None),
):
    authorize(authorization)
    if whisper_model is None:
        raise HTTPException(503, "Whisper model is not available.")
    do_diarize = str(diarize).strip().lower() in ("true", "1", "yes") if diarize is not None else False
    if do_diarize:
        require_diarization()
    lang = language.lower().split("-")[0].split("_")[0] if language else None
    lang = {"indonesian": "id", "english": "en"}.get(lang, lang)
    waveform = await read_waveform(file)
    try:
        return await asyncio.to_thread(infer_transcription, waveform, lang, do_diarize, diarization_threshold, prompt)
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(500, "Transcription inference failed.") from error


@app.post("/audio/batch-diarize")
@app.post("/v1/audio/batch-diarize")
async def batch_diarize(
    file: Optional[UploadFile] = File(None),
    files: Optional[List[UploadFile]] = File(None),
    language: Optional[str] = Form(None),
    prompt: Optional[str] = Form(None),
    model: Optional[str] = Form(None),
    threshold: Optional[float] = Form(None),
):
    if whisper_model is None:
        raise HTTPException(status_code=503, detail="Whisper model is still loading or not initialized.")

    input_files = []
    if file is not None:
        input_files.append(file)
    if files:
        input_files.extend(files)

    if not input_files:
        raise HTTPException(status_code=400, detail="No audio file or chunks provided for batch diarization.")

    waveforms = []
    for f in input_files:
        try:
            raw = await f.read()
            if raw and len(raw) > 100:
                wf = decode_audio_to_numpy(raw, target_sr=16000)
                if wf.size > 0:
                    waveforms.append(wf)
        except Exception as e:
            print(f"[!] Warning: Failed decoding chunk in batch: {e}")

    if not waveforms:
        return {"text": "", "segments": [], "speaker_count": 0, "speakers": [], "duration": 0.0}

    full_waveform = np.concatenate(waveforms) if len(waveforms) > 1 else waveforms[0]
    duration_sec = round(len(full_waveform) / 16000.0, 2)
    print(f"[*] Batch Diarization: Processing {len(waveforms)} chunk(s), total duration: {duration_sec}s ({duration_sec/60:.2f} mins)...")

    # Language mapping
    lang = None
    if language:
        clean_lang = language.lower().split("-")[0].split("_")[0]
        if clean_lang in ("id", "indonesian"):
            lang = "id"
        elif clean_lang in ("en", "english"):
            lang = "en"
        else:
            lang = clean_lang

    loop = asyncio.get_running_loop()

    def _infer_batch():
        effective_prompt = prompt.strip() if prompt and prompt.strip() else initial_prompt_text
        # 1. Transcribe complete continuous audio
        segments, info = whisper_model.transcribe(
            full_waveform,
            language=lang,
            initial_prompt=effective_prompt,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=400),
            beam_size=beam_size,
            best_of=beam_size,
            word_timestamps=True,
        )
        segments = list(segments)
        full_text = " ".join(seg.text.strip() for seg in segments).strip()
        full_text = apply_domain_corrections(full_text)

        # 2. Run Nemotron-3 Diarization over the full continuous waveform
        turns = run_diarization(full_waveform, sr=16000, threshold=threshold)

        # 3. Align words to global speaker turns
        words = []
        for seg in segments:
            if seg.words:
                for w in seg.words:
                    w_text = apply_domain_corrections(w.word.strip())
                    if w_text:
                        words.append((w.start, w.end, w_text))
            elif seg.text.strip():
                words.append((seg.start, seg.end, apply_domain_corrections(seg.text.strip())))

        aligned = align_words(words, turns, default_speaker="Pembicara 1", carry_previous_speaker=True)
        for seg in aligned:
            seg["text"] = apply_domain_corrections(seg["text"])

        if not aligned and full_text:
            aligned = [{
                "speaker": "Pembicara 1",
                "start": 0.0,
                "end": duration_sec,
                "text": full_text,
            }]

        speaker_set = sorted(list(set(s["speaker"] for s in aligned)))
        print(f"[OK] Batch Diarization complete: {len(aligned)} dialogue turns, {len(speaker_set)} speaker(s) ({', '.join(speaker_set)}) across {duration_sec:.1f}s.")

        return {
            "text": full_text,
            "segments": aligned,
            "speaker_count": len(speaker_set),
            "speakers": speaker_set,
            "duration": duration_sec,
        }

    try:
        result = await loop.run_in_executor(None, _infer_batch)
        return result
    except Exception as e:
        print(f"[ERROR] Batch diarization failed: {e}")
        raise HTTPException(status_code=500, detail=f"Batch diarization error: {e}")


LONG_JOBS = {}
LONG_JOB_TTL_SECONDS = int(os.getenv("LONG_JOB_TTL_SECONDS", "7200"))


def purge_jobs():
    now = time.time()
    for job_id in [k for k, j in LONG_JOBS.items()
                   if j.get("finished_at") and now - j["finished_at"] > LONG_JOB_TTL_SECONDS]:
        LONG_JOBS.pop(job_id, None)


def run_transcription_job(job_id: str, file_path: str, language: Optional[str], do_diarize: bool, threshold: Optional[float]):
    job = LONG_JOBS.get(job_id)
    if not job:
        return
    job["status"] = "running"
    try:
        with inference_lock:
            waveform = decode_audio_to_numpy(file_path, target_sr=16000)
            if not waveform.size:
                raise ValueError("Audio file is empty or could not be decoded.")

            duration_sec = round(len(waveform) / 16000.0, 2)
            print(f"[*] Job {job_id}: Transcribing audio duration {duration_sec}s ({duration_sec/60:.2f} mins)...")

            segments, info = whisper_model.transcribe(
                waveform,
                language=language,
                vad_filter=True,
                vad_parameters=dict(min_silence_duration_ms=400),
                beam_size=1,
                word_timestamps=True,
            )
            segments = list(segments)
            full_text = " ".join(seg.text.strip() for seg in segments).strip()

            aligned = []
            if do_diarize and diar_model is not None:
                print(f"[*] Job {job_id}: Running Nemotron-3 diarization...")
                turns = run_diarization(waveform, sr=16000, threshold=threshold)
                words = []
                for seg in segments:
                    if seg.words:
                        for w in seg.words:
                            w_text = w.word.strip()
                            if w_text:
                                words.append((w.start, w.end, w_text))
                    elif seg.text.strip():
                        words.append((seg.start, seg.end, seg.text.strip()))
                aligned = align_words(words, turns, default_speaker="Pembicara 1", carry_previous_speaker=True)
            elif segments:
                aligned = [
                    {
                        "speaker": "Pembicara 1",
                        "start": round(float(seg.start), 2),
                        "end": round(float(seg.end), 2),
                        "text": seg.text.strip(),
                    }
                    for seg in segments if seg.text.strip()
                ]

            if not aligned and full_text:
                aligned = [{
                    "speaker": "Pembicara 1",
                    "start": 0.0,
                    "end": duration_sec,
                    "text": full_text,
                }]

            job["result"] = {
                "text": full_text,
                "segments": aligned,
                "duration": duration_sec,
            }
            job["status"] = "done"
            print(f"[OK] Job {job_id} complete: {len(aligned)} dialogue turns across {duration_sec:.1f}s.")
    except Exception as e:
        print(f"[ERROR] Job {job_id} failed: {e}")
        job["status"] = "failed"
        job["error"] = str(e)
    finally:
        job["finished_at"] = time.time()
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
        except OSError:
            pass


@app.post("/audio/transcriptions/jobs", status_code=202)
@app.post("/v1/audio/transcriptions/jobs", status_code=202)
async def submit_transcription_job(
    file: UploadFile = File(...),
    model: Optional[str] = Form(None),
    language: Optional[str] = Form("id"),
    diarize: Optional[str] = Form(None),
    diarizer: Optional[str] = Form(None),
    diarization_threshold: Optional[float] = Form(None),
    authorization: str = Header(""),
):
    authorize(authorization)
    if whisper_model is None:
        raise HTTPException(503, "Whisper model is not available.")

    do_diarize = str(diarize).strip().lower() in ("true", "1", "yes") if diarize is not None else False
    if do_diarize and diar_model is None:
        print("[!] Note: Diarization requested but diar_model not available, continuing with standard transcription")
        do_diarize = False

    lang = language.lower().split("-")[0].split("_")[0] if language else None
    lang = {"indonesian": "id", "english": "en"}.get(lang, lang)

    purge_jobs()

    fd, path = tempfile.mkstemp(suffix=".upload")
    try:
        with os.fdopen(fd, "wb") as out:
            while chunk := await file.read(1024 * 1024):
                out.write(chunk)
    except Exception as e:
        try:
            if os.path.exists(path):
                os.remove(path)
        except OSError:
            pass
        raise HTTPException(500, f"Failed to save uploaded file: {e}")

    job_id = uuid.uuid4().hex
    LONG_JOBS[job_id] = {
        "status": "queued",
        "error": None,
        "result": None,
        "finished_at": None,
    }

    threading.Thread(
        target=run_transcription_job,
        args=(job_id, path, lang, do_diarize, diarization_threshold),
        daemon=True,
    ).start()

    return {"job_id": job_id, "status": "queued"}


@app.get("/audio/transcriptions/jobs/{job_id}")
@app.get("/v1/audio/transcriptions/jobs/{job_id}")
def get_transcription_job(job_id: str, authorization: str = Header("")):
    authorize(authorization)
    job = LONG_JOBS.get(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    return {
        "status": job["status"],
        "error": job["error"],
        "result": job["result"] if job["status"] == "done" else None,
    }


def main():
    parser = argparse.ArgumentParser(description="BaliCall Local faster-whisper Server")
    parser.add_argument("--model", type=str, default=DEFAULT_MODEL, help=f"Model size/path (default: {DEFAULT_MODEL})")
    parser.add_argument("--initial-prompt", type=str, default=DEFAULT_INITIAL_PROMPT, help="Domain vocabulary prompt for biasing transcription")
    parser.add_argument("--beam-size", type=int, default=DEFAULT_BEAM_SIZE, help=f"Beam size for decoding (default: {DEFAULT_BEAM_SIZE})")
    parser.add_argument("--diarization-model", type=str, default=DEFAULT_DIAR_DIR, help=f"Nemotron-3 Diarization model path (default: {DEFAULT_DIAR_DIR})")
    parser.add_argument("--diarization-threshold", type=float, default=DEFAULT_DIAR_THRESHOLD, help=f"Nemotron-3 clustering threshold (default: {DEFAULT_DIAR_THRESHOLD})")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Port to bind to (default: {DEFAULT_PORT})")
    parser.add_argument("--host", type=str, default=DEFAULT_HOST, help=f"Host to bind to (default: {DEFAULT_HOST})")
    parser.add_argument("--diarization-only", action="store_true", help="Serve diarization without loading Whisper")
    args = parser.parse_args()

    global diar_threshold, initial_prompt_text, beam_size
    diar_threshold = args.diarization_threshold
    initial_prompt_text = args.initial_prompt
    beam_size = max(1, args.beam_size)

    if not args.diarization_only:
        load_model(args.model)
    if args.diarization_model:
        load_diarization_model(args.diarization_model)

    print(f"[*] Starting faster-whisper API server on http://{args.host}:{args.port}")
    print(f"[*] OpenAI-compatible endpoint: http://127.0.0.1:{args.port}/v1/audio/transcriptions")
    print(f"[*] Beam size: {beam_size} | Prompt biasing: active")
    if loaded_diar_model_id:
        print(f"[*] Speaker Diarization active: {loaded_diar_model_id} (threshold: {diar_threshold})")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
