"""Local WhisperLiveKit worker. PCM16 mono/16 kHz; meeting tickets from Node."""
import asyncio
import base64
from contextlib import asynccontextmanager, suppress
import hashlib
import hmac
import json
import os
import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from whisperlivekit import AudioProcessor, TranscriptionEngine
from live_protocol import TranscriptFrames

SECRET = os.environ.get('LIVE_STT_SECRET', '')
used_tickets = {}
active_sessions = 0
engine = None

def verify_ticket(ticket):
    payload, signature = ticket.split('.')
    expected = base64.urlsafe_b64encode(hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).digest()).decode().rstrip('=')
    if not SECRET or not hmac.compare_digest(signature, expected):
        raise ValueError('Invalid ticket')
    data = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
    now = time.time()
    if not now < data['exp'] <= now + 65 or data['model'] != 'whisperlivekit-small' or data['language'] not in ('id', 'en'):
        raise ValueError('Expired or invalid session')
    for key, expiry in list(used_tickets.items()):
        if expiry <= now:
            del used_tickets[key]
    if data['nonce'] in used_tickets:
        raise ValueError('Ticket already used')
    used_tickets[data['nonce']] = data['exp']
    return data

@asynccontextmanager
async def lifespan(app):
    global engine
    if len(SECRET) < 32:
        raise RuntimeError('LIVE_STT_SECRET must contain at least 32 characters')
    engine = TranscriptionEngine(backend='faster-whisper', backend_policy='localagreement',
        model_size='small', model_dir=os.environ.get('LIVE_STT_MODEL_DIR') or None,
        model_cache_dir=os.environ.get('HF_HUB_CACHE') or None, lan='id',
        pcm_input=True, diarization=False, vac=True, vad=True,
        min_chunk_size=0.8, asr_coalesce_min_s=0.8,
        pause_segmentation_seconds=1.0, retention_seconds=0)
    yield

app = FastAPI(lifespan=lifespan)

@app.get('/health')
def health():
    return {'status': 'ok', 'model': 'whisperlivekit-small', 'streaming': True, 'diarization': False}

@app.websocket('/asr')
async def transcribe(socket: WebSocket):
    global active_sessions
    try:
        session = verify_ticket(socket.query_params.get('ticket', ''))
    except (ValueError, KeyError, TypeError):
        await socket.close(code=4401)
        return
    if active_sessions >= int(os.environ.get('LIVE_STT_MAX_SESSIONS', '2')):
        await socket.close(code=4429)
        return
    active_sessions += 1
    processor = None
    sender = None
    events_task = None
    try:
        events = asyncio.Queue()
        processor = AudioProcessor(transcription_engine=engine, language=session['language'], mode='full', stream_event_queue=events)
        await socket.accept()
        frames = TranscriptFrames()
        results = await processor.create_tasks()
        async def send_pause_commits():
            while True:
                event = await events.get()
                # WLK emits this only after the silence-start ASR call and its
                # matching result snapshot, so provisional words are excluded.
                if event.kind == 'silence_transcription_ready':
                    message = frames.update(frames.latest, finish=True)
                    if message['final']:
                        await socket.send_json(message)
                events.task_done()
        events_task = asyncio.create_task(send_pause_commits())
        async def send_results():
            last_interim = None
            async for response in results:
                data = response.to_dict()
                if data.get('status') == 'error':
                    raise RuntimeError(data.get('error') or 'WhisperLiveKit processing failed')
                message = frames.update(data)
                if message['final'] or message['interim'] != last_interim:
                    await socket.send_json(message)
                    last_interim = message['interim']
            await socket.send_json(frames.update(frames.latest, finish=True))
            await socket.send_json({'type': 'ready_to_stop'})
        sender = asyncio.create_task(send_results())
        await socket.send_json({'type': 'config', 'sampleRate': 16000})
        while not sender.done():
            receive = asyncio.create_task(socket.receive_bytes())
            done, _ = await asyncio.wait([receive, sender], return_when=asyncio.FIRST_COMPLETED, timeout=60)
            if receive not in done:
                receive.cancel()
                with suppress(asyncio.CancelledError):
                    await receive
                if sender in done:
                    await sender
                    break
                raise TimeoutError('No audio received')
            audio = receive.result()
            if len(audio) > 64000 or len(audio) % 2:
                raise ValueError('Expected PCM16 mono packets up to 2 seconds')
            await processor.process_audio(audio)
            if not audio:
                await asyncio.wait_for(sender, timeout=45)
                break
    except WebSocketDisconnect:
        pass
    except Exception as error:
        print(f'WhisperLiveKit session failed: {type(error).__name__}: {error}', flush=True)
        with suppress(Exception):
            await socket.send_json({'type': 'error', 'error': 'Streaming gagal. Coba transkripsi lagi.'})
    finally:
        if events_task:
            events_task.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await events_task
        if sender:
            sender.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await sender
        if processor:
            await processor.cleanup()
        active_sessions -= 1
        with suppress(Exception):
            await socket.close()
