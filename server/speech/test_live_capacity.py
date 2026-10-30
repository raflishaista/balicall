import unittest
from contextlib import ExitStack
from unittest.mock import patch
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from qwen_live_app import create_app as qwen_app
from sea_live_app import create_app as sea_app
from test_qwen_live_session import Engine as QwenEngine, packet as qwen_packet
from test_sea_live_app import Engine as SeaEngine, signed as sea_ticket, packet as sea_packet
from test_stream_tickets import ticket as qwen_ticket, SECRET

class LiveCapacityTests(unittest.TestCase):
    def test_configured_three_microphones_are_isolated_and_fourth_gets_explicit_capacity_error(self):
        for factory,engine,sign in [(qwen_app,QwenEngine,qwen_ticket),(sea_app,SeaEngine,sea_ticket)]:
            with self.subTest(worker=factory.__module__):
                app=factory(engine(),SECRET,max_sessions=3)
                with TestClient(app) as client,patch('stream_tickets.time.time',return_value=100),ExitStack() as stack:
                    sockets=[]
                    for index in range(3):
                        ws=stack.enter_context(client.websocket_connect('/asr?ticket='+sign(speakerId='owner-'+str(index),streamId='microphone-stream-'+str(index),nonce='nonce-'+str(index),diarize=False)))
                        self.assertEqual(ws.receive_json()['type'],'config');sockets.append(ws)
                    health=client.get('/health').json();self.assertEqual(health['maxSessions'],3);self.assertEqual(health['activeSessions'],3)
                    with client.websocket_connect('/asr?ticket='+sign(speakerId='fourth',nonce='fourth',diarize=False)) as rejected:
                        message=rejected.receive_json();self.assertEqual(message['code'],'capacity_exceeded');self.assertIn('belum',message['error'])
                        with self.assertRaises(WebSocketDisconnect):rejected.receive_json()
                    for ws in sockets:
                        ws.send_bytes(b'')
                        while ws.receive_json()['type']!='ready_to_stop':pass

    def test_capacity_is_bounded_and_default_stays_two(self):
        for factory,engine in [(qwen_app,QwenEngine),(sea_app,SeaEngine)]:
            with TestClient(factory(engine(),SECRET)) as client:self.assertEqual(client.get('/health').json()['maxSessions'],2)
            for limit in [0,9,True]:
                with self.assertRaises(ValueError):
                    with TestClient(factory(engine(),SECRET,max_sessions=limit)):pass

    def test_signed_end_replays_saved_final_on_both_workers_and_can_be_retried(self):
        for factory,engine,sign,packet in [(qwen_app,QwenEngine,qwen_ticket,qwen_packet),(sea_app,SeaEngine,sea_ticket,sea_packet)]:
            with self.subTest(worker=factory.__module__):
                app=factory(engine(),SECRET)
                common=dict(speakerId='owner',streamId='microphone-stream-owner',diarize=False)
                with TestClient(app) as client,patch('stream_tickets.time.time',return_value=100):
                    with client.websocket_connect('/asr?ticket='+sign(nonce='start',**common)) as ws:
                        ws.receive_json();ws.send_bytes(packet());ws.receive_json()
                        ws.send_json({'type':'pause'})
                        originals=[]
                        while True:
                            frame=ws.receive_json()
                            originals+=frame.get('final',[])
                            if frame['type']=='ready_to_stop':break
                    self.assertTrue(originals)
                    for nonce in ['end-first','end-retry']:
                        with client.websocket_connect('/asr?end=1&ticket='+sign(nonce=nonce,**common)) as ws:
                            replay=[]
                            while True:
                                frame=ws.receive_json();replay+=frame.get('final',[])
                                if frame['type']=='ready_to_stop':break
                        self.assertEqual(replay,originals)
                    self.assertEqual(len(app.state.sessions.slots),0)

if __name__=='__main__':unittest.main()
