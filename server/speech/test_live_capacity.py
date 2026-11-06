import os
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

    def test_sea_has_no_default_cap_across_rooms_and_keeps_microphones_isolated(self):
        app=sea_app(SeaEngine(),SECRET)
        with patch.dict(os.environ),patch('stream_tickets.time.time',return_value=100):
            os.environ.pop('SEA_LIVE_MAX_SESSIONS',None)
            with TestClient(app) as client,ExitStack() as stack:
                sockets=[]
                for index in range(9):
                    owner=f'owner-{index}'
                    proof=sea_ticket(meetingId='meeting' if index<8 else 'other-room',speakerId=owner,
                        streamId=f'microphone-stream-{index}',nonce=f'sea-session-{index}')
                    ws=stack.enter_context(client.websocket_connect('/asr?ticket='+proof))
                    self.assertEqual(ws.receive_json()['type'],'config')
                    sockets.append((ws,owner))
                health=client.get('/health').json()
                self.assertIsNone(health['maxSessions'])
                self.assertEqual(health['activeSessions'],9)
                for ws,_ in sockets:
                    ws.send_bytes(sea_packet())
                segment_ids=set()
                for ws,owner in sockets:
                    self.assertTrue(ws.receive_json()['interim'])
                    ws.send_bytes(b'')
                    final=ws.receive_json()['final'][0]
                    self.assertEqual(final['sourceId'],owner)
                    segment_ids.add(final['segmentId'])
                    self.assertEqual(ws.receive_json()['type'],'ready_to_stop')
                self.assertEqual(len(segment_ids),9)
                stack.close()
                self.assertEqual(client.get('/health').json()['activeSessions'],0)

    def test_qwen_default_stays_two_and_explicit_limits_are_bounded(self):
        with TestClient(qwen_app(QwenEngine(),SECRET)) as client:
            self.assertEqual(client.get('/health').json()['maxSessions'],2)
        for factory,engine in [(qwen_app,QwenEngine),(sea_app,SeaEngine)]:
            for limit in [0,9,True]:
                with self.assertRaises(ValueError):
                    with TestClient(factory(engine(),SECRET,max_sessions=limit)):pass

    def test_sea_environment_can_override_the_default(self):
        for setting,limit in [('0',None),('2',2)]:
            with self.subTest(setting=setting),patch.dict(os.environ,SEA_LIVE_MAX_SESSIONS=setting):
                with TestClient(sea_app(SeaEngine(),SECRET)) as client:
                    self.assertEqual(client.get('/health').json()['maxSessions'],limit)

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
