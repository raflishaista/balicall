import unittest
from sea_diarization import WordAttributor


def turn(start,end,label='Pembicara 1',attribution='assigned'):
    return dict(startSample=start,endSample=end,speakerLabel=label,attribution=attribution)


class AlignmentTests(unittest.TestCase):
    def test_closed_turns_assign_words_but_cross_speaker_words_stay_unknown(self):
        align=WordAttributor()
        align.add_turns([turn(0,100),turn(100,200,'Pembicara 2')],200)
        self.assertEqual(align.label(10,90),('Pembicara 1','assigned'))
        self.assertEqual(align.label(110,190),('Pembicara 2','assigned'))
        self.assertEqual(align.label(90,110),('Pembicara belum diketahui','unknown'))
        self.assertEqual(align.label(200,220),('Pembicara belum diketahui','unknown'))
        self.assertEqual(align.watermark,200)

    def test_gaps_short_turns_and_overlap_never_become_a_person_label(self):
        align=WordAttributor()
        align.add_turns([turn(0,100),turn(120,150,'Pembicara belum diketahui','unknown'),
            turn(150,200,'Suara bertumpuk','overlap')],200)
        for bounds in [(80,120),(120,140)]:
            self.assertEqual(align.label(*bounds)[1],'unknown')
        self.assertEqual(align.label(140,170),('Suara bertumpuk','overlap'))

    def test_same_speaker_closed_chunks_cover_a_word_without_a_gap(self):
        align=WordAttributor()
        align.add_turns([turn(0,100),turn(100,200)],200)
        self.assertEqual(align.label(90,110),('Pembicara 1','assigned'))
        align.prune(150)
        self.assertEqual(len(align.turns),1)

    def test_invalid_overlapping_future_or_regressed_turns_are_rejected_atomically(self):
        for invalid in [turn(-1,10),turn(0,0),turn(0,201),turn(0,10,attribution='participant'),
                turn(0,10,label=''),turn(float('nan'),10),turn(True,10)]:
            align=WordAttributor()
            with self.assertRaises(ValueError):align.add_turns([turn(0,5),invalid],200)
            self.assertEqual(align.turns,[])
        align=WordAttributor();align.add_turns([turn(0,100)],200)
        with self.assertRaises(ValueError):align.add_turns([turn(90,150,'Pembicara 2')],200)
        self.assertEqual(align.watermark,100)
        # No duplicate/revised closed turns may silently change a committed label.
        with self.assertRaises(ValueError):align.add_turns([turn(0,100)],200)


if __name__=='__main__':unittest.main()
