"""Bounded, owner-scoped retention of native ASR and speaker state."""
import asyncio
from collections import deque
from dataclasses import dataclass, field
import time


@dataclass
class Slot:
    key: tuple
    session: object
    resumable: bool
    attached: bool = True
    expires: float = 0
    finals: deque = field(default_factory=lambda: deque(maxlen=128))

    def remember(self, frames):
        for frame in frames:
            self.finals.extend(frame.get('final', []))


class RetainedSessions:
    def __init__(self, limit=2, ttl=45, clock=time.monotonic):
        if isinstance(limit,bool) or not isinstance(limit,int) or not 1<=limit<=8:
            raise ValueError('Live transcription session limit must be an integer between 1 and 8')
        self.limit,self.ttl,self.clock=limit,ttl,clock
        self.slots={}
        self.completed={}
        self.lock=asyncio.Lock()

    @staticmethod
    def key(ticket):
        return (ticket['meetingId'],ticket['speakerId'],ticket.get('streamId',ticket['nonce']),ticket['language'],ticket.get('diarize',False))

    async def expire(self):
        async with self.lock:
            self.completed={key:value for key,value in self.completed.items() if value[0]>self.clock()}
            expired=[slot for slot in self.slots.values() if not slot.attached and slot.expires<=self.clock()]
            for slot in expired:
                self.slots.pop(slot.key)
                await slot.session.close()

    async def acquire(self, ticket, factory):
        await self.expire()
        key=self.key(ticket)
        async with self.lock:
            previous=self.slots.get(key)
            if previous:
                if previous.attached: raise ValueError('Microphone session already connected')
                previous.attached=True
                return previous,True
            if len(self.slots)>=self.limit: raise ValueError('Streaming capacity exceeded')
            slot=Slot(key,await factory(),bool(ticket.get('streamId')))
            self.completed.pop(key,None)
            self.slots[key]=slot
            return slot,False

    async def release(self, slot, retain):
        async with self.lock:
            if self.slots.get(slot.key) is not slot: return
            if retain and slot.resumable and not slot.session.closed:
                slot.attached=False;slot.expires=self.clock()+self.ttl
            else:
                self.slots.pop(slot.key)
                await slot.session.close()

    async def close(self):
        async with self.lock:
            for slot in self.slots.values(): await slot.session.close()
            self.slots.clear()
            self.completed.clear()

    async def end(self,ticket):
        async with self.lock:
            key=self.key(ticket)
            completed=self.completed.get(key)
            if completed and completed[0]>self.clock(): return completed[1]
            self.completed.pop(key,None)
            slot=self.slots.get(key)
            if not slot: return []
            if slot.attached: raise ValueError('Microphone still connected')
            self.slots.pop(slot.key)
            try:
                # Replay immutable IDs before the final tail; API saves are idempotent.
                history=[dict(type='transcript',interim='',final=list(slot.finals))] if slot.finals else []
                frames=history + await slot.session.finish()
                # Keep only immutable text for retries; release the model/speaker state.
                while len(self.completed)>=self.limit*2:
                    self.completed.pop(next(iter(self.completed)))
                self.completed[key]=(self.clock()+self.ttl,frames)
                return frames
            finally: await slot.session.close()

    @property
    def active(self): return sum(slot.attached for slot in self.slots.values())
