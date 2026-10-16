"""
Test Audio Meeting Script for BaliCall.
Transcribes test audio files from Downloads/ssh-audios, runs speaker diarization,
and sends the formatted transcript to internal Qwen to generate the Action Items Table & Summary.

Usage:
  python scripts/test_audio_meeting.py indonesian2.wav --duration 120
  python scripts/test_audio_meeting.py english2.wav --duration 180 --lang en
"""

import argparse
import io
import json
import os
import sys
import time
import urllib.request
import av
import numpy as np
from faster_whisper import WhisperModel

# Diarization imports (optional)
try:
    import torch
    from transformers import AutoProcessor, AutoModelForAudioFrameClassification
    DIARIZATION_AVAILABLE = True
except ImportError:
    DIARIZATION_AVAILABLE = False

DEFAULT_AUDIO_DIR = r"C:\Users\rafliaditya.intern\Downloads\ssh-audios"
DEFAULT_LLM_URL = os.getenv("LLM_BASE_URL", "http://10.7.1.21/v1")
DEFAULT_LLM_KEY = os.getenv("LLM_KEY", "sk-c1PP5Ngd9Dh7q2ZjiwZAIg")
DEFAULT_MODEL = os.getenv("LLM_MODEL", "qwen-35b")


def decode_audio(file_path: str, max_duration_sec: int = 0, target_sr: int = 16000) -> np.ndarray:
    """Decodes audio file up to max_duration_sec into 16kHz mono float32 numpy array."""
    print(f"[*] Decoding audio from: {file_path}")
    container = av.open(file_path)
    resampler = av.AudioResampler(format="fltp", layout="mono", rate=target_sr)

    frames = []
    total_samples = 0
    max_samples = max_duration_sec * target_sr if max_duration_sec > 0 else 0

    for frame in container.decode(audio=0):
        resampled = resampler.resample(frame)
        if resampled:
            for r in resampled:
                arr = r.to_ndarray()
                frames.append(arr)
                total_samples += arr.shape[1]
                if max_samples and total_samples >= max_samples:
                    break
        if max_samples and total_samples >= max_samples:
            break

    if not frames:
        return np.zeros(0, dtype=np.float32)

    waveform = np.concatenate(frames, axis=1).squeeze(0)
    if max_samples and len(waveform) > max_samples:
        waveform = waveform[:max_samples]

    duration = len(waveform) / target_sr
    print(f"[OK] Decoded {duration:.1f} seconds ({duration/60:.2f} mins) of audio.")
    return waveform


def align_words(words, turns, default_speaker="Pembicara 1"):
    """Assigns words to diarized speaker turns based on temporal overlap."""
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
            segments.append({"start": start, "end": end, "speaker": speaker, "text": text})

    for s in segments:
        s["text"] = s["text"].strip()
        s["start"] = round(float(s["start"]), 2)
        s["end"] = round(float(s["end"]), 2)

    return [s for s in segments if s["text"]]


def run_diarization(waveform: np.ndarray, model_dir: str) -> list:
    """Runs Nemotron-3 Diarization if available."""
    if not DIARIZATION_AVAILABLE or not os.path.isdir(model_dir):
        print(f"[*] Nemotron-3 diarization model not found at {model_dir}; skipping diarization.")
        return []

    print("[*] Running Nemotron-3 speaker diarization...")
    try:
        processor = AutoProcessor.from_pretrained(model_dir)
        model = AutoModelForAudioFrameClassification.from_pretrained(model_dir)
        model.eval()

        inputs = processor(waveform, sampling_rate=16000, return_tensors="pt")
        with torch.no_grad():
            outputs = model(**inputs)

        speaker_dicts = processor.extract_speaker_dict(
            outputs.logits, inputs.attention_mask, threshold=0.25
        )
        raw_turns = speaker_dicts[0] if speaker_dicts else []
        turns = [
            (float(t["Start"]), float(t["End"]), f"Pembicara {int(t['Speaker']) + 1}")
            for t in raw_turns
            if float(t["End"]) >= float(t["Start"])
        ]
        print(f"[OK] Diarization detected {len(set(t[2] for t in turns))} speaker(s).")
        return turns
    except Exception as e:
        print(f"[!] Diarization warning: {e}")
        return []


