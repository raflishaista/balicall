import unittest
from retained_sessions import RetainedSessions


class FakeSession:
    def __init__(self): self.closed=False
    async def close(self): self.closed=True


class RetentionTests(unittest.IsolatedAsyncioTestCase):
    async def test_resume_keeps_session_only_for_matching_owner_stream_and_mode(self):
        now=[10]
        pool=RetainedSessions(clock=lambda:now[0])
        async def create(): return FakeSession()
        ticket=dict(meetingId='m',speakerId='a',streamId='mic-a',language='id',diarize=True,nonce='n')
        slot,resumed=await pool.acquire(ticket,create)
        self.assertFalse(resumed)
        with self.assertRaises(ValueError): await pool.acquire(ticket,create)
        await pool.release(slot,True)
        again,resumed=await pool.acquire({**ticket,'nonce':'new-ticket'},create)
        self.assertIs(again.session,slot.session); self.assertTrue(resumed)
        await pool.release(again,True)
        other,_=await pool.acquire({**ticket,'speakerId':'b'},create)
        self.assertIsNot(other.session,slot.session)
        with self.assertRaises(ValueError):
            await pool.acquire({**ticket,'speakerId':'c'},create)
        await pool.release(other,False)
        different,_=await pool.acquire({**ticket,'language':'en'},create)
        self.assertIsNot(different.session,slot.session)
        await pool.close()

    async def test_idle_expiry_and_final_close_release_capacity_and_memory(self):
        now=[10];pool=RetainedSessions(clock=lambda:now[0])
        async def create(): return FakeSession()
        ticket=dict(meetingId='m',speakerId='a',streamId='mic',language='id',diarize=True,nonce='n')
        slot,_=await pool.acquire(ticket,create)
        await pool.release(slot,True)
        now[0]+=46;await pool.expire()
        self.assertTrue(slot.session.closed)
        new,resumed=await pool.acquire(ticket,create)
        self.assertFalse(resumed)
        await pool.release(new,False)
        self.assertTrue(new.session.closed);self.assertEqual(len(pool.slots),0)

    async def test_legacy_tickets_are_never_retained_and_replay_journal_is_bounded(self):
        pool=RetainedSessions()
        async def create(): return FakeSession()
        ticket=dict(meetingId='m',speakerId='a',language='id',diarize=False,nonce='n')
        slot,_=await pool.acquire(ticket,create)
        for n in range(200): slot.remember([dict(type='transcript',final=[dict(segmentId=str(n))])])
        self.assertEqual(len(slot.finals),128)
        await pool.release(slot,True)
        self.assertTrue(slot.session.closed)
        self.assertEqual(len(pool.slots),0)




class JournalEndTests(unittest.IsolatedAsyncioTestCase):
    async def test_signed_end_replays_unacknowledged_finals_before_new_tail(self):
        class Tail(FakeSession):
            async def finish(self): return [dict(type='transcript',interim='',final=[dict(segmentId='tail-2',text='Ucapan terakhir')])]
        pool=RetainedSessions()
        async def create(): return Tail()
        ticket=dict(meetingId='m',speakerId='a',streamId='mic',language='id',diarize=False,nonce='n')
        slot,_=await pool.acquire(ticket,create)
        saved=dict(segmentId='tail-1',text='Ucapan sebelum koneksi putus')
        slot.remember([dict(type='transcript',final=[saved])])
        await pool.release(slot,True)
        frames=await pool.end(ticket)
        finals=[item for frame in frames for item in frame.get('final',[])]
        self.assertEqual([item['segmentId'] for item in finals],['tail-1','tail-2'])
        self.assertEqual(finals[0],saved)
        self.assertTrue(slot.session.closed)
        self.assertEqual(await pool.end(ticket),frames)




class CompletedJournalTests(unittest.IsolatedAsyncioTestCase):
    async def test_end_retry_replays_identical_ids_without_retaining_model_capacity(self):
        now=[10]
        class Tail(FakeSession):
            calls=0
            async def finish(self):
                self.calls+=1
                return [dict(type='transcript',final=[dict(segmentId='final-1',text='Final sesudah reconnect')])]
        pool=RetainedSessions(clock=lambda:now[0])
        async def create(): return Tail()
        ticket=dict(meetingId='m',speakerId='a',streamId='mic',language='id',nonce='n')
        slot,_=await pool.acquire(ticket,create)
        await pool.release(slot,True)
        first=await pool.end(ticket)
        second=await pool.end({**ticket,'nonce':'retry'})
        self.assertEqual(second,first)
        self.assertEqual(slot.session.calls,1)
        self.assertEqual(len(pool.slots),0)
        self.assertEqual(await pool.end({**ticket,'speakerId':'other'}),[])
        now[0]+=46;await pool.expire()
        self.assertEqual(await pool.end(ticket),[])


if __name__=='__main__': unittest.main()
