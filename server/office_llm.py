import os
import json
import requests
from dotenv import load_dotenv

load_dotenv()

LLM_PROVIDER = os.getenv("LLM_PROVIDER", "office").lower()

if LLM_PROVIDER == "office":
    # Terima LLM_KEY maupun LLM_API_KEY sebagai nama kunci.
    LLM_KEY = os.getenv("LLM_KEY") or os.getenv("LLM_API_KEY")
    if not LLM_KEY:
        raise ValueError("LLM_KEY / LLM_API_KEY tidak ditemukan di .env")
    # Base URL dan model dapat ditimpa lewat .env; nilai lama sebagai fallback.
    LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://10.7.1.21/v1")
    TEXT_MODEL = os.getenv("LLM_MODEL") or os.getenv("TEXT_MODEL", "qwen-35b")
    SUPPORTS_TOOLS = True

def summarize_transcripts(transcripts, room_name="site-sync-tower-jakarta"):
    """
    Summarizes meeting transcripts using the office LLM endpoint (qwen-35b).
    """
    endpoint = f"{LLM_BASE_URL.rstrip('/')}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {LLM_KEY}"
    }

    dialogue = "\n".join([f"[{t.get('speakerName', t.get('speakerId'))}]: {t.get('text', '')}" for t in transcripts])
    
    prompt = f"""You are the official AI Meeting Secretary for Bali Tower Telecom.
Analyze the following meeting transcript and respond strictly with valid JSON.

Meeting Room: {room_name}

Dialogue:
{dialogue}

Schema required:
{{
  "title": "Meeting Title",
  "executiveSummary": "Summary...",
  "keyDiscussionPoints": ["point 1", "point 2"],
  "decisions": ["decision 1"],
  "actionItems": [
    {{
      "task": "Task description",
      "assignee": "Name",
      "priority": "High",
      "deadline": "Next Shift"
    }}
  ],
  "attendanceSummary": ["Name 1"]
}}
"""

    response = requests.post(
        endpoint,
        headers=headers,
        json={
            "model": TEXT_MODEL,
            "messages": [
                {"role": "system", "content": "You are a helpful meeting secretary."},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.3
        },
        timeout=60
    )
    response.raise_for_status()
    result = response.json()
    return result["choices"][0]["message"]["content"]

if __name__ == "__main__":
    print(f"Loaded Office LLM: {TEXT_MODEL} at {LLM_BASE_URL}")
    print("Ready to summarize Bali Tower meeting transcripts.")
