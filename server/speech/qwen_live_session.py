"""Bounded live ASR, speaker turns, and exactly-once final delivery per session."""
import asyncio
import numpy as np
from qwen_live_protocol import RATE,decode_pcm,final_segment,transcript_frame


class QwenLiveSession:
    def __init__(self,engine,ticket,diarizer=None):
        self.engine,self.ticket,self.diarizer=engine,ticket,diarizer
        self.state=engine.create_state(ticket['language'])
        self.buffer=np.zeros(0,dtype=np.float32)
        self.base=0; self.total=0; self.counter=0; self.committed=0
        self.voice_end=0; self.has_voice=False; self.closed=False
        self.last_interim=''; self.degraded=False

    def _segment(self,text,start,end,speaker,attribution):
        if not text or not text.strip() or end<=start: return []
        self.counter+=1
        return [final_segment(self.ticket['nonce'],self.counter,self.ticket['speakerId'],text,start,end,speaker,attribution)]

    def _trim(self,end):
        self.buffer=self.buffer[end-self.base:].copy(); self.base=end
        self.committed=max(self.committed,end)

    async def _turn_finals(self,turns):
        finals=[]
        for turn in turns:
            start,end=turn['startSample'],min(turn['endSample'],self.total)
            if end<=self.committed: continue
            start=max(start,self.committed)
            if start<self.base or end<start: raise ValueError('Speaker turn references discarded audio')
            clip=self.buffer[start-self.base:end-self.base]
            if await asyncio.to_thread(self.engine.speech,clip):
                text=await asyncio.to_thread(self.engine.transcribe_turn,clip,self.ticket['language'])
                finals+=self._segment(text,start,end,turn['speakerLabel'],turn['attribution'])
            self._trim(end)
        if finals:
            self.state=self.engine.create_state(self.ticket['language'])
            self.last_interim=''
            self.has_voice=bool(len(self.buffer) and await asyncio.to_thread(self.engine.speech,self.buffer))
            if len(self.buffer): self.last_interim=await asyncio.to_thread(self.engine.feed,self.buffer,self.state)
        return finals

    async def _personal_final(self):
        text=await asyncio.to_thread(self.engine.finish,self.state)
        speaker='Pembicara belum diketahui' if self.ticket.get('diarize') else 'Peserta'
        finals=self._segment(text,self.base,self.total,speaker,'unknown') if self.has_voice else []
        self._trim(self.total)
        self.state=self.engine.create_state(self.ticket['language'])
        self.has_voice=False; self.last_interim=''
        return finals

    async def feed(self,packet):
        if self.closed: raise ValueError('Stream already finished')
        audio=decode_pcm(packet)
        if not len(audio): return await self.finish()
        self.buffer=np.concatenate((self.buffer,audio)); self.total+=len(audio)
        if len(self.buffer)>60*RATE: raise ValueError('Transkripsi tertinggal lebih dari batas buffer. Hentikan dan coba lagi.')
        was_voice=self.has_voice
        voice=await asyncio.to_thread(self.engine.speech,self.buffer[-RATE:])
        if voice: self.has_voice=True; self.voice_end=self.total
        if self.has_voice:
            self.last_interim=await asyncio.to_thread(self.engine.feed,audio if was_voice else self.buffer,self.state)
        frames=[]; finals=[]
        if self.diarizer:
            try:
                turns=await self.diarizer.feed(packet)
                finals=await self._turn_finals(turns)
            except (ConnectionError,TimeoutError,OSError) as error:
                await self.diarizer.close(); self.diarizer=None; self.degraded=True
                frames.append(dict(type='warning',error='Diarization terputus; transkrip berikutnya memakai label pembicara belum diketahui.'))
        if self.diarizer and not self.has_voice and len(self.buffer)>2*RATE:
            self._trim(self.total-2*RATE)
        if not self.diarizer:
            if self.has_voice and (self.total-self.voice_end>=int(0.8*RATE) or len(self.buffer)>=30*RATE):
                finals+=await self._personal_final()
            elif not self.has_voice:
                self._trim(self.total)
        frames.append(transcript_frame(self.last_interim,finals))
        return frames

    async def finish(self):
        if self.closed: return []
        self.closed=True
        finals=[]
        if self.diarizer:
            turns=await self.diarizer.feed(b'',finish=True)
            finals+=await self._turn_finals(turns)
            # Silence or unstable residual turns must not silently lose speech.
            if len(self.buffer) and await asyncio.to_thread(self.engine.speech,self.buffer):
                text=await asyncio.to_thread(self.engine.transcribe_turn,self.buffer,self.ticket['language'])
                finals+=self._segment(text,self.base,self.total,'Pembicara belum diketahui','unknown')
            self._trim(self.total)
        else:
            finals+=await self._personal_final()
        return [transcript_frame('',finals)]

    async def close(self):
        self.closed=True
        if self.diarizer: await self.diarizer.close()
        self.buffer=np.zeros(0,dtype=np.float32)
