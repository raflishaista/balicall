"""
Inject Audio Meeting into BaliCall Web App.
Transcribes audio from Downloads/ssh-audios, creates a room in the running BaliCall server (port 3001),
uploads the diarized transcript segments, and triggers summarization so you can view it directly in the web UI.

Usage:
  python scripts/inject_audio_meeting.py indonesian2.wav --room demo-audio-test --duration 120 --diarize
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

try:
    import torch
    from transformers import AutoProcessor, AutoModelForAudioFrameClassification
    DIARIZATION_AVAILABLE = True
except ImportError:
    DIARIZATION_AVAILABLE = False

DEFAULT_AUDIO_DIR = r"C:\Users\rafliaditya.intern\Downloads\ssh-audios"
DEFAULT_SERVER_URL = "http://127.0.0.1:3001/api"


def decode_audio(file_path: str, max_duration_sec: int = 0, target_sr: int = 16000) -> np.ndarray:
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
    return waveform


def align_words(words, turns, default_speaker="Pembicara 1"):
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


def main():
    parser = argparse.ArgumentParser(description="Inject audio into a BaliCall meeting room")
    parser.add_argument("filename", help="Audio filename in ssh-audios (e.g. indonesian2.wav)")
    parser.add_argument("--room", default="audio-test-room", help="Meeting room name in BaliCall")
    parser.add_argument("--duration", type=int, default=120, help="Max duration in seconds (default 120, 0 for full)")
    parser.add_argument("--lang", default="id", choices=["id", "en"], help="Language ('id' or 'en')")
    parser.add_argument("--diarize", action="store_true", help="Enable Nemotron-3 speaker diarization")

    args = parser.parse_args()

    audio_path = os.path.join(DEFAULT_AUDIO_DIR, args.filename) if not os.path.isabs(args.filename) else args.filename
    if not os.path.exists(audio_path):
        print(f"[!] Error: File not found: {audio_path}")
        sys.exit(1)

    print(f"[*] Processing audio: {audio_path} ({args.duration}s)...")
    waveform = decode_audio(audio_path, max_duration_sec=args.duration)

    print("[*] Transcribing audio with Whisper...")
    whisper = WhisperModel("base", device="cpu", compute_type="int8", cpu_threads=4)
    segments, _ = whisper.transcribe(waveform, language=args.lang, vad_filter=True, word_timestamps=True, beam_size=1)
    segments = list(segments)

    diar_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "nemotron3-diarization")
    turns = []
    if args.diarize and DIARIZATION_AVAILABLE and os.path.isdir(diar_dir):
        print("[*] Running Nemotron-3 Diarization...")
        processor = AutoProcessor.from_pretrained(diar_dir)
        model = AutoModelForAudioFrameClassification.from_pretrained(diar_dir)
        model.eval()
        inputs = processor(waveform, sampling_rate=16000, return_tensors="pt")
        with torch.no_grad():
            outputs = model(**inputs)
        raw_turns = processor.extract_speaker_dict(outputs.logits, inputs.attention_mask, threshold=0.25)[0]
        turns = [
            (float(t["Start"]), float(t["End"]), f"Pembicara {int(t['Speaker']) + 1}")
            for t in raw_turns if float(t["End"]) >= float(t["Start"])
        ]
        words = [(w.start, w.end, w.word) for s in segments for w in (s.words or [])]
        final_segments = align_words(words, turns)
    else:
        final_segments = [{"start": s.start, "end": s.end, "speaker": "Peserta", "text": s.text.strip()} for s in segments]

    print(f"[OK] Extracted {len(final_segments)} dialogue turns.")

    # Check server availability
    try:
        health_req = urllib.request.Request(f"{DEFAULT_SERVER_URL.replace('/api', '')}/api/health")
        with urllib.request.urlopen(health_req, timeout=3) as resp:
            pass
    except Exception:
        print(f"[!] BaliCall server is not running on {DEFAULT_SERVER_URL}!")
        print("    Please start the server first with: 'npm start' in the server directory.")
        sys.exit(1)

    # 1. Join room / get token
    print(f"[*] Creating / joining meeting room '#{args.room}'...")
    token_payload = json.dumps({
        "roomName": args.room,
        "employeeId": "BT-TEST",
        "employeeName": "Audio Tester",
        "department": "Engineering"
    }).encode("utf-8")
    req = urllib.request.Request(f"{DEFAULT_SERVER_URL}/token", data=token_payload, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req) as resp:
        token_data = json.loads(resp.read().decode("utf-8"))

    meeting_id = token_data["meetingId"]
    auth_header = {"Content-Type": "application/json", "Authorization": f"Bearer {token_data['token']}"}

    # 2. Upload transcript segments
    print(f"[*] Uploading {len(final_segments)} speech turns to meeting {meeting_id}...")
    for seg in final_segments:
        body = json.dumps({
            "text": seg["text"],
            "segments": [{"speaker": seg["speaker"], "text": seg["text"], "start": seg["start"], "end": seg["end"]}]
        }).encode("utf-8")
        trans_req = urllib.request.Request(f"{DEFAULT_SERVER_URL}/meetings/{meeting_id}/transcript", data=body, headers=auth_header, method="POST")
        with urllib.request.urlopen(trans_req) as resp:
            pass

    # 3. Trigger summarize
    print("[*] Triggering end-of-meeting batch summary...")
    sum_req = urllib.request.Request(f"{DEFAULT_SERVER_URL}/meetings/{meeting_id}/summarize", data=b"{}", headers=auth_header, method="POST")
    with urllib.request.urlopen(sum_req, timeout=120) as resp:
        sum_data = json.loads(resp.read().decode("utf-8"))

    print("\n" + "=" * 60)
    print("SUCCESSFULLY INJECTED INTO BALICALL!")
    print("=" * 60)
    print(f"Room Name : #{args.room}")
    print(f"Meeting ID: {meeting_id}")
    summary = sum_data.get("summary", {})
    print(f"Title     : {summary.get('title')}")
    print(f"Summary   : {summary.get('executiveSummary')[:150]}...")
    print(f"Action Items: {len(summary.get('actionItems', []))} task(s)")
    print("\n👉 Now open http://localhost:5187 in your browser, enter room '#" + args.room + "' or view history to see the full interactive table in the web UI!\n")


if __name__ == "__main__":
    main()
