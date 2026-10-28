"""Authenticated windowed SEA streaming with bounded per-client receive queues."""
import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager,suppress
from fastapi import FastAPI,WebSocket,WebSocketDisconnect
from sea_live_engine import SeaEngine
from qwen_live_protocol import decode_pcm
from sea_live_session import MODEL,SeaLiveSession
from sea_diarized_session import SeaDiarizedSession
from streaming_diarization import DiarizationClient,diarization_ready
from stream_tickets import TicketVerifier
from retained_sessions import RetainedSessions

logger=logging.getLogger('uvicorn.error')


def sea_diarization_ready():
    return (os.getenv('SEA_LIVE_DIARIZATION_ENABLED','').lower()=='true'
        and len(os.getenv('SEA_DIAR_STREAM_SECRET',''))>=32
        and diarization_ready(os.getenv('SEA_DIAR_HEALTH_URL','http://127.0.0.1:8009/health')))


async def connect_sea_diarizer():
    return await DiarizationClient.connect(os.getenv('SEA_DIAR_STREAM_URL','ws://127.0.0.1:8009/asr'),os.getenv('SEA_DIAR_STREAM_SECRET',''))


def create_app(engine=None,secret=None,diarizer_factory=None):
    @asynccontextmanager
    async def lifespan(app):
        key=secret if secret is not None else os.getenv('SEA_LIVE_STT_SECRET','')
        if len(key)<32: raise RuntimeError('SEA_LIVE_STT_SECRET must contain at least 32 characters')
        app.state.verifier=TicketVerifier(key,MODEL)
        app.state.engine=engine if engine is not None else SeaEngine()
        app.state.active=0
        app.state.sessions=RetainedSessions()
        async def reap():
            while True:
                await asyncio.sleep(5)
                await app.state.sessions.expire()
        reaper=asyncio.create_task(reap())
        try:
            yield
        finally:
            reaper.cancel()
            with suppress(asyncio.CancelledError): await reaper
            await app.state.sessions.close()
            if engine is None:
                await asyncio.to_thread(app.state.engine.close)

    app=FastAPI(lifespan=lifespan)

    @app.get('/health')
    def health():
        return dict(ready=hasattr(app.state,'engine'),streaming=True,native=False,languages=['id'],model=MODEL,
            diarization=bool(diarizer_factory) or sea_diarization_ready(),activeSessions=app.state.active,maxSessions=2,
            retainedSessions=len(app.state.sessions.slots)-app.state.sessions.active,resumeGraceSeconds=45)

    @app.websocket('/asr')
    async def transcribe(socket:WebSocket):
        try:
            raw_ticket=socket.query_params.get('ticket','')
            ticket=app.state.verifier.verify(raw_ticket)
            if ticket['language']!='id': raise ValueError('Unsupported SEA language')
            if ticket.get('diarize') and not (diarizer_factory or sea_diarization_ready()): raise ValueError('SEA diarization unavailable')
        except ValueError:
            await socket.close(code=4401); return
        if socket.query_params.get('end')=='1':
            if not ticket.get('streamId'):
                await socket.close(code=4401);return
            try:
                frames=await app.state.sessions.end(ticket)
            except ValueError:
                await socket.close(code=4409);return
            await socket.accept()
            for frame in frames: await socket.send_json(frame)
            await socket.send_json(dict(type='ready_to_stop'))
            await socket.close();return
        slot=None; receiver=None; get=None; retain=False
        try:
            async def create_session():
                if ticket.get('diarize'):
                    diarizer=await (diarizer_factory or connect_sea_diarizer)()
                    return SeaDiarizedSession(app.state.engine,ticket,diarizer,raw_ticket)
                return SeaLiveSession(app.state.engine,ticket)
            try: slot,resumed=await app.state.sessions.acquire(ticket,create_session)
            except ValueError:
                await socket.close(code=4429); return
            except (ConnectionError,OSError,TimeoutError):
                await socket.close(code=4503); return
            session=slot.session
            app.state.active+=1
            await socket.accept()
            await socket.send_json(dict(type='config',sampleRate=16000,model=MODEL,
                diarization=bool(getattr(session,'diarizer',None)),sessionId=session.ticket['nonce'],resumed=resumed,resumeGraceSeconds=45))
            if resumed and slot.finals:
                await socket.send_json(dict(type='transcript',interim='',final=list(slot.finals)))
            queue=asyncio.Queue(maxsize=1500)
            pending=0; transport_gone=False
            async def receive():
                nonlocal pending
                while True:
                    message=await asyncio.wait_for(socket.receive(),60)
                    if message['type']=='websocket.disconnect':
                        await queue.put('disconnect'); return
                    packet=message.get('bytes')
                    if packet is None:
                        control=json.loads(message.get('text',''))
                        if control!={'type':'pause'} or not slot.resumable: raise ValueError('Invalid streaming control')
                        await queue.put('pause'); return
                    decode_pcm(packet)
                    pending+=len(packet)
                    if pending>960000 or queue.full(): raise ValueError('Streaming backlog exceeds thirty seconds')
                    queue.put_nowait(packet)
                    if not packet: return
            receiver=asyncio.create_task(receive())
            while True:
                get=asyncio.create_task(queue.get())
                done,_=await asyncio.wait((get,receiver),return_when=asyncio.FIRST_COMPLETED)
                if receiver in done and receiver.exception() is not None:
                    get.cancel(); raise receiver.exception()
                packet=await get
                if packet=='disconnect':
                    retain=True;break
                if packet=='pause':
                    frames=await session.pause();retain=True
                else:
                    pending-=len(packet)
                    frames=await (session.feed(packet) if packet else session.finish())
                # Journal before sending: a lost send is replayed with original IDs.
                slot.remember(frames)
                for frame in frames:
                    if not transport_gone:
                        try: await socket.send_json(frame)
                        except (WebSocketDisconnect,OSError): transport_gone=True
                if packet=='pause' or not packet:
                    await socket.send_json(dict(type='ready_to_stop')); break
        except WebSocketDisconnect:
            retain=True
        except Exception as error:
            logger.warning('SEA live session failed: %s',type(error).__name__)
            with suppress(Exception):
                await socket.send_json(dict(type='error',error='SEA streaming gagal atau kapasitas penuh. Coba lagi.'))
        finally:
            for task in (get,receiver):
                if task:
                    task.cancel()
                    with suppress(asyncio.CancelledError,Exception): await task
            if slot:
                await app.state.sessions.release(slot,retain)
                app.state.active-=1
            with suppress(Exception): await socket.close()
    return app


app=create_app()
