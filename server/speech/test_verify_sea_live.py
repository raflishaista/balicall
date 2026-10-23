import copy
import tempfile
import unittest
import wave
from pathlib import Path
from verify_sea_live import read_pcm_fixture,assert_saved_final
import verify_sea_live as verifier


class VerificationTests(unittest.TestCase):
    def test_acoustic_verifier_checks_labels_and_does_not_accept_personal_fallback(self):
        final=dict(segmentId='session-1',sessionId='session',sourceId='owner',text='Halo.',start=0,end=1,
            attribution='assigned',speakerLabel='Pembicara 1',sessionProof='proof')
        entry=dict(id='entry',requestId='session-1',speakerId='owner',speakerName='owner',sttModel='sea-asr-id-live',text='Halo.',
            segments=[dict(text='Halo.',sourceId='owner',sessionId='session',speaker='Pembicara 1',attribution='assigned',start=0,end=1)])
        assert_saved_final(final,entry,'owner',diarize=True)
        for changes in [dict(attribution='participant'),dict(speaker='Peserta'),dict(sessionProof='proof')]:
            altered=copy.deepcopy(entry);altered['segments'][0].update(changes)
            with self.assertRaises(AssertionError):assert_saved_final(final,altered,'owner',diarize=True)

    def test_fixture_bytes_are_exact_mono_pcm16_and_reject_wrong_format(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'clip.wav'
            for channels,rate,width,valid in [(1,16000,2,True),(2,16000,2,False),(1,8000,2,False),(1,16000,1,False)]:
                with wave.open(str(path),'wb') as handle:
                    handle.setnchannels(channels);handle.setframerate(rate);handle.setsampwidth(width)
                    handle.writeframes(b'\x01\x00'*(channels*160))
                if valid:self.assertEqual(read_pcm_fixture(path),b'\x01\x00'*160)
                else:
                    with self.assertRaises(ValueError):read_pcm_fixture(path)

    def test_persistence_check_rejects_wrong_owner_model_text_and_metadata(self):
        final=dict(segmentId='session-1',sessionId='session',sourceId='owner',text='Halo.',start=0,end=1)
        entry=dict(id='entry',requestId='session-1',speakerId='owner',speakerName='owner',sttModel='sea-asr-id-live',text='Halo.',
            segments=[dict(text='Halo.',sourceId='owner',sessionId='session',speaker='Peserta',attribution='participant',start=0,end=1)])
        assert_saved_final(final,entry,'owner')
        for changes in [dict(speakerId='other'),dict(speakerName='Other'),dict(requestId='other'),dict(sttModel='small'),dict(text='Different'),dict(segments=[]),dict(id='')]:
            with self.assertRaises(AssertionError):assert_saved_final(final,{**entry,**changes},'owner')
        for changes in [dict(sourceId='other'),dict(sessionId='other'),dict(text='Different'),dict(attribution='unknown'),dict(end=2)]:
            altered=copy.deepcopy(entry);altered['segments'][0].update(changes)
            with self.assertRaises(AssertionError):assert_saved_final(final,altered,'owner')

    def test_history_readback_checks_exact_ids_and_every_persisted_segment(self):
        final=dict(segmentId='session-1',sessionId='session',sourceId='owner',text='Halo.',start=0,end=1)
        entry=dict(id='entry',requestId='session-1',speakerId='owner',speakerName='owner',sttModel='sea-asr-id-live',text='Halo.',
            segments=[dict(text='Halo.',sourceId='owner',sessionId='session',speaker='Peserta',attribution='participant',start=0,end=1)])
        expected={'entry':final}
        verifier.assert_saved_history(expected,[entry],'owner')
        for entries in [[],[entry,entry],[{**entry,'id':'other'}],[{**entry,'text':'Corrupted'}],[{**entry,'speakerName':'Other'}]]:
            with self.assertRaises(AssertionError):verifier.assert_saved_history(expected,entries,'owner')
        corrupted=copy.deepcopy(entry);corrupted['segments'][0]['sessionId']='wrong-session'
        with self.assertRaises(AssertionError):verifier.assert_saved_history(expected,[corrupted],'owner')


if __name__=='__main__':unittest.main()
