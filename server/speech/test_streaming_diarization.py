import unittest
from unittest.mock import AsyncMock,patch
from streaming_diarization import DiarizationClient


class TransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_explicit_sea_credentials_and_valid_configuration(self):
        socket=AsyncMock();socket.recv.return_value='{"type":"config","sampleRate":16000}'
        with patch('websockets.asyncio.client.connect',AsyncMock(return_value=socket)) as connect:
            client=await DiarizationClient.connect('ws://local/asr','s'*40)
        self.assertIs(client.socket,socket)
        self.assertEqual(connect.call_args.kwargs['additional_headers'],{'Authorization':'Bearer '+'s'*40})

    async def test_invalid_configuration_closes_socket_and_becomes_connection_error(self):
        for raw in ['invalid','{"type":"error"}']:
            socket=AsyncMock();socket.recv.return_value=raw
            with patch('websockets.asyncio.client.connect',AsyncMock(return_value=socket)):
                with self.assertRaises(ConnectionError):await DiarizationClient.connect('ws://local/asr','s'*40)
            socket.close.assert_awaited_once()

    async def test_handshake_failure_becomes_connection_error(self):
        with patch('websockets.asyncio.client.connect',AsyncMock(side_effect=RuntimeError('capacity or authentication'))):
            with self.assertRaises(ConnectionError):await DiarizationClient.connect('ws://local/asr','s'*40)

    async def test_feed_rejects_non_turn_response(self):
        socket=AsyncMock();socket.recv.return_value='{"type":"error"}'
        with self.assertRaises(ConnectionError):await DiarizationClient(socket).feed(b'pcm')


if __name__=='__main__':unittest.main()
