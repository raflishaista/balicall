import base64
import hashlib
import hmac
import json
import unittest
from stream_tickets import TicketVerifier
from qwen_live_protocol import decode_pcm, final_segment

SECRET = 'a' * 40

def ticket(**changes):
    data = dict(model='qwen3-asr-0.6b-live', language='id', meetingId='meeting', speakerId='owner', exp=130, nonce='session-1', diarize=True)
    data.update(changes)
    payload = base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip('=')
    sig = base64.urlsafe_b64encode(hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).digest()).decode().rstrip('=')
    return payload + '.' + sig

class TicketTests(unittest.TestCase):
    def test_verified_session_is_single_use(self):
        verifier = TicketVerifier(SECRET, 'qwen3-asr-0.6b-live')
        self.assertEqual(verifier.verify(ticket(), 100)['speakerId'], 'owner')
        with self.assertRaises(ValueError): verifier.verify(ticket(), 100)

    def test_model_expiry_signature_and_identity_are_checked(self):
        for changes in [dict(model='small'),dict(exp=99),dict(exp=200),dict(language='xx'),dict(speakerId=''),dict(exp=True),dict(diarize='true'),dict(streamId='short'),dict(streamId='x'*101),dict(streamId='bad value'+'.'*16)]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                TicketVerifier(SECRET,'qwen3-asr-0.6b-live').verify(ticket(**changes),100)
        with self.assertRaises(ValueError): TicketVerifier('b'*40,'qwen3-asr-0.6b-live').verify(ticket(),100)

    def test_cache_is_bounded_and_expired_entries_are_removed(self):
        verifier = TicketVerifier(SECRET,'qwen3-asr-0.6b-live',limit=1)
        verifier.verify(ticket(),100)
        with self.assertRaises(ValueError): verifier.verify(ticket(nonce='session-2'),100)
        verifier.verify(ticket(nonce='session-2',exp=160),131)
        self.assertEqual(len(verifier.used),1)

    def test_pcm_limits_and_mono_conversion(self):
        self.assertEqual(decode_pcm(b'\x00\x40').tolist(),[0.5])
        for data in [b'a',bytes(64002)]:
            with self.assertRaises(ValueError): decode_pcm(data)

    def test_final_validates_offsets_and_namespaces(self):
        result=final_segment('session',1,'owner','hello',16000,32000,'Pembicara 1','assigned')
        self.assertEqual((result['start'],result['end'],result['sourceId']),(1,2,'owner'))
        self.assertEqual(result['segmentId'],'session-1')
        with self.assertRaises(ValueError): final_segment('s',1,'o','hello',2,1,'x','assigned')

if __name__ == '__main__': unittest.main()
