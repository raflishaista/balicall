"""Paced synthetic two-voice replay against the real native streaming workers."""
import argparse
import asyncio
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import shlex
import time
import uuid
import wave
import numpy as np
from websockets.asyncio.client import connect


def load_config(path):
    for line in Path(path).read_text().splitlines():
        if line and not line.startswith('#') and '=' in line:
            key,value=line.split('=',1)
            os.environ[key]=shlex.split(value)[0] if value else ''


def audio_file(path):
    with wave.open(str(path),'rb') as source:
        audio=np.frombuffer(source.readframes(source.getnframes()),dtype='<i2').astype(np.float32)/32768
        rate=source.getframerate()
    if rate!=16000:
        audio=np.interp(np.arange(round(len(audio)*16000/rate))*rate/16000,np.arange(len(audio)),audio)
    return audio.astype(np.float32)


def make_ticket(diarize):
    claims=dict(meetingId='qwen-live-verification',speakerId='fixture-microphone',nonce=str(uuid.uuid4()),
        model='qwen3-asr-0.6b-live',language='en',diarize=diarize,exp=int(time.time())+60)
    payload=base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('=')
    signature=base64.urlsafe_b64encode(hmac.new(os.environ['QWEN_LIVE_STT_SECRET'].encode(),payload.encode(),hashlib.sha256).digest()).decode().rstrip('=')
    return payload+'.'+signature


async def replay(audio,diarize):
    frames=[]; start=time.monotonic(); first=None; stop_at=None
    async with connect('ws://127.0.0.1:8008/asr?ticket='+make_ticket(diarize),open_timeout=10,max_size=1048576) as socket:
        config=json.loads(await socket.recv())
        if config.get('type')!='config': raise RuntimeError('Worker did not configure stream')
        async def receive():
            nonlocal first
            async for message in socket:
                data=json.loads(message); elapsed=time.monotonic()-start
                if data.get('type')=='error': raise RuntimeError(data['error'])
                if data.get('type')=='transcript':
                    if data.get('interim') and first is None: first=elapsed
                    frames.append(dict(elapsed=round(elapsed,3),**data))
                if data.get('type')=='ready_to_stop': return
        receiving=asyncio.create_task(receive())
        try:
            for offset in range(0,len(audio),3200):
                pcm=(np.clip(audio[offset:offset+3200],-1,1)*32767).astype('<i2').tobytes()
                await socket.send(pcm)
                target=start+min(offset+3200,len(audio))/16000
                await asyncio.sleep(max(0,target-time.monotonic()))
            stop_at=time.monotonic()-start
            await socket.send(b'')
            await asyncio.wait_for(receiving,60)
        finally:
            if not receiving.done(): receiving.cancel()
    finals=[segment for frame in frames for segment in frame.get('final',[])]
    ids=[s['segmentId'] for s in finals]
    result=dict(diarization=diarize,audioSeconds=round(len(audio)/16000,3),firstInterimSeconds=round(first,3) if first is not None else None,
        stopSentSeconds=round(stop_at,3),totalSeconds=round(time.monotonic()-start,3),finals=finals,frames=frames)
    if not finals or len(ids)!=len(set(ids)): raise RuntimeError('Missing or duplicated final segments')
    if first is None or first>=stop_at: raise RuntimeError('No interim text arrived while audio was still streaming')
    return result


async def main():
    parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);parser.add_argument('--voice-a',required=True);parser.add_argument('--voice-b',required=True);parser.add_argument('--output',required=True);parser.add_argument('--concurrent',action='store_true')
    args=parser.parse_args();load_config(args.config)
    a,b=audio_file(args.voice_a),audio_file(args.voice_b)
    audio=np.concatenate((a,np.zeros(16000,dtype=np.float32),b,np.zeros(16000,dtype=np.float32),a,np.zeros(32000,dtype=np.float32)))
    results=[]
    if args.concurrent:
        results=await asyncio.gather(replay(audio,True),replay(audio,True))
        Path(args.output).write_text(json.dumps(dict(fixture='Two concurrent synthetic shared-microphone streams',results=results),indent=2))
        print(json.dumps([dict(firstInterimSeconds=r['firstInterimSeconds'],finals=len(r['finals']),speakers=sorted(set(f['speakerLabel'] for f in r['finals']))) for r in results]),flush=True)
        return
    for diarize in (False,True):
        result=await replay(audio,diarize);results.append(result)
        print(json.dumps({key:value for key,value in result.items() if key!='frames'}),flush=True)
    Path(args.output).write_text(json.dumps(dict(fixture='Synthetic A-B-A voices; validates plumbing, not human Indonesian accuracy.',results=results),indent=2))

if __name__=='__main__': asyncio.run(main())
