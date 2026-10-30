import os
import sys
import types
import threading
import unittest
from unittest.mock import patch
from qwen_live_engine import QwenEngine

class EngineConfigTests(unittest.TestCase):
    def test_shutdown_releases_the_spawned_engine_core_once(self):
        called=[]
        engine=object.__new__(QwenEngine);engine.lock=threading.Lock()
        engine.model=types.SimpleNamespace(model=types.SimpleNamespace(llm_engine=types.SimpleNamespace(engine_core=types.SimpleNamespace(shutdown=lambda:called.append(True)))))
        engine.close();engine.close()
        self.assertEqual(called,[True])

    def test_profiles_small_live_batches_instead_of_twenty_full_audio_items(self):
        calls=[]
        fake=types.SimpleNamespace(Qwen3ASRModel=types.SimpleNamespace(LLM=lambda **kwargs:calls.append(kwargs)))
        with patch.dict(sys.modules,{'qwen_asr':fake}),patch.dict(os.environ,{'QWEN_MODEL_PATH':'local-model'}):
            QwenEngine()
        self.assertLessEqual(calls[0].get('max_num_batched_tokens',8192),1024)
        self.assertEqual(calls[0]['gpu_memory_utilization'],0.25)

if __name__=='__main__': unittest.main()
