"""Real-time PCM acceptance/load test through application tickets and persistence.

Uses only an isolated QC API. Public speech fixtures are not meeting accuracy ground truth.
"""
import argparse
import asyncio
import bisect
import json
import time
import urllib.request
import uuid
import wave
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
import numpy as np
from websockets.asyncio.client import connect


def read_pcm_fixture(path):
    with wave.open(str(path),'rb') as audio:
        if (audio.getframerate()!=16000 or audio.getnchannels()!=1 or audio.getsampwidth()!=2
                or audio.getcomptype()!='NONE' or not audio.getnframes()):
            raise ValueError('Fixture must be nonempty mono PCM16 at 16 kHz')
        speech=audio.readframes(audio.getnframes())
        if len(speech)!=audio.getnframes()*2:raise ValueError('Truncated PCM fixture')
        return speech


def assert_saved_final(final,entry,owner,diarize=False):
    assert entry and entry.get('id'), 'Final transcript was not stored'
    assert entry['speakerId']==owner and final['sourceId']==owner
    assert entry['speakerName']==owner and entry['requestId']==final['segmentId']
    assert entry['sttModel']=='sea-asr-id-live' and entry['text']==final['text'].strip()
    assert len(entry['segments'])==1
    segment=entry['segments'][0]
    assert 'sessionProof' not in json.dumps(entry), 'Session proof must not be persisted'
    if diarize:
        assert final.get('sessionProof'), 'Diarized final needs mode evidence'
        assert segment['attribution']==final['attribution'] and segment['speaker']==final['speakerLabel']
    else:
        assert segment['attribution']=='participant' and segment['speaker']=='Peserta'
    assert segment['sourceId']==owner and segment['sessionId']==final['sessionId']
    assert segment['text']==final['text'].strip() and segment['start']==final['start'] and segment['end']==final['end']


def assert_saved_history(expected,entries,owner,diarize=False):
    assert len(entries)==len(expected), 'Stored final count differs from acknowledged finals'
    assert {entry['id'] for entry in entries}==set(expected), 'Stored final IDs differ from acknowledged finals'
    for entry in entries:assert_saved_final(expected[entry['id']],entry,owner,diarize)


def api(path,body=None,token=None):
    headers={'Content-Type':'application/json'}
    if token: headers['Authorization']='Bearer '+token
    request=urllib.request.Request(ARGS.api+path,data=None if body is None else json.dumps(body).encode(),headers=headers)
    with urllib.request.urlopen(request,timeout=10) as response: return json.load(response)

def application_websocket_url(session_url):
    session=urlsplit(session_url)
    origin=urlsplit(ARGS.api)
    if session.scheme or session.netloc or not session.path.startswith('/sea-live-stt/asr'):
        raise ValueError('SEA live session must return the same-origin application proxy path')
    scheme='wss' if origin.scheme=='https' else 'ws'
    return urlunsplit((scheme,origin.netloc,session.path,session.query,''))


