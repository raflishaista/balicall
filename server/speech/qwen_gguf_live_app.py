"""Optional Q8 streaming-session adapter; Qwen inference remains chunked locally."""
import json
import os
import urllib.request
from urllib.parse import urlparse

from qwen_gguf_engine import QwenGgufEngine
from qwen_live_app import create_app
from qwen_live_session import QwenLiveSession
from streaming_diarization import DiarizationClient, diarization_ready

MODEL='qwen3-asr-0.6b-gguf-q8-live'


class GgufSession(QwenLiveSession):
    def __init__(self, engine, ticket, diarizer, proof):
        super().__init__(engine,ticket,diarizer)
        self.proof=proof

    def _with_proof(self, frames):
        for frame in frames:
            for segment in frame.get('final',[]): segment['sessionProof']=self.proof
        return frames

    async def feed(self,packet): return self._with_proof(await super().feed(packet))
    async def pause(self): return self._with_proof(await super().pause())
    async def finish(self): return self._with_proof(await super().finish())


def model_ready():
    try:
        with urllib.request.urlopen('http://127.0.0.1:8012/health',timeout=0.75) as response:
            health=json.loads(response.read(16384))
        with urllib.request.urlopen('http://127.0.0.1:8012/v1/models',timeout=0.75) as response:
            models=json.loads(response.read(16384))
        return (health.get('status')=='ok' and health.get('backend')=='qwen3'
                and any(item.get('backend')=='qwen3' and str(item.get('id','')).replace('\\','/').split('/')[-1].lower()=='qwen3-asr-0.6b-q8_0.gguf' for item in models.get('data',[])))
    except Exception:
        return False


def gguf_diarization_ready():
    url=urlparse(os.getenv('QWEN_GGUF_DIAR_STREAM_URL','ws://127.0.0.1:8009/asr'))
    if (os.getenv('QWEN_GGUF_DIAR_ENABLED','').lower()!='true'
        or len(os.getenv('QWEN_GGUF_DIAR_STREAM_SECRET',''))<32
        or url.scheme!='ws' or url.hostname not in ('127.0.0.1','localhost','::1')
        or url.username or url.password or url.query or url.fragment or url.path!='/asr'):
        return False
    health=os.getenv('QWEN_GGUF_DIAR_HEALTH_URL','http://127.0.0.1:8009/health')
    parsed=urlparse(health)
    if parsed.scheme!='http' or parsed.hostname not in ('127.0.0.1','localhost','::1') or parsed.username or parsed.password or parsed.query or parsed.fragment:
        return False
    return diarization_ready(health)


async def connect_gguf_diarizer():
    if not gguf_diarization_ready(): raise ConnectionError('Diarization Q8 belum siap')
    return await DiarizationClient.connect(os.getenv('QWEN_GGUF_DIAR_STREAM_URL','ws://127.0.0.1:8009/asr'),os.getenv('QWEN_GGUF_DIAR_STREAM_SECRET',''))


def create_gguf_app(engine=None,secret=None,diarizer_factory=None,model_check=model_ready,diarization_check=gguf_diarization_ready):
    return create_app(engine=engine,secret=secret if secret is not None else os.getenv('QWEN_GGUF_LIVE_SECRET',''),
        diarizer_factory=diarizer_factory or connect_gguf_diarizer,max_sessions=1,model_id=MODEL,native_streaming=False,
        readiness_check=model_check,diarization_check=lambda:model_check() and diarization_check(),engine_factory=QwenGgufEngine,enforce_readiness=True,session_factory=GgufSession)


app=create_gguf_app()
