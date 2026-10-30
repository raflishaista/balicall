import unittest
import numpy as np
from nemotron_live_engine import TurnCollector, NemotronSession

class Processor:
    num_samples_first_audio_chunk=8
    num_samples_per_audio_chunk=6
    num_mel_frames_per_step=1
    def audio_chunk_start(self, step): return step*4
    def __call__(self,audio,**options): return dict(audio=audio.copy(),options=options)

class NemotronTests(unittest.TestCase):
    def test_short_speaker_interruptions_are_unknown_instead_of_lost_or_assigned(self):
        collector=TurnCollector(stable_frames=20,frame_samples=160)
        result=collector.feed([(0,)]*25+[(1,)]*10+[(0,)]*25+[()]*25)+collector.finish()
        self.assertEqual([t['attribution'] for t in result],['assigned','unknown','assigned'])
        self.assertEqual(result[1]['speakerLabel'],'Pembicara belum diketahui')
        self.assertEqual((result[1]['startSample'],result[1]['endSample']),(4000,5600))

    def test_unstable_tail_is_not_promoted_to_known_speaker_at_stop(self):
        collector=TurnCollector(stable_frames=20,frame_samples=160)
        result=collector.feed([(0,)]*10)+collector.finish()
        self.assertEqual(result[0]['attribution'],'unknown')

    def test_turns_keep_arrival_labels_across_silence_and_overlap(self):
        turns=TurnCollector(stable_frames=1, frame_samples=1)
        results=[]
        for label in [(0,),(0,),(),(1,),(1,),(),(0,),(0,),(0,1)]:
            results+=turns.feed([label])
        results+=turns.finish()
        self.assertEqual([t['speakerLabel'] for t in results],['Pembicara 1','Pembicara 2','Pembicara 1','Suara bertumpuk'])
        self.assertEqual(results[-1]['attribution'],'overlap')

    def test_first_later_and_last_chunk_geometry_reuses_cache(self):
        calls=[]
        def forward(inputs,cache):
            calls.append((len(inputs['audio']),cache,inputs['options']))
            return [],len(calls)
        session=NemotronSession(Processor(),forward)
        session.feed(np.ones(8,dtype=np.float32))
        session.feed(np.ones(4,dtype=np.float32))
        session.feed(np.ones(1,dtype=np.float32),finish=True)
        self.assertEqual([c[0] for c in calls],[8,6,5])
        self.assertEqual([c[1] for c in calls],[None,1,2])
        self.assertTrue(calls[-1][2]['is_last_audio_chunk'])
        self.assertFalse(calls[1][2]['is_first_audio_chunk'])
        self.assertEqual(session.buffer.size,0)

    def test_sessions_do_not_share_caches(self):
        forward=lambda inputs,cache:([],object())
        a=NemotronSession(Processor(),forward); b=NemotronSession(Processor(),forward)
        a.feed(np.ones(8,dtype=np.float32))
        self.assertIsNone(b.cache)

if __name__=='__main__': unittest.main()
