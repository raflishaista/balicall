import unittest
from sea_diarized_session import SeaDiarizedSession
from test_sea_live_session import Engine,packet
from test_sea_diarization import turn


def finals(frames):return [item for frame in frames for item in frame.get('final',[])]


class Diarizer:
    def __init__(self,turns=None):self.turns=turns or [];self.closed=False;self.calls=0
    async def feed(self,packet,finish=False):
        self.calls+=1
        result=self.turns;self.turns=[]
        return result
    async def close(self):self.closed=True


class SessionTests(unittest.IsolatedAsyncioTestCase):
    async def test_silence_does_not_retain_the_entire_speaker_turn_history(self):
        class SilenceTurns(Diarizer):
            async def feed(self,packet,finish=False):
                start=self.calls*16000;self.calls+=1
                return [turn(start,start+16000)]
        session=self.session(SilenceTurns())
        for _ in range(100):await session.feed(packet(1,0))
        self.assertLessEqual(len(session.attributor.turns),1)

    def session(self,diarizer):
        return SeaDiarizedSession(Engine(),dict(nonce='sea-diar',speakerId='owner',diarize=True),diarizer,session_proof='signed-proof')

    async def test_word_boundaries_unknown_and_two_speakers_survive_pause_once(self):
        diarizer=Diarizer([turn(0,4800),turn(4800,16000,'Pembicara 2')])
        session=self.session(diarizer)
        self.assertTrue((await session.feed(packet()))[-1]['interim'])
        result=finals(await session.pause())
        self.assertEqual([item['attribution'] for item in result],['assigned','unknown','assigned'])
        self.assertEqual([item['speakerLabel'] for item in result],['Pembicara 1','Pembicara belum diketahui','Pembicara 2'])
        self.assertTrue(all(item['sessionProof']=='signed-proof' for item in result))
        self.assertEqual(' '.join(item['text'] for item in result),'halo halo dunia')
        self.assertFalse(diarizer.closed)
        self.assertEqual(finals(await session.pause()),[])
        self.assertEqual(finals(await session.finish()),[])
        await session.close();self.assertTrue(diarizer.closed)

    async def test_delayed_turns_hold_words_then_emit_with_original_timestamps(self):
        class Delayed(Diarizer):
            async def feed(self,packet,finish=False):
                self.calls+=1
                return [turn(0,16000)] if self.calls==3 else []
        session=self.session(Delayed())
        await session.feed(packet())
        waiting=await session.feed(packet(1,0))
        self.assertEqual(finals(waiting),[])
        self.assertIn('halo halo dunia',waiting[-1]['interim'])
        result=finals(await session.feed(packet(1,0)))
        self.assertEqual(result[0]['text'],'halo halo dunia')
        self.assertEqual((result[0]['start'],result[0]['end']),(.1,.6))
        self.assertEqual(result[0]['attribution'],'assigned')
        self.assertEqual(finals(await session.finish()),[])

    async def test_overlap_and_stop_failure_do_not_become_participant_identity(self):
        session=self.session(Diarizer([turn(0,16000,'Suara bertumpuk','overlap')]))
        await session.feed(packet())
        self.assertEqual(finals(await session.finish())[0]['attribution'],'overlap')
        class Broken(Diarizer):
            async def feed(self,packet,finish=False):
                if finish:raise ConnectionError('lost at stop')
                return []
        session=self.session(Broken())
        await session.feed(packet())
        result=await session.finish()
        self.assertTrue(any(frame.get('type')=='warning' for frame in result))
        self.assertEqual(finals(result)[0]['attribution'],'unknown')
        self.assertEqual(finals(result)[0]['speakerLabel'],'Pembicara belum diketahui')
        self.assertEqual(await session.finish(),[])

    async def test_disconnect_during_feed_continues_as_unknown_and_keeps_proof(self):
        class Broken(Diarizer):
            async def feed(self,*args,**kwargs):raise ConnectionError('lost')
        diarizer=Broken();session=self.session(diarizer)
        frames=await session.feed(packet())
        self.assertTrue(any(frame.get('type')=='warning' for frame in frames))
        self.assertTrue(diarizer.closed)
        result=finals(await session.finish())
        self.assertEqual(result[0]['attribution'],'unknown')
        self.assertEqual(result[0]['sessionProof'],'signed-proof')

    async def test_stalled_turns_have_bounded_wait_without_losing_text(self):
        session=self.session(Diarizer())
        session._final_words([('tertunda',0,16000)])
        output=[]
        for _ in range(18):output+=await session.feed(packet(2,0))
        result=finals(output)
        self.assertEqual([item['text'] for item in result],['tertunda'])
        self.assertEqual(result[0]['attribution'],'unknown')
        self.assertEqual(session.pending,[])
        self.assertTrue(any(frame.get('type')=='warning' for frame in output))


if __name__=='__main__':unittest.main()