def request_summary(dialogue: str, meeting_name: str, language: str) -> dict:
    """Sends formatted dialogue to Qwen to generate summary and action items table."""
    prompt = f"""Summarize this meeting in the language spoken ({language}). Do not invent decisions, deadlines, conditions or assignments. Use empty arrays if none were stated.
Guidelines for actionItems:
- Extract all actionable tasks agreed upon in the meeting.
- 'task': Clear, specific description of the task.
- 'assignee': PIC / Penanggung Jawab. Attribute to the person assigned, commanded, or committed to do the task. If a speaker commands or delegates to a specific person (e.g. "Siti, tolong periksa log" or "Rian kamu handle vendor"), the assignee must be that named person (e.g. "Siti" or "Rian"), NOT the speaker who gave the command. If multiple diarized speakers appear under one participant without names, distinguish them as "Pembicara X (person_0)".
- 'deadline': Tenggat waktu / batas waktu / syarat pengerjaan (e.g. "Hari ini sebelum 15:00; Syarat: tanpa memutus koneksi"). If none, use empty string "".
- 'priority': "High", "Medium", or "Low".

Return only JSON with this exact shape:
{{"title":"string","executiveSummary":"string","keyDiscussionPoints":["string"],"decisions":["string"],"actionItems":[{{"task":"string","assignee":"string","priority":"High|Medium|Low","deadline":"string"}}],"attendanceSummary":["string"]}}
Meeting: {meeting_name}
Connected attendees: Tim Sentra Meeting
Dialogue:
{dialogue}"""

    url = f"{DEFAULT_LLM_URL.rstrip('/')}/chat/completions"
    payload = {
        "model": DEFAULT_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "chat_template_kwargs": {"enable_thinking": False},
        "temperature": 0.2,
        "max_tokens": 4096,
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {DEFAULT_LLM_KEY}",
        },
        method="POST",
    )

    print(f"[*] Requesting summary from internal LLM gateway ({DEFAULT_MODEL})...")
    start = time.perf_counter()
    with urllib.request.urlopen(req, timeout=120) as response:
        res_data = json.loads(response.read().decode("utf-8"))
    elapsed = time.perf_counter() - start
    print(f"[OK] Summary received in {elapsed:.2f}s.")

    content = res_data["choices"][0]["message"]["content"]
    # Parse JSON
    try:
        return json.loads(content)
    except Exception:
        import re
        match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", content)
        if match:
            return json.loads(match.group(1))
        raise ValueError(f"Failed to parse LLM JSON: {content}")


