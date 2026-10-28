"""Native Nemotron streaming geometry and session-local speaker cache."""
import threading
import numpy as np


class TurnCollector:
    def __init__(self, stable_frames=20, frame_samples=160):
        self.stable_frames,self.frame_samples=stable_frames,frame_samples
        self.position=0
        self.label=()
        self.start=0

    def _turn(self,end):
        if not self.label or end<=self.start: return []
        overlap=len(self.label)>1
        stable=end-self.start>=self.stable_frames
        return [dict(startSample=self.start*self.frame_samples,endSample=end*self.frame_samples,
            speakerLabel='Suara bertumpuk' if overlap else f'Pembicara {self.label[0]+1}' if stable else 'Pembicara belum diketahui',
            attribution='overlap' if overlap else 'assigned' if stable else 'unknown')]

    def feed(self,labels):
        result=[]
        for active in labels:
            active=tuple(active)
            if active!=self.label:
                # Preserve short runs as unknown rather than smoothing them into
                # a different speaker or dropping an interruption entirely.
                result+=self._turn(self.position)
                self.label,self.start=active,self.position
            self.position+=1
            # Bound long same-speaker turns without resetting speaker memory.
            if (self.position-self.start)*self.frame_samples>=30*16000 and self.label:
                result+=self._turn(self.position); self.start=self.position
        return result

    def finish(self):
        result=self._turn(self.position)
        self.label=(); self.start=self.position
        return result


class NemotronSession:
    def __init__(self,processor,forward):
        self.processor,self.forward=processor,forward
        self.cache=None
        self.buffer=np.zeros(0,dtype=np.float32)
        self.base=0; self.step=0; self.samples=0; self.closed=False
        self.turns=TurnCollector()

    def feed(self,audio,finish=False):
        if self.closed: raise ValueError('Diarization session already closed')
        self.buffer=np.concatenate((self.buffer,audio)); self.samples+=len(audio)
        result=[]
        while True:
            start=0 if self.step==0 else self.processor.audio_chunk_start(self.step*self.processor.num_mel_frames_per_step)
            count=self.processor.num_samples_first_audio_chunk if self.step==0 else self.processor.num_samples_per_audio_chunk
            available=self.samples-start
            last=finish and available<count
            if available<count and not last: break
            if available<=0: break
            clip=self.buffer[start-self.base:start-self.base+(available if last else count)]
            inputs=self.processor(clip,sampling_rate=16000,is_streaming=True,is_first_audio_chunk=self.step==0,is_last_audio_chunk=last,return_tensors='pt')
            labels,self.cache=self.forward(inputs,self.cache)
            result+=self.turns.feed(labels)
            self.step+=1
            next_start=self.processor.audio_chunk_start(self.step*self.processor.num_mel_frames_per_step)
            trim=max(0,min(next_start-self.base,len(self.buffer)))
            self.buffer=self.buffer[trim:].copy(); self.base+=trim
            if last: break
        if finish:
            result+=self.turns.finish(); self.closed=True
            self.buffer=np.zeros(0,dtype=np.float32)
        # Padded tail frames cannot create turns past actual captured audio.
        for turn in result: turn['endSample']=min(turn['endSample'],self.samples)
        return [turn for turn in result if turn['endSample']>turn['startSample']]


class NemotronEngine:
    def __init__(self,checkpoint,revision=None,device='cuda'):
        import torch
        from transformers import AutoModelForAudioFrameClassification, AutoProcessor
        self.torch=torch; self.lock=threading.Lock()
        self.processor=AutoProcessor.from_pretrained(checkpoint,revision=revision)
        self.processor.set_streaming_mode('low_latency')
        self.model=AutoModelForAudioFrameClassification.from_pretrained(checkpoint,revision=revision,dtype=torch.float32).to(device).eval()

    def create_session(self):
        def forward(inputs,cache):
            with self.lock,self.torch.inference_mode():
                inputs=inputs.to(self.model.device,dtype=self.model.dtype)
                outputs=self.model(**inputs,speaker_cache=cache)
                probabilities=outputs.logits[0].sigmoid().float().cpu().numpy()
                return [tuple(np.flatnonzero(frame>=0.5).tolist()) for frame in probabilities],outputs.speaker_cache
        return NemotronSession(self.processor,forward)
