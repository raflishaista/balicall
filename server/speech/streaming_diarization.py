"""ASR-independent authenticated Nemotron streaming transport."""
import asyncio
import json
import os
import urllib.request
from contextlib import suppress

class DiarizationClient:
    def __init__(self,socket): self.socket=socket

    @classmethod
    async def connect(cls,url=None,secret=None):
        from websockets.asyncio.client import connect
        key=secret if secret is not None else os.getenv('QWEN_DIAR_STREAM_SECRET','')
        if not key: raise ConnectionError('Diarization credentials unavailable')
        socket=None
        try:
            socket=await connect(url or os.getenv('QWEN_DIAR_STREAM_URL','ws://127.0.0.1:8009/asr'),
                additional_headers={'Authorization':'Bearer '+key},
                open_timeout=5,max_size=65536,max_queue=1)
            config=json.loads(await asyncio.wait_for(socket.recv(),5))
            if config.get('type')!='config' or config.get('sampleRate')!=16000:
                raise ConnectionError('Diarization session unavailable')
        except Exception as error:
            if socket:
                with suppress(Exception):await socket.close()
            raise ConnectionError('Diarization session unavailable') from error
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


def diarization_ready(origin=None):
    try:
        origin=origin or os.getenv('QWEN_DIAR_HEALTH_URL','http://127.0.0.1:8009/health')
        with urllib.request.urlopen(origin,timeout=0.75) as response:
            data=json.loads(response.read(16384))
        return data.get('ready') is True and data.get('streaming') is True and data.get('diarization') is True
    except Exception: return False
