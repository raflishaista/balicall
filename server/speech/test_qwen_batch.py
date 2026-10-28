import unittest
from unittest.mock import patch
import numpy as np
from qwen_batch import RATE, timeline, transcribe_recording, nemotron_turns


class BatchTests(unittest.TestCase):
    def test_returning_speaker_survives_long_recording_and_chunk_boundaries(self):
        audio = np.ones(70 * RATE, dtype=np.float32)
        calls = []
        def recognize(clip, language):
            calls.append((len(clip), language))
            return 'hasil'
        result = transcribe_recording(audio, 'Indonesian', recognize, lambda _: True,
            [{'start': 0, 'end': 32, 'speaker': 'a'},
             {'start': 32, 'end': 40, 'speaker': 'b'},
             {'start': 40, 'end': 70, 'speaker': 'a'}])
        self.assertEqual([(s['start'], s['end'], s['speaker']) for s in result['segments']],
            [(0, 30, 'Pembicara 1'), (30, 32, 'Pembicara 1'), (32, 40, 'Pembicara 2'), (40, 70, 'Pembicara 1')])
        self.assertTrue(all(size <= 30 * RATE for size, _ in calls))
        self.assertEqual(result['speaker_scope'], 'recording')
        self.assertEqual(result['model'], 'qwen3-asr-0.6b')

    def test_overlap_is_decoded_once_and_unknown_gaps_are_retained(self):
        result = transcribe_recording(np.ones(7 * RATE), 'English', lambda *_: 'speech', lambda _: True,
            [{'start': 1, 'end': 4, 'speaker': 'a'}, {'start': 3, 'end': 5, 'speaker': 'b'}])
        self.assertEqual([(s['start'], s['end'], s['speaker'], s['overlap']) for s in result['segments']],
            [(0, 1, 'Belum diketahui', False), (1, 3, 'Pembicara 1', False),
             (3, 4, 'Bertumpuk', True), (4, 5, 'Pembicara 2', False), (5, 7, 'Belum diketahui', False)])
        self.assertEqual(sum(s['end']-s['start'] for s in result['segments']), 7)

    def test_invalid_turns_fail_before_asr(self):
        for turns in ([], [{'start': -1, 'end': 2, 'speaker': 'a'}],
                      [{'start': 0, 'end': float('nan'), 'speaker': 'a'}],
                      [{'start': 0, 'end': 3, 'speaker': 'a'}]):
            with self.subTest(turns=turns), self.assertRaises(ValueError):
                timeline(turns, 2)

    def test_silence_does_not_reach_qwen(self):
        result = transcribe_recording(np.zeros(RATE), 'English', lambda *_: self.fail('ASR called'), lambda _: False,
            [{'start': 0, 'end': 1, 'speaker': 'a'}])
        self.assertEqual(result['segments'], [])

    def test_nemotron_receives_one_complete_raw_pcm_request(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def read(self, _): return b'{"turns":[{"start":0,"end":65,"speaker":"a"}]}'
        audio = np.ones(65 * RATE) * .5
        with patch.dict('os.environ', {'QWEN_BATCH_NEMOTRON_URL': 'http://127.0.0.1:8015', 'QWEN_BATCH_NEMOTRON_KEY': 'test-key'}), \
             patch('urllib.request.urlopen', return_value=Response()) as request:
            self.assertEqual(len(nemotron_turns(audio)), 1)
        self.assertEqual(request.call_count, 1)
        actual = request.call_args.args[0]
        self.assertEqual(len(actual.data), 65 * RATE * 2)
        self.assertEqual(actual.full_url, 'http://127.0.0.1:8015/v1/diarize')
        self.assertEqual(actual.get_header('Content-type'), 'application/octet-stream')


if __name__ == '__main__':
    unittest.main()
