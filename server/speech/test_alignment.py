import unittest
from alignment import align_words


class AlignmentTests(unittest.TestCase):
    def test_speaker_change_and_uncovered_word(self):
        words = [(0, 1, " Halo"), (1, 2, " semua"), (2, 3, " Ya"), (4, 5, " hmm")]
        turns = [(0, 2, "SPEAKER_00"), (2, 3, "SPEAKER_01")]
        self.assertEqual(align_words(words, turns), [
            dict(start=0, end=2, text="Halo semua", speaker="SPEAKER_00"),
            dict(start=2, end=3, text="Ya", speaker="SPEAKER_01"),
            dict(start=4, end=5, text="hmm", speaker="UNKNOWN"),
        ])

    def test_greatest_overlap_and_silence(self):
        self.assertEqual(align_words([], []), [])
        self.assertEqual(align_words([(1, 3, " test")], [(0, 1.5, "A"), (1.5, 4, "B")])[0]["speaker"], "B")


if __name__ == "__main__":
    unittest.main()
