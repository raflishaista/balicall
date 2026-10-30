"""One native vLLM model; independent mutable ASR state per stream."""
import os
import threading
import numpy as np

LANGUAGES={'id':'Indonesian','en':'English'}


class QwenEngine:
    def __init__(self):
        from qwen_asr import Qwen3ASRModel
        self.lock=threading.Lock()
        self.model=Qwen3ASRModel.LLM(
            model=os.environ['QWEN_MODEL_PATH'],max_inference_batch_size=1,max_new_tokens=256,
            gpu_memory_utilization=float(os.getenv('QWEN_GPU_MEMORY_UTILIZATION','0.25')),
            max_model_len=4096,max_num_seqs=2,max_num_batched_tokens=1024,
            limit_mm_per_prompt={'audio':1},dtype='float16',enforce_eager=True,
            enable_prefix_caching=False,disable_log_stats=True)

    def create_state(self,language):
        return self.model.init_streaming_state(language=LANGUAGES[language],chunk_size_sec=2.0)

    def close(self):
        with self.lock:
            if self.model is not None:
                self.model.model.llm_engine.engine_core.shutdown()
                self.model=None

    def feed(self,audio,state):
        with self.lock:
            self.model.streaming_transcribe(audio,state)
            return state.text

    def finish(self,state):
        with self.lock:
            self.model.finish_streaming_transcribe(state)
            return state.text

    def transcribe_turn(self,audio,language):
        with self.lock:
            return self.model.transcribe(audio=(audio,16000),language=LANGUAGES[language],return_time_stamps=False)[0].text

    def speech(self,audio):
        from faster_whisper.vad import get_speech_timestamps,VadOptions
        return bool(len(audio) and get_speech_timestamps(audio,VadOptions(min_speech_duration_ms=120,min_silence_duration_ms=300)))
