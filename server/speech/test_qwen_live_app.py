import unittest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from qwen_live_app import create_app
from test_qwen_live_session import Engine,packet
from test_stream_tickets import ticket,SECRET

class AppTests(unittest.TestCase):
    def test_signed_end_releases_idle_capacity_without_closing_another_owner(self):
        from unittest.mock import patch
        app=create_app(Engine(),SECRET)
        common=dict(diarize=False,streamId='microphone-session-123')
        with TestClient(app) as client,patch('stream_tickets.time.time',return_value=100):
            with client.websocket_connect('/asr?ticket='+ticket(**common)) as socket:
                socket.receive_json();socket.send_json({'type':'pause'})
                while socket.receive_json()['type']!='ready_to_stop':pass
            with client.websocket_connect('/asr?end=1&ticket='+ticket(**common,nonce='other-end',speakerId='other')) as socket:
                self.assertEqual(socket.receive_json()['type'],'ready_to_stop')
            self.assertEqual(len(app.state.sessions.slots),1)
            with client.websocket_connect('/asr?end=1&ticket='+ticket(**common,nonce='own-end')) as socket:
                while socket.receive_json()['type']!='ready_to_stop':pass
            self.assertEqual(len(app.state.sessions.slots),0)

    def test_disconnect_drains_pcm_already_accepted_into_the_queue(self):
        import threading
        import qwen_live_app
        from unittest.mock import patch
        accepted=threading.Event();release=threading.Event();count=[0]
        decode=qwen_live_app.decode_pcm
        def counted(packet):
            count[0]+=1
            if count[0]==3:accepted.set()
            return decode(packet)
        class Slow(Engine):
            def feed(self,audio,state):
                release.wait(3)
                return super().feed(audio,state)
        app=create_app(Slow(),SECRET)
        common=dict(diarize=False,streamId='microphone-session-123')
        with TestClient(app) as client,patch('stream_tickets.time.time',return_value=100),patch('qwen_live_app.decode_pcm',side_effect=counted):
            with client.websocket_connect('/asr?ticket='+ticket(**common)) as socket:
                socket.receive_json()
                for _ in range(3):socket.send_bytes(packet())
                self.assertTrue(accepted.wait(2),'receiver must accept all PCM before simulated disconnect')
                socket.close();release.set()
                import time
                deadline=time.monotonic()+2
                while app.state.active and time.monotonic()<deadline: time.sleep(0.01)
                self.assertEqual(app.state.active,0)
            slot=next(iter(app.state.sessions.slots.values()))
            self.assertEqual(slot.session.total,3*16000)

    def test_unexpected_disconnect_retains_unfinished_audio_for_same_signed_microphone(self):
        from unittest.mock import patch
        app=create_app(Engine(),SECRET)
        common=dict(diarize=False,streamId='microphone-session-123')
        with TestClient(app) as client,patch('stream_tickets.time.time',return_value=100):
            with client.websocket_connect('/asr?ticket='+ticket(**common)) as socket:
                first=socket.receive_json()
                socket.send_bytes(packet());socket.receive_json()
            with client.websocket_connect('/asr?ticket='+ticket(**common,nonce='network-retry')) as socket:
                config=socket.receive_json()
                self.assertTrue(config['resumed']);self.assertEqual(config['sessionId'],first['sessionId'])
                socket.send_bytes(b'')
                final=socket.receive_json()['final'][0]
                self.assertEqual(final['sessionId'],first['sessionId'])
                self.assertEqual(final['text'],'hello there')
                socket.receive_json()

    def test_pause_and_reconnect_reuse_namespace_and_replay_final_ids(self):
        from unittest.mock import patch
        app=create_app(Engine(),SECRET)
        common=dict(diarize=False,streamId='microphone-session-123')
        with TestClient(app) as client,patch('stream_tickets.time.time',return_value=100):
            with client.websocket_connect('/asr?ticket='+ticket(**common)) as socket:
                first=socket.receive_json()
                socket.send_bytes(packet());socket.receive_json()
                socket.send_json({'type':'pause'})
                finals=[]
                while True:
                    frame=socket.receive_json()
                    finals+=frame.get('final',[])
                    if frame['type']=='ready_to_stop':break
            self.assertEqual(len(app.state.sessions.slots),1)
            with client.websocket_connect('/asr?ticket='+ticket(**common,nonce='fresh-connection')) as socket:
                second=socket.receive_json()
                self.assertTrue(second['resumed']);self.assertEqual(second['sessionId'],first['sessionId'])
                self.assertEqual(socket.receive_json()['final'],finals)
                socket.send_bytes(packet());socket.receive_json()
                socket.send_bytes(b'')
                later=socket.receive_json()['final']
                self.assertNotEqual(later[0]['segmentId'],finals[0]['segmentId'])
                self.assertEqual(socket.receive_json()['type'],'ready_to_stop')
            self.assertEqual(len(app.state.sessions.slots),0)

    def test_rejects_bad_ticket_and_drains_valid_stream(self):
        app=create_app(Engine(),SECRET)
        with TestClient(app) as client:
            with self.assertRaises(WebSocketDisconnect):
                with client.websocket_connect('/asr?ticket=bad'): pass
            from unittest.mock import patch
            with patch('stream_tickets.time.time',return_value=100):
                with client.websocket_connect('/asr?ticket='+ticket(diarize=False)) as socket:
                    self.assertEqual(socket.receive_json()['type'],'config')
                    socket.send_bytes(packet())
                    self.assertEqual(socket.receive_json()['type'],'transcript')
                    socket.send_bytes(b'')
                    self.assertEqual(len(socket.receive_json()['final']),1)
                    self.assertEqual(socket.receive_json()['type'],'ready_to_stop')
            self.assertEqual(app.state.active,0)

if __name__=='__main__': unittest.main()
