"""Windowed SEA inference; interim hypotheses are replaceable, finals immutable."""
import asyncio
import numpy as np
from qwen_live_protocol import RATE, decode_pcm, final_segment, transcript_frame

MODEL='sea-asr-id-live'
ROLLING_OVERLAP=int(.75*RATE)


class SeaLiveSession:
    def __init__(self,engine,ticket):
        self.engine,self.ticket=engine,ticket
        self.speech=engine.new_detector() if hasattr(engine,'new_detector') else engine.speech
        self.audio=np.empty(0,dtype=np.float32)
        self.total=self.base=self.last_voice=self.last_decode=self.committed=self.counter=0
        self.voiced=False
        self.closed=False

    async def feed(self,packet):
        if self.closed: raise ValueError('Session closed')
        samples=decode_pcm(packet)
        frames=[]
        # Fixed 100 ms processing slices make endpointing independent of packet size.
        for offset in range(0,len(samples),1600):
            part=samples[offset:offset+1600]
            self.audio=np.concatenate((self.audio,part))
            self.total+=len(part)
            if self.speech(part):
                self.voiced=True
                self.last_voice=self.total
            if not self.voiced:
                self._trim(max(self.base,self.total-3200))
                continue
            if self.total-self.last_voice>=12800:
                frames+=await self._decode(final=True)
            elif len(self.audio)>=12*RATE:
                frames+=await self._decode(final=True,rolling=True)
            elif len(self.audio)>=RATE and self.total-self.last_decode>=RATE:
                frames+=await self._decode()
        return frames

    def _trim(self,sample):
        sample=min(self.total,max(self.base,sample))
        self.audio=self.audio[sample-self.base:].copy()
        self.base=sample

    def _final_words(self,words):
        self.counter+=1
        return [final_segment(self.ticket['nonce'],self.counter,self.ticket['speakerId'],
            ' '.join(word[0] for word in words),max(self.committed,words[0][1]),words[-1][2],'Peserta','unknown')]

    async def _decode(self,final=False,rolling=False):
        if not self.voiced: return []
        result=await asyncio.to_thread(self.engine.transcribe,self.audio.copy())
        self.last_decode=self.total
        words=result.get('words',[])
        if not isinstance(words,list): raise ValueError('SEA word timestamps missing')
        selected=[]
        boundary=self.total-RATE if rolling else self.total
        for word in words:
            start=self.base+round(float(word['start'])*RATE)
            end=self.base+round(float(word['end'])*RATE)
            if not self.base<=start<end<=self.total+160: raise ValueError('Invalid SEA word timestamp')
            if start<self.committed or (rolling and end>boundary): continue
            text=str(word['word']).strip()
            if text: selected.append((text,start,min(end,self.total)))
        text=' '.join(w[0] for w in selected).strip()
        if not final: return [transcript_frame(text)]
        if rolling and not selected:
            # A timestamp-less hypothesis must never make the buffer unbounded.
            raise ValueError('SEA cannot finalize the bounded audio window')
        finals=[]
        if text:
            end=selected[-1][2]
            finals=self._final_words(selected)
            self.committed=end
        if rolling:
            self._trim(max(self.base,self.committed-ROLLING_OVERLAP))
        else:
            self._trim(self.total)
            self.voiced=False
        return [transcript_frame(final=finals)]

    async def pause(self):
        if self.closed: return []
        return await self._decode(final=True)

    async def finish(self):
        if self.closed: return []
        frames=await self.pause()
        self.closed=True
        return frames

    async def close(self):
        self.closed=True
        self.audio=np.empty(0,dtype=np.float32)
