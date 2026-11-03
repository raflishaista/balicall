import unittest
import numpy as np
from qwen_live_session import QwenLiveSession
from qwen_gguf_engine import QwenGgufEngine


class FakeDiarizer:
    def __init__(self): self.count = 0
    async def feed(self, packet, finish=False):
        if finish: return []
        self.count += 1
        if self.count == 1:
            return [{'startSample': 0, 'endSample': 16000, 'speakerLabel': 'Pembicara 1', 'attribution': 'assigned'}]
        return [{'startSample': 16000, 'endSample': 32000, 'speakerLabel': 'Suara bertumpuk', 'attribution': 'overlap'}]
    async def close(self): pass


class AdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_nemotron_turns_use_separate_q8_engine_and_preserve_overlap(self):
        calls = []
        def transcribe(audio, language):
            calls.append((len(audio), language))
            return 'teks uji'
        engine = QwenGgufEngine(transcribe=transcribe, speech=lambda a: bool(np.any(a)))
        session = QwenLiveSession(engine, {'language': 'id', 'speakerId': 'host', 'nonce': 'qc', 'diarize': True}, FakeDiarizer())
        packet = (np.ones(16000, dtype='<i2') * 2000).tobytes()
        frames = await session.feed(packet)
        frames += await session.feed(packet)
        frames += await session.finish()
        final = [item for frame in frames for item in frame.get('final', [])]
        self.assertEqual([item['attribution'] for item in final], ['assigned', 'overlap'])
        self.assertEqual([item['speakerLabel'] for item in final], ['Pembicara 1', 'Suara bertumpuk'])
        self.assertEqual([item['segmentId'] for item in final], ['qc-1', 'qc-2'])
        self.assertEqual(calls, [(16000, 'id'), (16000, 'id')])

    async def test_diarizer_disconnect_marks_speech_unknown(self):
        class Disconnected(FakeDiarizer):
            async def feed(self, packet, finish=False): raise ConnectionError('offline')
        engine = QwenGgufEngine(transcribe=lambda audio, language: 'teks', speech=lambda a: bool(np.any(a)))
        session = QwenLiveSession(engine, {'language': 'id', 'speakerId': 'host', 'nonce': 'qc', 'diarize': True}, Disconnected())
        frames = await session.feed((np.ones(16000, dtype='<i2') * 2000).tobytes())
        frames += await session.finish()
        self.assertTrue(any(frame.get('type') == 'warning' for frame in frames))
        final = [item for frame in frames for item in frame.get('final', [])]
        self.assertEqual(final[0]['attribution'], 'unknown')

    async def test_pause_does_not_reset_diarizer_or_duplicate_audio(self):
        class PersistentDiarizer:
            def __init__(self): self.calls = 0
            async def feed(self, packet, finish=False):
                if finish: return []
                self.calls += 1
                return []
            async def close(self): pass
        diarizer=PersistentDiarizer()
        engine=QwenGgufEngine(transcribe=lambda audio, language: 'teks', speech=lambda a: bool(np.any(a)))
        session=QwenLiveSession(engine, {'language':'id','speakerId':'host','nonce':'qc','diarize':True}, diarizer)
        packet=(np.ones(16000,dtype='<i2')*2000).tobytes()
        await session.feed(packet)
        first=await session.pause()
        self.assertEqual(len([s for f in first for s in f.get('final',[])]),1)
        self.assertIs(session.diarizer,diarizer)
        await session.feed(packet)
        final=await session.finish()
        self.assertEqual(len([s for f in final for s in f.get('final',[])]),1)

    def test_state_is_bounded_and_rejects_nonlocal_worker(self):
        with self.assertRaises(ValueError): QwenGgufEngine('http://10.0.0.1:8012/v1/audio/transcriptions',transcribe=lambda *_:'',speech=lambda _:False)
        engine=QwenGgufEngine(transcribe=lambda *_:'',speech=lambda _:False)
        state=engine.create_state('id')
        with self.assertRaises(ValueError): engine.feed(np.zeros(16000*60+1,dtype=np.float32),state)
        self.assertEqual(state['samples'],0)


if __name__ == '__main__': unittest.main()
