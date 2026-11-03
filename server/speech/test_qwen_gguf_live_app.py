import unittest
import numpy as np
from unittest.mock import patch
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from qwen_live_app import create_app
from test_qwen_live_session import Engine, packet
from test_stream_tickets import ticket, SECRET
from qwen_gguf_live_app import create_gguf_app
from qwen_gguf_engine import QwenGgufEngine
from test_qwen_gguf_diarized_session import FakeDiarizer

MODEL='qwen3-asr-0.6b-gguf-q8-live'


class AppTests(unittest.TestCase):
    def test_q8_signed_session_delivers_diarized_finals(self):
        async def diarizer(): return FakeDiarizer()
        engine=QwenGgufEngine(transcribe=lambda audio,language:'teks uji',speech=lambda audio:bool(np.any(audio)))
        app=create_gguf_app(engine=engine,secret=SECRET,diarizer_factory=diarizer,model_check=lambda:True,diarization_check=lambda:True)
        with TestClient(app) as client, patch('stream_tickets.time.time',return_value=100):
            self.assertTrue(client.get('/health').json()['diarization'])
            proof=ticket(model=MODEL,diarize=True,nonce='gguf-turns')
            with client.websocket_connect('/asr?ticket='+proof) as socket:
                self.assertTrue(socket.receive_json()['diarization'])
                socket.send_bytes(packet()); first=socket.receive_json()['final']
                socket.send_bytes(packet()); second=socket.receive_json()['final']
                socket.send_bytes(b''); final=socket.receive_json()['final']
                self.assertEqual(socket.receive_json()['type'],'ready_to_stop')
            self.assertEqual([s['attribution'] for s in first+second+final],['assigned','overlap'])
            self.assertEqual([s['segmentId'] for s in first+second+final],['gguf-turns-1','gguf-turns-2'])
            self.assertTrue(all(s['sessionProof']==proof for s in first+second+final))

    def test_reconnect_reuses_original_speaker_session_proof(self):
        class PersistentDiarizer:
            def __init__(self): self.samples=0
            async def feed(self,data,finish=False):
                start=self.samples;self.samples+=len(data)//2
                if not data or not any(data): return []
                return [{'startSample':start,'endSample':self.samples,'speakerLabel':'Pembicara 1','attribution':'assigned'}]
            async def close(self): pass
        async def diarizer(): return PersistentDiarizer()
        engine=QwenGgufEngine(transcribe=lambda audio,language:'teks uji',speech=lambda audio:bool(np.any(audio)))
        app=create_gguf_app(engine=engine,secret=SECRET,diarizer_factory=diarizer,model_check=lambda:True,diarization_check=lambda:True)
        args=dict(model=MODEL,diarize=True,streamId='microphone-session-123')
        original=ticket(**args,nonce='gguf-original')
        with TestClient(app) as client, patch('stream_tickets.time.time',return_value=100):
            with client.websocket_connect('/asr?ticket='+original) as socket:
                config=socket.receive_json();socket.send_bytes(packet()); first=socket.receive_json()['final']
                socket.send_json({'type':'pause'})
                while socket.receive_json()['type']!='ready_to_stop':pass
            with client.websocket_connect('/asr?ticket='+ticket(**args,nonce='gguf-reconnect')) as socket:
                resumed=socket.receive_json();self.assertTrue(resumed['resumed']);self.assertEqual(resumed['sessionId'],config['sessionId'])
                replay=socket.receive_json()['final'];self.assertEqual(replay,first)
                socket.send_bytes(packet());second=socket.receive_json()['final']
                self.assertEqual(second[0]['sessionProof'],original)
                socket.send_bytes(b'');socket.receive_json();socket.receive_json()

    def test_q8_readiness_fails_closed_for_worker_and_diarizer(self):
        app=create_gguf_app(engine=Engine(),secret=SECRET,model_check=lambda:False,diarization_check=lambda:False)
        with TestClient(app) as client:
            health=client.get('/health').json()
            self.assertFalse(health['ready'])
            self.assertFalse(health['diarization'])
            self.assertEqual(health['model'],MODEL)
            with patch('stream_tickets.time.time',return_value=100), self.assertRaises(WebSocketDisconnect):
                with client.websocket_connect('/asr?ticket='+ticket(model=MODEL,diarize=True)): pass

    def test_q8_session_has_separate_ticket_model_and_reports_non_native(self):
        app=create_app(Engine(),SECRET,model_id=MODEL,native_streaming=False)
        with TestClient(app) as client, patch('stream_tickets.time.time',return_value=100):
            health=client.get('/health').json()
            self.assertEqual(health['model'],MODEL)
            self.assertFalse(health['native'])
            with self.assertRaises(WebSocketDisconnect):
                with client.websocket_connect('/asr?ticket='+ticket(diarize=False)): pass
            with client.websocket_connect('/asr?ticket='+ticket(model=MODEL,diarize=False,nonce='gguf-session')) as socket:
                self.assertEqual(socket.receive_json()['model'],MODEL)
                socket.send_bytes(packet());self.assertEqual(socket.receive_json()['type'],'transcript')
                socket.send_bytes(b'');self.assertTrue(socket.receive_json()['final'])
                self.assertEqual(socket.receive_json()['type'],'ready_to_stop')


if __name__=='__main__': unittest.main()
