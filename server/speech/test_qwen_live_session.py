import unittest
import numpy as np
from qwen_live_session import QwenLiveSession

class Engine:
    def create_state(self,language): return {'text':''}
    def feed(self,audio,state): state['text']='hello there'; return state['text']
    def finish(self,state): return state['text']
    def transcribe_turn(self,audio,language): return 'turn text'
    def speech(self,audio): return bool(np.any(audio))

class Diarizer:
    def __init__(self,turns): self.turns=turns
    async def feed(self,packet,finish=False): result=self.turns; self.turns=[]; return result
    async def close(self): pass

def packet(seconds=1): return (np.ones(int(seconds*16000),dtype='<i2')*1000).tobytes()
def turn(start=0,end=16000,label='Pembicara 1',attribution='assigned'):
    return dict(startSample=start,endSample=end,speakerLabel=label,attribution=attribution)

class SessionTests(unittest.IsolatedAsyncioTestCase):
    async def test_pause_flushes_once_without_closing_speaker_session(self):
        session=QwenLiveSession(Engine(),dict(language='id',speakerId='o',nonce='s',diarize=True),Diarizer([]))
        await session.feed(packet())
        frames=await session.pause()
        self.assertFalse(session.closed)
        self.assertEqual(len([s for f in frames for s in f.get('final',[])]),1)
        self.assertEqual([s for f in await session.pause() for s in f.get('final',[])],[])
        await session.feed(packet())
        finals=[s for f in await session.finish() for s in f.get('final',[])]
        self.assertEqual(finals[0]['segmentId'],'s-2')

    async def test_unmatched_voiced_gap_is_finalized_before_later_known_turn(self):
        diarizer=Diarizer([turn(start=8000,end=16000,label='Pembicara 2')])
        session=QwenLiveSession(Engine(),dict(language='id',speakerId='owner',nonce='s',diarize=True),diarizer)
        finals=[seg for frame in await session.feed(packet()) for seg in frame['final']]
        self.assertEqual([s['attribution'] for s in finals],['unknown','assigned'])
        self.assertEqual((finals[0]['start'],finals[0]['end']),(0,0.5))

    async def test_long_silence_does_not_exhaust_buffer(self):
        session=QwenLiveSession(Engine(),dict(language='id',speakerId='o',nonce='s',diarize=True),Diarizer([]))
        for _ in range(65): await session.feed(bytes(32000))
        self.assertLessEqual(len(session.buffer),2*16000)

    async def test_diarization_failure_keeps_transcription_with_unknown_label(self):
        class Broken(Diarizer):
            async def feed(self,*args,**kwargs): raise ConnectionError('fixture')
        session=QwenLiveSession(Engine(),dict(language='id',speakerId='o',nonce='s',diarize=True),Broken([]))
        frames=await session.feed(packet())
        self.assertEqual(frames[0]['type'],'warning')
        frames=await session.finish()
        self.assertEqual(frames[0]['final'][0]['attribution'],'unknown')

    async def test_diarizer_disconnect_only_on_stop_still_flushes_residual_speech(self):
        class StopFailure(Diarizer):
            async def feed(self,packet,finish=False):
                if finish: raise ConnectionError('stop failure')
                return []
        session=QwenLiveSession(Engine(),dict(language='id',speakerId='o',nonce='s',diarize=True),StopFailure([]))
        await session.feed(packet())
        frames=await session.finish()
        self.assertEqual(frames[0]['type'],'warning')
        self.assertEqual(frames[-1]['final'][0]['attribution'],'unknown')
        self.assertEqual(await session.finish(),[])

    async def test_interim_is_not_persisted_and_personal_final_emits_once(self):
        session=QwenLiveSession(Engine(),dict(language='id',speakerId='owner',nonce='session',diarize=False))
        frames=await session.feed(packet())
        self.assertEqual(frames[0]['interim'],'hello there');self.assertEqual(frames[0]['final'],[])
        frames=await session.finish()
        self.assertEqual(len(frames[0]['final']),1)
        self.assertEqual((await session.finish()),[])

    async def test_speaker_turn_final_is_attributed_and_not_duplicated_on_stop(self):
        diarizer=Diarizer([turn()])
        session=QwenLiveSession(Engine(),dict(language='id',speakerId='owner',nonce='session',diarize=True),diarizer)
        frames=await session.feed(packet())
        final=[seg for f in frames for seg in f['final']]
        self.assertEqual(final[0]['speakerLabel'],'Pembicara 1')
        self.assertEqual(final[0]['sourceId'],'owner')
        self.assertEqual(final[0]['text'],'turn text')
        self.assertEqual([seg for f in await session.finish() for seg in f['final']],[])

    async def test_overlap_remains_explicit_and_replayed_turn_is_ignored(self):
        diarizer=Diarizer([turn(attribution='overlap',label='Suara bertumpuk')]*2)
        session=QwenLiveSession(Engine(),dict(language='id',speakerId='owner',nonce='session',diarize=True),diarizer)
        final=[s for f in await session.feed(packet()) for s in f['final']]
        self.assertEqual(len(final),1);self.assertEqual(final[0]['attribution'],'overlap')

if __name__=='__main__': unittest.main()
