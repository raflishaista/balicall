"""Authenticated native Qwen streaming with bounded per-client receive queues."""
import asyncio
import json
import logging
import os
import urllib.request
from contextlib import asynccontextmanager,suppress
from fastapi import FastAPI,WebSocket,WebSocketDisconnect
from qwen_live_engine import QwenEngine
from qwen_live_protocol import MODEL,decode_pcm
from qwen_live_session import QwenLiveSession
from stream_tickets import TicketVerifier

logger=logging.getLogger('uvicorn.error')


class DiarizationClient:
    def __init__(self,socket): self.socket=socket

    @classmethod
    async def connect(cls):
        from websockets.asyncio.client import connect
        socket=await connect(os.getenv('QWEN_DIAR_STREAM_URL','ws://127.0.0.1:8009/asr'),
            additional_headers={'Authorization':'Bearer '+os.environ['QWEN_DIAR_STREAM_SECRET']},
            open_timeout=5,max_size=65536,max_queue=1)
        config=json.loads(await asyncio.wait_for(socket.recv(),5))
        if config.get('type')!='config':
            await socket.close(); raise ConnectionError('Diarization session unavailable')
        return cls(socket)

    async def feed(self,packet,finish=False):
        try:
            await self.socket.send(packet)
            result=json.loads(await asyncio.wait_for(self.socket.recv(),20))
            if 'turns' not in result: raise ConnectionError('Invalid diarization result')
            return result['turns']
        except (OSError,TimeoutError) as error: raise ConnectionError('Diarization disconnected') from error
        except Exception as error:
            # WebSocket ConnectionClosed is not an OSError.
            raise ConnectionError('Diarization stream failed') from error

    async def close(self):
        with suppress(Exception): await self.socket.close()


def diarization_ready():
    try:
        origin=os.getenv('QWEN_DIAR_HEALTH_URL','http://127.0.0.1:8009/health')
        with urllib.request.urlopen(origin,timeout=0.75) as response:
            data=json.loads(response.read(16384))
        return data.get('ready') is True and data.get('streaming') is True and data.get('diarization') is True
    except Exception: return False


def create_app(engine=None,secret=None):
    @asynccontextmanager
    async def lifespan(app):
        key=secret if secret is not None else os.getenv('QWEN_LIVE_STT_SECRET','')
        if len(key)<32: raise RuntimeError('QWEN_LIVE_STT_SECRET must contain at least 32 characters')
        app.state.verifier=TicketVerifier(key,MODEL)
        app.state.engine=engine if engine is not None else QwenEngine()
        app.state.active=0
        yield

    app=FastAPI(lifespan=lifespan)

    @app.get('/health')
    def health():
        return dict(ready=hasattr(app.state,'engine'),streaming=True,native=True,model=MODEL,
            diarization=diarization_ready(),activeSessions=app.state.active,maxSessions=2)

    @app.websocket('/asr')
    async def transcribe(socket:WebSocket):
        try: ticket=app.state.verifier.verify(socket.query_params.get('ticket',''))
        except ValueError:
            await socket.close(code=4401); return
        if app.state.active>=2:
            await socket.close(code=4429); return
        app.state.active+=1
        session=None; receiver=None
        try:
            diarizer=await DiarizationClient.connect() if ticket.get('diarize') else None
            session=QwenLiveSession(app.state.engine,ticket,diarizer)
            await socket.accept()
            await socket.send_json(dict(type='config',sampleRate=16000,model=MODEL,diarization=bool(diarizer)))
            queue=asyncio.Queue(maxsize=64)
            pending=0
            async def receive():
                nonlocal pending
                while True:
                    packet=await asyncio.wait_for(socket.receive_bytes(),60)
                    decode_pcm(packet)
                    pending+=len(packet)
                    if pending>320000 or queue.full(): raise ValueError('Streaming backlog exceeds ten seconds')
                    queue.put_nowait(packet)
                    if not packet: return
            receiver=asyncio.create_task(receive())
            while True:
                get=asyncio.create_task(queue.get())
                done,_=await asyncio.wait((get,receiver),return_when=asyncio.FIRST_COMPLETED)
                if receiver in done and receiver.exception() is not None:
                    get.cancel(); raise receiver.exception()
                # A normally completed receiver has enqueued the stop marker.
                packet=await get; pending-=len(packet)
                frames=await (session.feed(packet) if packet else session.finish())
                for frame in frames: await socket.send_json(frame)
                if not packet:
                    await socket.send_json(dict(type='ready_to_stop')); break
        except WebSocketDisconnect:
            pass
        except Exception as error:
            logger.warning('Qwen live session failed: %s',type(error).__name__)
            with suppress(Exception):
                await socket.send_json(dict(type='error',error='Qwen streaming gagal atau kapasitas penuh. Coba lagi.'))
        finally:
            if receiver:
                receiver.cancel()
                with suppress(asyncio.CancelledError,Exception): await receiver
            if session: await session.close()
            app.state.active-=1
            with suppress(Exception): await socket.close()
    return app


app=create_app()
