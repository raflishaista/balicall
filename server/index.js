import dotenv from 'dotenv';
import WebSocket, { WebSocketServer } from 'ws';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { initDb } from './db.js';
import { initAuthDb } from './authStore.js';

dotenv.config({ path: fileURLToPath(new URL('./.env', import.meta.url)) });
const config = loadConfig();
// Finish additive schema migrations before accepting authenticated requests.
if (config.databaseUrl) {
  const ready = await initDb();
  if (config.authEnabled) {
    if (!ready) throw new Error('Database belum siap untuk layanan akun BaliCall.');
    await initAuthDb();
  }
}
const { app, close } = createApp(config);

const server = app.listen(config.port, () => {
  console.log(`====================================================`);
  console.log(`🚀 BaliCall API: http://localhost:${config.port}`);
  console.log(`📡 LiveKit configured: ${config.livekitUrl} (checked by /api/health)`);
  console.log(`🧠 LLM Provider: ${config.llmProvider} (${config.llmModel})`);
  console.log(`🎙️ Speech-to-text: ${config.sttProvider}`);
  console.log(`💾 Meeting storage: ${config.dataFile}`);
  if (!config.databaseUrl) {
    console.log(`ℹ️ PostgreSQL DATABASE_URL not set in server/.env.`);
  }
  console.log(`====================================================`);
});

server.on('close', close);

// QWEN_LIVE_WS_PROXY: relay browser WebSocket to the existing Qwen worker.
const qwenWsProxy = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  let requestUrl;

  try {
    requestUrl = new URL(req.url, 'http://localhost');
  } catch {
    socket.destroy();
    return;
  }

  if (!requestUrl.pathname.startsWith('/qwen-live-stt/')) {
    socket.destroy();
    return;
  }

  if (!config.qwenLiveSttSecret) {
    socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    return;
  }

  // Remove the public prefix: /qwen-live-stt/asr -> /asr.
  const upstreamUrl = new URL(req.url, 'ws://127.0.0.1:8008');
  upstreamUrl.pathname = requestUrl.pathname.replace(/^\/qwen-live-stt/, '') || '/';

  const upstream = new WebSocket(upstreamUrl, {
    headers: {
      Authorization: `Bearer ${config.qwenLiveSttSecret}`,
    },
  });

  let upgraded = false;
  let client;

  upstream.once('open', () => {
    if (socket.destroyed) {
      upstream.close();
      return;
    }

    qwenWsProxy.handleUpgrade(req, socket, head, ws => {
      upgraded = true;
      client = ws;

      const closeBoth = () => {
        if (client && client.readyState < WebSocket.CLOSING) client.close();
        if (upstream.readyState < WebSocket.CLOSING) upstream.close();
      };

      client.on('message', (data, isBinary) => {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(data, { binary: isBinary });
        }
      });

      upstream.on('message', (data, isBinary) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data, { binary: isBinary });
        }
      });

      client.on('close', closeBoth);
      upstream.on('close', closeBoth);
      client.on('error', closeBoth);
      upstream.on('error', closeBoth);
    });
  });

  upstream.once('error', () => {
    if (!upgraded && !socket.destroyed) {
      socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    } else if (client && client.readyState < WebSocket.CLOSING) {
      client.close();
    }
  });
});
