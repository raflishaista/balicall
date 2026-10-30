"""SEA ASR windows plus delayed, session-scoped Nemotron word attribution."""
from contextlib import suppress
from qwen_live_protocol import RATE,decode_pcm,final_segment,transcript_frame
from sea_live_session import SeaLiveSession
from sea_diarization import WordAttributor

MAX_LABEL_WAIT=35*RATE


class SeaDiarizedSession(SeaLiveSession):
    def __init__(self,engine,ticket,diarizer,session_proof):
        super().__init__(engine,ticket)
        self.diarizer=diarizer
        self.session_proof=session_proof
        self.attributor=WordAttributor()
        self.pending=[]
        self.degraded=False
        self.warnings=[]
        self.interim=''
        self.stall_warned=False

    def _final_words(self,words):
        self.pending.extend(words)
        return []

    async def _speaker_turns(self,packet,finish=False):
        if not self.diarizer:return
        try:
            turns=await self.diarizer.feed(packet,finish=finish)
            self.attributor.add_turns(turns,self.total+len(packet)//2)
        except (ConnectionError,TimeoutError,OSError,ValueError,TypeError,KeyError):
            with suppress(Exception):await self.diarizer.close()
            self.diarizer=None;self.degraded=True
            self.warnings.append(dict(type='warning',error='Diarization SEA terputus; teks tetap disimpan dengan label pembicara belum diketahui.'))

    def _drain(self,force=False):
        selected=[];count=0
        overflow=max(0,len(self.pending)-1000)
        for text,start,end in self.pending:
            stale=self.total-start>=MAX_LABEL_WAIT or count<overflow
            if not (force or not self.diarizer or stale or end<=self.attributor.watermark):break
            if stale and not self.stall_warned:
                self.stall_warned=True
                self.warnings.append(dict(type='warning',error='Label pembicara SEA terlambat; bagian yang belum pasti ditandai belum diketahui.'))
            label,attribution=self.attributor.label(start,end)
            selected.append((text,start,end,label,attribution));count+=1
        self.pending=self.pending[count:]
        groups=[]
        for text,start,end,label,attribution in selected:
            if (groups and groups[-1][3:]==[label,attribution] and end-groups[-1][1]<=60*RATE
                    and len(groups[-1][0])+len(text)+1<=8800):
                groups[-1][0]+=' '+text;groups[-1][2]=end
            else:groups.append([text,start,end,label,attribution])
        result=[]
        for text,start,end,label,attribution in groups:
            self.counter+=1
            final=final_segment(self.ticket['nonce'],self.counter,self.ticket['speakerId'],text,start,end,label,attribution)
            final['sessionProof']=self.session_proof
            result.append(final)
        # Older turns cannot label future words once their audio has been trimmed.
        # committed may remain zero through hours of silence, so include base.
        floor=max(self.base,self.committed)
        if self.pending:floor=min(floor,self.pending[0][1])
        self.attributor.prune(floor)
        return result

    def _render(self,frames,force=False):
        if frames:self.interim=frames[-1].get('interim','')
        result=self._drain(force)
        warnings=self.warnings;self.warnings=[]
        prefix=' '.join(word[0] for word in self.pending)
        interim=' '.join(part for part in (prefix,self.interim) if part)
        return warnings+([transcript_frame(interim,result)] if frames or result or self.pending or warnings else [])

    async def feed(self,packet):
        if self.closed:raise ValueError('Session closed')
        decode_pcm(packet)
        await self._speaker_turns(packet)
        return self._render(await super().feed(packet))

    async def pause(self):
        if self.closed or not (self.voiced or self.pending):return []
        # Same generated silence reaches both timelines; the speaker cache stays open.
        frames=await self.feed(bytes(2*RATE*2))
        return frames+self._render(await super().pause(),force=True)

    async def finish(self):
        if self.closed:return []
        await self._speaker_turns(b'',finish=True)
        result=self._render(await super().pause(),force=True)
        self.closed=True
        if self.diarizer:
            with suppress(Exception):await self.diarizer.close()
        return result

    async def close(self):
        if self.diarizer:
            with suppress(Exception):await self.diarizer.close()
        self.pending=[];self.attributor.turns=[]
        await super().close()
