import unittest
from live_protocol import TranscriptFrames

class LiveFramesTests(unittest.TestCase):
    def test_cumulative_revisions_silence_and_finish_do_not_duplicate(self):
        frames = TranscriptFrames()
        first = {'start': '0:00:00.00', 'speaker': 1, 'text': 'Halo'}
        self.assertEqual(frames.update({'lines': [first]})['final'], [])
        first = {**first, 'text': 'Halo semuanya.'}
        silence = {'start': '0:00:02.00', 'speaker': -2, 'text': ''}
        self.assertEqual(frames.update({'lines': [first, silence]})['final'], ['Halo semuanya.'])
        last = {'start': '0:00:03.00', 'speaker': 1, 'text': 'Mulai rapat.'}
        data = {'lines': [first, silence, last], 'buffer_transcription': ' sementara'}
        self.assertEqual(frames.update(data), {'type': 'transcript', 'final': [], 'interim': 'Mulai rapat. sementara'})
        self.assertEqual(frames.update(data, finish=True)['final'], ['Mulai rapat.'])
        self.assertEqual(frames.update(data, finish=True)['final'], [])

    def test_long_uninterrupted_speech_fits_meeting_api_limit(self):
        result = TranscriptFrames().update({'lines': [{'start': '0', 'speaker': 1, 'text': 'a' * 19000}]}, finish=True)
        self.assertEqual(''.join(result['final']), 'a' * 19000)
        self.assertTrue(all(len(text) <= 10000 for text in result['final']))

    def test_pause_commit_then_same_line_grows_saves_only_new_words(self):
        frames = TranscriptFrames()
        line = {'start': '0:00:00.00', 'speaker': 1, 'text': 'Halo.'}
        self.assertEqual(frames.update({'lines': [line]}, finish=True)['final'], ['Halo.'])
        line = {**line, 'text': 'Halo. Mulai rapat.'}
        self.assertEqual(frames.update({'lines': [line]})['interim'], 'Mulai rapat.')
        self.assertEqual(frames.update({'lines': [line]}, finish=True)['final'], ['Mulai rapat.'])

if __name__ == '__main__':
    unittest.main()