def main():
    parser = argparse.ArgumentParser(description="Test audio file meeting summarization & task table")
    parser.add_argument("filename", help="Audio filename in ssh-audios (e.g. indonesian2.wav) or full path")
    parser.add_argument("--duration", type=int, default=120, help="Max duration in seconds to process (default 120s, 0 for full audio)")
    parser.add_argument("--lang", default="id", choices=["id", "en"], help="Spoken language ('id' or 'en')")
    parser.add_argument("--whisper-model", default="base", help="Whisper model name ('base', 'small', etc.)")
    parser.add_argument("--diarize", action="store_true", help="Enable Nemotron-3 speaker diarization")

    args = parser.parse_args()

    # Resolve audio path
    if os.path.isabs(args.filename) and os.path.exists(args.filename):
        audio_path = args.filename
    else:
        audio_path = os.path.join(DEFAULT_AUDIO_DIR, args.filename)

    if not os.path.exists(audio_path):
        print(f"[!] Error: File not found at {audio_path}")
        sys.exit(1)

    print("=" * 60)
    print(f"BALICALL AUDIO MEETING & ACTION ITEMS TEST")
    print(f"Audio file : {audio_path}")
    print(f"Duration   : {'Full' if args.duration == 0 else f'First {args.duration}s'}")
    print(f"Language   : {args.lang}")
    print("=" * 60)

    # 1. Decode audio
    waveform = decode_audio(audio_path, max_duration_sec=args.duration)
    if len(waveform) == 0:
        print("[!] Error: No audio decoded.")
        sys.exit(1)

    # 2. Whisper STT
    print(f"[*] Loading Whisper model ('{args.whisper_model}', CPU, INT8)...")
    whisper = WhisperModel(args.whisper_model, device="cpu", compute_type="int8", cpu_threads=4)
    print("[*] Transcribing audio with word timestamps...")
    t_start = time.perf_counter()
    segments, info = whisper.transcribe(
        waveform, language=args.lang, vad_filter=True, word_timestamps=True, beam_size=1
    )
    segments = list(segments)
    stt_time = time.perf_counter() - t_start
    print(f"[OK] Transcription completed in {stt_time:.2f}s.")

    # 3. Diarization (Optional)
    diar_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "nemotron3-diarization")
    dialogue_lines = []

    if args.diarize and DIARIZATION_AVAILABLE and os.path.isdir(diar_dir):
        turns = run_diarization(waveform, diar_dir)
        words = [(w.start, w.end, w.word) for s in segments for w in (s.words or [])]
        diar_segments = align_words(words, turns)
        for s in diar_segments:
            m = int(s["start"] // 60)
            sec = int(s["start"] % 60)
            dialogue_lines.append(f"--- [{m:02d}:{sec:02d}] [{s['speaker']}]: {s['text']}")
    else:
        for s in segments:
            m = int(s.start // 60)
            sec = int(s.start % 60)
            dialogue_lines.append(f"--- [{m:02d}:{sec:02d}] [Pembicara 1]: {s.text.strip()}")

    dialogue = "\n".join(dialogue_lines)
    print("\n--- EXTRACTED TRANSCRIPT ---")
    print("\n".join(dialogue_lines[:15]))
    if len(dialogue_lines) > 15:
        print(f"... and {len(dialogue_lines) - 15} more turns.")

    # 4. Request Summary & Table
    meeting_name = os.path.splitext(os.path.basename(audio_path))[0].replace("_", " ").title()
    summary = request_summary(dialogue, meeting_name, "Indonesian" if args.lang == "id" else "English")

    # 5. Display Structured Summary & Action Items Table
    print("\n" + "=" * 60)
    print(f"HASIL NOTULEN & TINDAK LANJUT RAPAT")
    print("=" * 60)
    print(f"\nJudul: {summary.get('title', 'Notulen Rapat')}")
    print(f"\nRingkasan Eksekutif:\n{summary.get('executiveSummary', '-')}\n")

    print("Pokok Pembahasan:")
    for pt in summary.get("keyDiscussionPoints", []):
        print(f" - {pt}")

    print("\nKeputusan Rapat:")
    decisions = summary.get("decisions", [])
    if decisions:
        for d in decisions:
            print(f" - {d}")
    else:
        print(" (Tidak ada keputusan spesifik yang tercatat)")

    print("\n" + "=" * 60)
    print("TABEL TINDAK LANJUT / ACTION ITEMS")
    print("=" * 60)

    action_items = summary.get("actionItems", [])
    if action_items:
        # Markdown table header
        print("| No | Tugas | PIC / Penanggung jawab | Prioritas | Tenggat / Syarat |")
        print("| :--- | :--- | :--- | :---: | :--- |")
        for idx, item in enumerate(action_items, 1):
            task = item.get("task", "-")
            pic = item.get("assignee", "Belum ditentukan")
            prio = item.get("priority", "Medium")
            deadline = item.get("deadline", "-")
            print(f"| {idx} | {task} | {pic} | {prio} | {deadline} |")
    else:
        print("Belum ada tindak lanjut yang tercatat.")

    # Save to file
    out_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "test_results")
    os.makedirs(out_dir, exist_ok=True)
    out_file = os.path.join(out_dir, f"{os.path.splitext(os.path.basename(audio_path))[0]}_summary.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump({"transcript": dialogue_lines, "summary": summary}, f, indent=2, ensure_ascii=False)
    print(f"\n[OK] Full summary and transcript saved to: {out_file}\n")


if __name__ == "__main__":
    main()