async def run_one(owner,fixture,seconds):
    speech=read_pcm_fixture(fixture)
    joined=await asyncio.to_thread(api,'/token',dict(roomName='sea-qc-'+RUN,employeeId=owner,employeeName=owner,department='QC'))
    token=joined['token'];base='/meetings/'+joined['meetingId']
    stream=str(uuid.uuid4());saved={};expected={};latencies=[];interims=0;warnings=[];attributions={};labels=set();namespace=None;resumed_count=0
    audio_positions=[0.0];sent_times=[time.monotonic()];first_interim=[];phase_started=0;phase_interim=False
    cycle=speech+bytes(32000*2)
    started=time.monotonic();sent=0;finishing=False
    async def save(frame):
        nonlocal interims,phase_interim
        if frame.get('type')=='error': raise RuntimeError(frame['error'])
        if frame.get('type')=='warning':warnings.append(frame.get('error','Diarization warning'))
        if frame.get('interim'):
            interims+=1
            if not phase_interim:
                first_interim.append(time.monotonic()-phase_started);phase_interim=True
        for final in frame.get('final',[]):
            response=await asyncio.to_thread(api,base+'/transcript',dict(sttModel='sea-asr-id-live',final=final),token)
            assert_saved_final(final,response['entry'],owner,ARGS.diarize)
            if final['segmentId'] in saved:
                assert response['entry']['id']==saved[final['segmentId']]
            if final['segmentId'] not in saved:
                label=final['attribution'];attributions[label]=attributions.get(label,0)+1
                if label=='assigned':labels.add(final['speakerLabel'])
                index=min(len(sent_times)-1,bisect.bisect_left(audio_positions,final['end']))
                latencies.append(max(0,time.monotonic()-sent_times[index]))
            saved[final['segmentId']]=response['entry']['id']
            expected[response['entry']['id']]=dict(final)
    # Exercise graceful mute and abrupt transport loss before the longer run.
    for mode in ['pause','disconnect','finish']:
        session=await asyncio.to_thread(api,base+'/live-session',dict(model='sea-asr-id-live',language='id',streamId=stream,diarize=ARGS.diarize),token)
        async with connect(application_websocket_url(session['url']),max_size=65536) as ws:
            config=json.loads(await ws.recv())
            assert config['type']=='config'
            assert bool(config.get('diarization'))==ARGS.diarize
            if namespace is None: namespace=config['sessionId']
            else:
                assert config['sessionId']==namespace and config['resumed']
                resumed_count+=1
            async def receive():
                async for raw in ws:
                    frame=json.loads(raw)
                    await save(frame)
                    if frame.get('type')=='ready_to_stop': return
            receiver=asyncio.create_task(receive())
            phase_started=time.monotonic();phase_interim=False
            duration=6 if mode!='finish' else max(6,seconds-12)
            deadline=time.monotonic()+duration
            offset=0
            while time.monotonic()<deadline:
                chunk=cycle[offset:offset+6400]
                offset=(offset+len(chunk))%len(cycle)
                if not chunk: offset=0;continue
                await ws.send(chunk)
                sent+=len(chunk)
                audio_positions.append(sent/32000);sent_times.append(time.monotonic())
                await asyncio.sleep(len(chunk)/32000)
            if mode=='disconnect':
                await ws.close()
                await receiver
                await asyncio.sleep(.3)
            else:
                if mode=='pause': await ws.send(json.dumps({'type':'pause'}))
                else: await ws.send(b'')
                await asyncio.wait_for(receiver,30)
    persisted=await asyncio.to_thread(api,base+'/transcript',None,token)
    entries=[entry for entry in persisted.get('transcripts',[]) if entry['speakerId']==owner]
    if not entries: raise AssertionError('Final transcript was not persisted')
    assert interims>0 and saved
    assert_saved_history(expected,entries,owner,ARGS.diarize)
    assert len(expected)==len(saved), 'Distinct finals reused one stored entry ID'
    await asyncio.to_thread(api,base+'/leave',{},token)
    return dict(owner=owner,seconds=time.monotonic()-started,audioSeconds=sent/32000,
        interimFrames=interims,uniqueFinals=len(saved),resumes=resumed_count,
        diarization=ARGS.diarize,attributions=attributions,speakerLabels=sorted(labels),warnings=warnings,
        firstInterimP95=float(np.percentile(first_interim,95)),
        finalLagP95=None if ARGS.diarize else float(np.percentile(latencies,95)),persisted=True,
        firstInterimSamples=len(first_interim),finalLatencySamples=len(latencies),
        latencyBasis=('phase start to first interim; final latency omitted because generated pause silence advances the diarization timeline' if ARGS.diarize else 'phase start to first interim; ASR word end to API persistence; not human-annotated speech boundaries'))


async def main():
    health=await asyncio.to_thread(api,'/health')
    assert health['seaLivePilotReady'] and 'sea-asr-id-live' in health['sttModels']
    if ARGS.diarize:assert health.get('seaLiveDiarizationReady'), 'SEA Nemotron capability is not ready'
    reports=await asyncio.gather(*(run_one('sea-qc-'+str(i),path,ARGS.seconds) for i,path in enumerate(ARGS.fixtures)))
    report=dict(run=RUN,profile='real-time PCM replay, not physical microphone',sessions=reports)
    Path(ARGS.report).write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--api',default='http://127.0.0.1:3012/api')
    parser.add_argument('--seconds',type=int,default=40)
    parser.add_argument('--diarize',action='store_true')
    parser.add_argument('--report',default='sea-live-qc.json')
    parser.add_argument('fixtures',nargs='+')
    ARGS=parser.parse_args();RUN=uuid.uuid4().hex[:8]
    asyncio.run(main())
