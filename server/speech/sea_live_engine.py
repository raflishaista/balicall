"""CPU-only SEA runtime. Loading this module never initializes a GPU."""
import os
import threading
import numpy as np


class SeaEngine:
    def __init__(self):
        import torch
        from sea_asr import SeaASR
        torch.set_num_threads(int(os.getenv('SEA_CPU_THREADS','4')))
        self.lock=threading.Lock()
        # Deployment supplies the pinned local snapshot, with HF offline mode enabled.
        self.model=SeaASR.from_pretrained(os.environ['SEA_MODEL_PATH'],device='cpu')
        self.model.transcribe(np.zeros(16000,dtype=np.float32),return_words=True)

    def new_detector(self):
        import webrtcvad
        vad=webrtcvad.Vad(2)
        pending=b''
        def speech(audio):
            nonlocal pending
            if not len(audio): return False
            pcm=(np.clip(audio,-1,1)*32767).astype('<i2').tobytes()
            pending+=pcm
            complete=len(pending)//960*960
            # Evaluate every frame: short-circuiting would skip VAD state updates.
            decisions=[vad.is_speech(pending[offset:offset+960],16000)
                for offset in range(0,complete,960)]
            pending=pending[complete:]
            return any(decisions)
        return speech

    def transcribe(self,audio):
        with self.lock:
            return self.model.transcribe(audio,return_words=True)

    def close(self): self.model=None
