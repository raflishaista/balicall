import types
import unittest
from unittest.mock import patch
import numpy as np
from sea_live_engine import SeaEngine


class DetectorTests(unittest.TestCase):
    def detector(self):
        frames=[]

        class Vad:
            def __init__(self,mode): pass
            def is_speech(self,pcm,rate):
                self.assert_frame(pcm,rate)
                frames.append(pcm)
                return any(pcm)
            @staticmethod
            def assert_frame(pcm,rate):
                assert len(pcm)==960 and rate==16000

        with patch.dict('sys.modules',webrtcvad=types.SimpleNamespace(Vad=Vad)):
            return SeaEngine.__new__(SeaEngine).new_detector(),frames

    def test_vad_preserves_all_samples_across_one_hundred_ms_slices(self):
        detector,frames=self.detector()
        samples=np.linspace(-.8,.8,4800,dtype=np.float32)
        for start in range(0,len(samples),1600):
            detector(samples[start:start+1600])
        expected=(np.clip(samples,-1,1)*32767).astype('<i2').tobytes()
        self.assertEqual(b''.join(frames),expected)
        self.assertEqual(len(frames),10)

    def test_short_packets_accumulate_per_microphone_until_a_complete_vad_frame(self):
        first,first_frames=self.detector()
        second,second_frames=self.detector()
        chunk=np.full(160,.5,dtype=np.float32)
        self.assertFalse(first(chunk))
        self.assertFalse(first(chunk))
        self.assertTrue(first(chunk))
        self.assertEqual(len(first_frames),1)
        self.assertEqual(second_frames,[])
        self.assertFalse(second(np.zeros(480,dtype=np.float32)))


if __name__=='__main__': unittest.main()
