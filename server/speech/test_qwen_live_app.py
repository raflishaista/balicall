import unittest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from qwen_live_app import create_app
from test_qwen_live_session import Engine,packet
from test_stream_tickets import ticket,SECRET

class AppTests(unittest.TestCase):
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
