#!/usr/bin/env node
/**
 * Spawn N dummy users and join them into an active BaliCall room by roomCode.
 *
 * Usage:
 *   node server/scripts/join-dummy-users.js --room-code ABCDE --count 25 [--api http://localhost:3001/api]
 *
 * What it does:
 * 1. Seeds N dummy employees (BT-DUMMY-001..N) + active auth sessions in PostgreSQL
 *    (bypasses the 30-per-IP /auth/login and /auth/guest rate limits).
 * 2. Calls POST /api/token + POST /api/meetings/:id/presence for each dummy user so
 *    they appear in meeting attendance, polls, and breakout room auto-assignments.
 * 3. Writes client/public/dummy-swarm.html with their LiveKit tokens and prints a link
 *    (http://localhost:5173/dummy-swarm.html) that connects all N WebRTC rooms to LiveKit
 *    so their tiles and Peserta roster entries appear live in the call UI.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

const { getPool, initDb } = await import('../db.js');
const { initAuthDb, hashToken } = await import('../authStore.js');

function parseArgs(argv) {
  const args = { roomCode: '', count: 20, api: `http://localhost:${process.env.PORT || 3001}/api` };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--room-code' && argv[i + 1]) args.roomCode = String(argv[++i]).trim().toUpperCase();
    else if (a === '--count' && argv[i + 1]) args.count = Math.max(1, Math.min(500, Number(argv[++i]) || 20));
    else if (a === '--api' && argv[i + 1]) args.api = String(argv[++i]).replace(/\/+$/, '');
  }
  return args;
}

async function main() {
  const { roomCode, count, api } = parseArgs(process.argv);
  if (!roomCode) {
    console.error('Usage: node server/scripts/join-dummy-users.js --room-code <ROOM_CODE> [--count 25]');
    process.exit(1);
  }

  let pool = null;
  try {
    await initDb();
    await initAuthDb();
    pool = getPool();
  } catch {
    pool = null;
  }

  console.log(`[1/3] Preparing ${count} dummy users...`);
  const dummySessions = [];
  for (let i = 1; i <= count; i++) {
    const empId = `BT-${String(90000 + i)}`;
    const name = `Dummy Peserta ${i}`;
    const email = `dummy.peserta.${i}@balitower.test`;
    const sessionToken = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(sessionToken);

    if (pool) {
      try {
        await pool.query(
          `INSERT INTO balicall_employees (employee_id, name, department, position, email, status)
           VALUES ($1, $2, 'QA Load Test', 'Dummy Participant', $3, 'active')
           ON CONFLICT (employee_id) DO UPDATE SET name = EXCLUDED.name, status = 'active'`,
          [empId, name, email]
        );
        await pool.query(
          `INSERT INTO balicall_auth_accounts (employee_id, login_email)
           VALUES ($1, $2)
           ON CONFLICT (employee_id) DO UPDATE SET login_email = EXCLUDED.login_email`,
          [empId, email]
        );
        await pool.query(
          `INSERT INTO balicall_auth_sessions (token_hash, employee_id, expires_at)
           VALUES ($1, $2, NOW() + INTERVAL '8 hours')`,
          [tokenHash, empId]
        );
      } catch {
        // Proceed even if DB seeding is skipped when AUTH_ENABLED=false
      }
    }

    dummySessions.push({
      empId,
      name,
      sessionToken,
      csrfToken: hashToken(`balicall-csrf:${sessionToken}`),
    });
  }

  console.log(`[2/3] Joining ${count} dummy users to roomCode="${roomCode}" via ${api}/token...`);
  const livekitEntries = [];
  let meetingId = null;
  let livekitUrl = null;

  for (const u of dummySessions) {
    const headers = {
      'Content-Type': 'application/json',
      Cookie: `balicall_session=${u.sessionToken}`,
      'X-CSRF-Token': u.csrfToken,
    };
    const res = await fetch(`${api}/token`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        roomName: roomCode,
        roomCode,
        intent: 'join',
        employeeId: u.empId,
        employeeName: u.name,
        department: 'QA Load Test',
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`Failed joining ${u.empId} (HTTP ${res.status}): ${errText}`);
      continue;
    }
    const data = await res.json();
    meetingId = data.meetingId;
    livekitUrl = data.url;

    await fetch(`${api}/meetings/${encodeURIComponent(meetingId)}/presence`, {
      method: 'POST',
      headers: { ...headers, Authorization: `Bearer ${data.token}` },
      body: JSON.stringify({ connected: true }),
    });

    livekitEntries.push({
      empId: u.empId,
      name: u.name,
      token: data.token,
      url: data.url,
    });
  }

  console.log(`Joined ${livekitEntries.length}/${count} dummy users to meetingId=${meetingId}.`);

  const swarmHtmlPath = resolve(__dirname, '../../client/public/dummy-swarm.html');
  const html = `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <title>BaliCall Dummy Participant Swarm (${livekitEntries.length} users)</title>
  <script src="https://cdn.jsdelivr.net/npm/livekit-client@2.11.3/dist/livekit-client.umd.min.js"></script>
  <style>
    body { font-family: system-ui, sans-serif; padding: 24px; background: #0f172a; color: #f8fafc; }
    .card { max-width: 720px; margin: 0 auto; background: #1e293b; padding: 20px; border-radius: 12px; }
    button { padding: 10px 16px; border-radius: 8px; border: 0; font-weight: 600; cursor: pointer; margin-right: 8px; }
    .primary { background: #2563eb; color: white; }
    .danger { background: #dc2626; color: white; }
    pre { background: #020617; padding: 12px; border-radius: 8px; max-height: 360px; overflow: auto; font-size: 12.5px; }
  </style>
</head>
<body>
  <div class="card">
    <h2>BaliCall Dummy Participant Swarm</h2>
    <p>Room Code: <strong>${roomCode}</strong> · Dummy Users: <strong>${livekitEntries.length}</strong> · LiveKit: <code>${livekitUrl || 'ws://localhost:7880'}</code></p>
    <div>
      <button class="primary" id="connectBtn">Connect All ${livekitEntries.length} Dummy Users to LiveKit</button>
      <button class="danger" id="disconnectBtn">Disconnect All</button>
    </div>
    <pre id="log">Click "Connect All" to connect WebRTC rooms so all dummy tiles appear live in your call.</pre>
  </div>
  <script>
    const entries = ${JSON.stringify(livekitEntries)};
    const rooms = [];
    const logEl = document.getElementById('log');
    const log = msg => { logEl.textContent += '\\n' + msg; logEl.scrollTop = logEl.scrollHeight; };

    document.getElementById('connectBtn').onclick = async () => {
      log('Connecting ' + entries.length + ' dummy users...');
      let ok = 0;
      for (const item of entries) {
        try {
          const room = new LivekitClient.Room();
          await room.connect(item.url, item.token, { autoSubscribe: false });
          rooms.push(room);
          ok++;
          log('Connected [' + ok + '/' + entries.length + '] ' + item.name + ' (' + item.empId + ')');
        } catch (err) {
          log('Error connecting ' + item.name + ': ' + err.message);
        }
      }
      log('Done! ' + ok + ' dummy users are now live in the call.');
    };

    document.getElementById('disconnectBtn').onclick = async () => {
      for (const r of rooms.splice(0)) {
        try { await r.disconnect(); } catch {}
      }
      log('Disconnected all dummy users.');
    };
  </script>
</body>
</html>`;
  writeFileSync(swarmHtmlPath, html, 'utf8');
  const distDir = resolve(__dirname, '../../client/dist');
  if (existsSync(distDir)) {
    writeFileSync(resolve(distDir, 'dummy-swarm.html'), html, 'utf8');
  }
  console.log(`[3/3] Wrote LiveKit WebRTC swarm launcher to: ${swarmHtmlPath}`);
  console.log(`      Open http://localhost:5187/dummy-swarm.html in your browser and click "Connect All" to see all ${livekitEntries.length} dummy tiles live in the call!`);
  if (pool) await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
