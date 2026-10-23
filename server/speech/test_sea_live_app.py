import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from sea_live_app import create_app
from test_sea_live_session import Engine,packet
from test_stream_tickets import ticket,SECRET


def signed(**changes):
    values=dict(model='sea-asr-id-live',diarize=False,streamId='microphone-session-123')
    values.update(changes)
    return ticket(**values)


class AppTests(unittest.TestCase):
    def test_optional_diarization_retains_one_speaker_cache_and_original_mode_proof(self):
        from test_sea_diarized_session import Diarizer
        from test_sea_diarization import turn
        created=[]
        async def factory():
            diarizer=Diarizer([turn(0,16000)]);created.append(diarizer);return diarizer
        app=create_app(Engine(),SECRET,diarizer_factory=factory)
        with TestClient(app) as client,patch('stream_tickets.time.time',return_value=100):
            self.assertTrue(client.get('/health').json()['diarization'])
            proof=signed(diarize=True)
            with client.websocket_connect('/asr?ticket='+proof) as ws:
                config=ws.receive_json();self.assertTrue(config['diarization'])
                ws.send_bytes(packet());ws.receive_json()
                ws.send_json({'type':'pause'})
                result=ws.receive_json()['final'][0]
                self.assertEqual(result['attribution'],'assigned')
                self.assertEqual(result['sessionProof'],proof)
                while ws.receive_json()['type']!='ready_to_stop':pass
            with client.websocket_connect('/asr?ticket='+signed(diarize=True,nonce='diar-resume')) as ws:
                resumed=ws.receive_json()
                self.assertTrue(resumed['resumed']);self.assertEqual(resumed['sessionId'],config['sessionId'])
                self.assertEqual(ws.receive_json()['final'],[result])
                ws.send_bytes(b'');self.assertEqual(ws.receive_json()['type'],'ready_to_stop')
            self.assertEqual(len(created),1)
            self.assertTrue(created[0].closed)

    def test_diarization_connection_failure_does_not_leak_a_session_slot(self):
        async def unavailable():raise ConnectionError('unavailable')
        app=create_app(Engine(),SECRET,diarizer_factory=unavailable)
        with TestClient(app) as client,patch('stream_tickets.time.time',return_value=100):
            with self.assertRaises(WebSocketDisconnect) as caught:
                with client.websocket_connect('/asr?ticket='+signed(diarize=True)):pass
            self.assertEqual(caught.exception.code,4503)
            self.assertEqual(len(app.state.sessions.slots),0)

    def test_mute_reconnect_replays_original_ids_and_releases_on_finish(self):
        app=create_app(Engine(),SECRET)
        with TestClient(app) as client,patch('stream_tickets.time.time',return_value=100):
            health=client.get('/health').json()
            self.assertTrue(health['ready']);self.assertFalse(health['native'])
            with client.websocket_connect('/asr?ticket='+signed()) as ws:
                config=ws.receive_json()
                ws.send_bytes(packet());self.assertTrue(ws.receive_json()['interim'])
                ws.send_json({'type':'pause'})
                final=ws.receive_json()['final'][0]
                self.assertEqual(final['sourceId'],'owner')
                self.assertEqual(ws.receive_json()['type'],'ready_to_stop')
            with client.websocket_connect('/asr?ticket='+signed(nonce='resume-one')) as ws:
                resumed=ws.receive_json()
                self.assertTrue(resumed['resumed'])
                self.assertEqual(resumed['sessionId'],config['sessionId'])
                self.assertEqual(ws.receive_json()['final'],[final])
                ws.send_bytes(packet());ws.receive_json()
                ws.send_bytes(b'')
                second=ws.receive_json()['final'][0]
                self.assertNotEqual(second['segmentId'],final['segmentId'])
                self.assertEqual(ws.receive_json()['type'],'ready_to_stop')
            self.assertEqual(len(app.state.sessions.slots),0)

    def test_ticket_replay_language_and_diarization_are_rejected(self):
        app=create_app(Engine(),SECRET)
        with TestClient(app) as client,patch('stream_tickets.time.time',return_value=100):
            for raw in [ticket(model='small'),signed(language='en'),ticket(model='sea-asr-id-live',diarize=True)]:
                with self.assertRaises(WebSocketDisconnect):
                    with client.websocket_connect('/asr?ticket='+raw):pass
            raw=signed(nonce='single-use')
            with client.websocket_connect('/asr?ticket='+raw) as ws:
                ws.receive_json();ws.send_bytes(b'');ws.receive_json()
            with self.assertRaises(WebSocketDisconnect):
                with client.websocket_connect('/asr?ticket='+raw):pass

    def test_two_sessions_capacity_owner_isolation_and_signed_end(self):
        app=create_app(Engine(),SECRET)
        with TestClient(app) as client,patch('stream_tickets.time.time',return_value=100):
            for owner in ['a','b']:
                with client.websocket_connect('/asr?ticket='+signed(nonce=owner,speakerId=owner)) as ws:
                    ws.receive_json();ws.send_json({'type':'pause'});ws.receive_json()
            with self.assertRaises(WebSocketDisconnect):
                with client.websocket_connect('/asr?ticket='+signed(nonce='third',speakerId='c')):pass
            with client.websocket_connect('/asr?end=1&ticket='+signed(nonce='wrong-end',speakerId='c')) as ws:
                ws.receive_json()
            self.assertEqual(len(app.state.sessions.slots),2)
            with client.websocket_connect('/asr?end=1&ticket='+signed(nonce='own-end',speakerId='a')) as ws:
                self.assertEqual(ws.receive_json()['type'],'ready_to_stop')
            self.assertEqual(len(app.state.sessions.slots),1)


if __name__=='__main__': unittest.main()
