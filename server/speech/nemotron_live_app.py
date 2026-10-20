"""Internal loopback-only diarization stream. One cache per authenticated socket."""
import asyncio
import os
import secrets
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from nemotron_live_engine import NemotronEngine
from qwen_live_protocol import decode_pcm


@asynccontextmanager
async def lifespan(app):
    key=os.environ.get('QWEN_DIAR_STREAM_SECRET','')
    if len(key)<32: raise RuntimeError('QWEN_DIAR_STREAM_SECRET must contain at least 32 characters')
    app.state.key=key
    app.state.engine=NemotronEngine(os.getenv('NEMOTRON_MODEL_PATH','nvidia/Nemotron-3-Diarization'),os.getenv('NEMOTRON_MODEL_REVISION'),os.getenv('NEMOTRON_DEVICE','cuda'))
    app.state.active=0
    yield

app=FastAPI(lifespan=lifespan)

@app.get('/health')
def health():
    return dict(ready=hasattr(app.state,'engine'),streaming=True,diarization=True,model='nvidia/Nemotron-3-Diarization')

@app.websocket('/asr')
async def transcribe(socket:WebSocket):
    if not secrets.compare_digest(socket.headers.get('authorization',''),'Bearer '+app.state.key):
        await socket.close(code=4401); return
    if app.state.active>=2:
        await socket.close(code=4429); return
    app.state.active+=1
    try:
        session=app.state.engine.create_session()
        await socket.accept(); await socket.send_json(dict(type='config',sampleRate=16000))
        while True:
            packet=await asyncio.wait_for(socket.receive_bytes(),timeout=60)
            turns=await asyncio.to_thread(session.feed,decode_pcm(packet),not packet)
            await socket.send_json(dict(turns=turns,receivedSamples=session.samples))
            if not packet: break
    except WebSocketDisconnect:
        pass
    except Exception:
        try: await socket.send_json(dict(type='error',error='Diarization stream failed'))
        except Exception: pass
    finally:
        app.state.active-=1
        try: await socket.close()
        except Exception: pass
