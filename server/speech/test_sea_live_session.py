import asyncio
import unittest
import numpy as np
from sea_live_session import SeaLiveSession


class Engine:
    def speech(self, audio): return bool(np.max(np.abs(audio)) > .01)
    def transcribe(self, audio):
        return {'text':'halo halo dunia', 'words':[
            {'word':'halo','start':.1,'end':.2},
            {'word':'halo','start':.25,'end':.4},
            {'word':'dunia','start':.45,'end':.6}]}


def packet(seconds=1, value=5000):
    return np.full(int(seconds*16000),value,dtype='<i2').tobytes()


class SessionTests(unittest.IsolatedAsyncioTestCase):
    def session(self):
        return SeaLiveSession(Engine(),dict(nonce='session-one',speakerId='owner',meetingId='room'))

    async def test_interim_then_pause_final_and_same_namespace(self):
        s=self.session()
        frames=await s.feed(packet())
        self.assertEqual(frames[-1]['interim'],'halo halo dunia')
        finals=(await s.pause())[0]['final']
        self.assertEqual(finals[0]['text'],'halo halo dunia')
        self.assertEqual(finals[0]['attribution'],'unknown')
        self.assertEqual(await s.pause(),[])
        await s.feed(packet())
        second=(await s.finish())[0]['final'][0]
        self.assertEqual(second['sessionId'],finals[0]['sessionId'])
        self.assertNotEqual(second['segmentId'],finals[0]['segmentId'])
        self.assertGreaterEqual(second['start'],finals[0]['end'])
        self.assertEqual(await s.finish(),[])

    async def test_silence_has_no_transcript_and_finishes_voiced_audio(self):
        s=self.session()
        self.assertEqual(await s.feed(packet(1,0)),[])
        await s.feed(packet())
        frames=await s.feed(packet(1,0))
        self.assertEqual(len(frames[0]['final']),1)
        self.assertEqual(await s.finish(),[])

    async def test_long_utterance_is_bounded_and_repeated_words_survive(self):
        class RollingEngine(Engine):
            def transcribe(self,audio):
                duration=len(audio)/16000
                words=([{'word':'halo','start':duration-1.8,'end':duration-1.6},
                        {'word':'halo','start':duration-1.55,'end':duration-1.35},
                        {'word':'dunia','start':duration-1.3,'end':duration-1.1}]
                       if duration>=3 else [{'word':'halo','start':.1,'end':.2},
                                            {'word':'halo','start':.25,'end':.4},
                                            {'word':'dunia','start':.45,'end':.6}])
                return {'words':words}
        s=SeaLiveSession(RollingEngine(),dict(nonce='long',speakerId='owner',meetingId='room'))
        finals=[]
        for _ in range(60):
            for frame in await s.feed(packet()): finals+=frame['final']
            self.assertLessEqual(len(s.audio),14*16000)
        for frame in await s.finish(): finals+=frame['final']
        self.assertTrue(finals)
        self.assertIn('halo halo',finals[0]['text'])
        self.assertTrue(all(b['start']>=a['end'] for a,b in zip(finals,finals[1:])))
        self.assertEqual(len({f['segmentId'] for f in finals}),len(finals))

    async def test_invalid_and_closed_input(self):
        s=self.session()
        with self.assertRaises(ValueError): await s.feed(b'x')
        await s.close()
        with self.assertRaises(ValueError): await s.feed(packet())

    async def test_detector_state_belongs_to_each_microphone(self):
        detectors=[]
        class Shared(Engine):
            def new_detector(self):
                state=[];detectors.append(state)
                def speech(audio): state.append(len(audio));return True
                return speech
        engine=Shared()
        a=SeaLiveSession(engine,{'nonce':'a','speakerId':'a'})
        b=SeaLiveSession(engine,{'nonce':'b','speakerId':'b'})
        await a.feed(packet())
        self.assertEqual(len(detectors[0]),10)
        self.assertEqual(detectors[1],[])

    async def test_rolling_window_keeps_overlap_and_drops_revised_old_word_once(self):
        class ChangingEngine(Engine):
            def __init__(self): self.rolling_calls=0
            def transcribe(self,audio):
                if len(audio)>=12*16000:
                    self.rolling_calls+=1
                    if self.rolling_calls==1:
                        return {'words':[{'word':'halo','start':10.5,'end':10.8}]}
                    return {'words':[
                        {'word':'halo','start':.45,'end':.75},
                        {'word':'halo','start':10.45,'end':10.75},
                    ]}
                return {'words':[]}

        engine=ChangingEngine()
        s=SeaLiveSession(engine,dict(nonce='session-overlap',speakerId='owner',meetingId='room'))
        first=[]
        for _ in range(6):
            for frame in await s.feed(packet(2)): first+=frame['final']
        self.assertEqual([item['text'] for item in first],['halo'])
        self.assertEqual(s.base,s.committed-12000)
        second=[]
        for _ in range(5):
            for frame in await s.feed(packet(2)): second+=frame['final']
        for frame in await s.feed(packet(.1)): second+=frame['final']
        self.assertEqual(engine.rolling_calls,2)
        self.assertEqual([item['text'] for item in second],['halo'])
        self.assertGreaterEqual(second[0]['start'],first[0]['end'])
        self.assertEqual(s.base,s.committed-12000)


if __name__=='__main__': unittest.main()
