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
      meetingId,
      sessionToken: u.sessionToken,
      csrfToken: u.csrfToken,
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
    .card { max-width: 820px; margin: 0 auto; background: #1e293b; padding: 22px; border-radius: 12px; display: grid; gap: 14px; }
    h2 { margin: 0; }
    .controls-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; background: #0f172a; padding: 14px; border-radius: 10px; border: 1px solid #334155; }
    label { display: flex; flex-direction: column; gap: 5px; font-size: 13px; color: #cbd5e1; }
    label.inline { flex-direction: row; align-items: center; gap: 8px; font-weight: 600; color: #f8fafc; }
    input[type="text"], select, input[type="file"] { padding: 7px 10px; border-radius: 6px; border: 1px solid #475569; background: #1e293b; color: #f8fafc; font-size: 13px; }
    .btn-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    button { padding: 10px 15px; border-radius: 8px; border: 0; font-weight: 600; cursor: pointer; font-size: 13px; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .primary { background: #2563eb; color: white; }
    .secondary { background: #059669; color: white; }
    .amber { background: #d97706; color: white; }
    .danger { background: #dc2626; color: white; }
    .preview-row { display: flex; align-items: center; gap: 14px; font-size: 12.5px; color: #94a3b8; }
    canvas { border-radius: 8px; border: 1px solid #475569; background: #020617; width: 160px; height: 90px; object-fit: cover; }
    pre { background: #020617; padding: 12px; border-radius: 8px; max-height: 320px; overflow: auto; font-size: 12.5px; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <h2>BaliCall Dummy Participant Swarm (Media &amp; Load Tester)</h2>
    <p style="margin:0;font-size:13.5px;color:#cbd5e1;">
      Room Code: <strong>${roomCode}</strong> · Dummy Users: <strong>${livekitEntries.length}</strong> · LiveKit: <code>${livekitUrl || 'ws://localhost:7880'}</code>
    </p>

    <div class="controls-grid">
      <label class="inline">
        <input type="checkbox" id="enableCam" checked />
        Publish Camera (JPG / Canvas)
      </label>
      <label class="inline">
        <input type="checkbox" id="enableMic" checked />
        Publish Microphone (Audio Track)
      </label>
      <label>
        Custom Camera Image (.jpg / .png)
        <input type="file" id="jpgInput" accept="image/jpeg,image/png,image/webp" />
      </label>
      <label>
        Camera Resolution &amp; FPS
        <select id="camPreset">
          <option value="640x360x10">360p @ 10 FPS (Recommended for 20-50 dummies)</option>
          <option value="1280x720x15">720p @ 15 FPS (Heavy SFU bandwidth test)</option>
          <option value="320x180x5">180p @ 5 FPS (Lightweight 50+ dummies)</option>
        </select>
      </label>
      <label>
        Custom Voice Audio (.wav / .mp3, optional)
        <input type="file" id="audioInput" accept="audio/*" />
      </label>
      <label>
        Phrase Preset (Language &amp; Length)
        <select id="phrasePreset">
          <option value="short_id">Short (ID): "Hadir"</option>
          <option value="long_id">Long Indonesian (Sumpah Pemuda)</option>
          <option value="long_en">Long English (The Stranger Opening)</option>
          <option value="mixed_long">Bilingual Mix (Even = Indonesian Long, Odd = English Long)</option>
          <option value="custom">Custom Text Below</option>
        </select>
      </label>
      <label style="grid-column: 1 / -1;">
        Phrase / Text to Speak &amp; Transcribe
        <textarea id="phraseInput" rows="3" style="padding:7px 10px;border-radius:6px;border:1px solid #475569;background:#1e293b;color:#f8fafc;font-size:13px;font-family:inherit;resize:vertical;">Hadir</textarea>
      </label>
    </div>

    <div class="preview-row">
      <canvas id="camCanvas" width="640" height="360"></canvas>
      <div>
        <strong>Live Camera Canvas Feed</strong><br/>
        Draws your selected JPG (or default studio card) with a live frame counter so WebRTC encodes real video packets continuously.
      </div>
    </div>

    <div class="btn-row">
      <button class="primary" id="connectBtn">1. Connect All ${livekitEntries.length} Dummy Users</button>
      <button class="secondary" id="speakBtn" disabled>2. Make Dummies Say Phrase (Audio + Transcript)</button>
      <button class="amber" id="toggleCamBtn" disabled>Toggle All Cameras</button>
      <button class="danger" id="disconnectBtn" disabled>Disconnect All</button>
    </div>

    <pre id="log">Ready. Configure camera/mic options above and click "1. Connect All".</pre>
  </div>

  <script>
    const entries = ${JSON.stringify(livekitEntries)};
    const fallbackApiBase = ${JSON.stringify(api)};
    const apiBase = window.location.port === '5187' ? '/api' : fallbackApiBase;
    const TRANSCRIPT_TOPIC = 'balicall.transcript.saved.v1';
    const textEncoder = new TextEncoder();
    const rooms = [];
    const micAnalysers = [];
    const logEl = document.getElementById('log');
    const log = msg => { logEl.textContent += '\\n' + msg; logEl.scrollTop = logEl.scrollHeight; };

    // 1. Setup JPG / Canvas Video Stream
    const canvas = document.getElementById('camCanvas');
    const ctx = canvas.getContext('2d');
    let loadedImg = null;
    let animTimer = null;
    let frameCount = 0;

    // Load default Balitower image if available
    const defaultImg = new Image();
    defaultImg.crossOrigin = 'anonymous';
    defaultImg.onload = () => { if (!loadedImg) loadedImg = defaultImg; };
    defaultImg.src = '/BalitowerSentra-Connected-Navy.png';

    document.getElementById('jpgInput').addEventListener('change', e => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          loadedImg = img;
          log('Loaded custom camera image: ' + file.name + ' (' + img.width + 'x' + img.height + ')');
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });

    function drawCanvasFrame() {
      frameCount++;
      const w = canvas.width;
      const h = canvas.height;
      if (loadedImg) {
        ctx.drawImage(loadedImg, 0, 0, w, h);
      } else {
        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, '#1e3a8a');
        grad.addColorStop(1, '#0f172a');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }
      // Draw subtle animated indicator & clock so WebRTC encoder sends real RTP packets
      ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
      ctx.fillRect(12, h - 44, w - 24, 32);
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.fillText('BALICALL LOAD TEST · ' + new Date().toLocaleTimeString('id-ID') + ' · F' + (frameCount % 999), 22, h - 22);
    }
    drawCanvasFrame();

    // 2. Setup Web Audio Synthesizer / File Player for Microphone Track
    let audioCtx = null;
    let customAudioBuffer = null;

    document.getElementById('audioInput').addEventListener('change', async e => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const arr = await file.arrayBuffer();
      customAudioBuffer = await audioCtx.decodeAudioData(arr);
      log('Loaded custom voice audio: ' + file.name + ' (' + customAudioBuffer.duration.toFixed(1) + 's)');
    });

    function createDummyAudioTrack(index) {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const dest = audioCtx.createMediaStreamDestination();
      // Keep a very quiet baseline gain node so the track stays alive
      const masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.0;
      const osc = audioCtx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 180 + (index % 8) * 22; // human voice fundamental range (180-340 Hz)
      osc.connect(masterGain);
      masterGain.connect(dest);
      osc.start();
      return {
        track: dest.stream.getAudioTracks()[0],
        pulseVoice: (durationMs = 900) => {
          if (audioCtx.state === 'suspended') audioCtx.resume();
          if (customAudioBuffer) {
            const src = audioCtx.createBufferSource();
            src.buffer = customAudioBuffer;
            src.connect(dest);
            src.start();
          } else {
            const now = audioCtx.currentTime;
            masterGain.gain.cancelScheduledValues(now);
            masterGain.gain.setValueAtTime(0.25, now);
            masterGain.gain.exponentialRampToValueAtTime(0.001, now + durationMs / 1000);
          }
        },
      };
    }

    let sharedCanvasStream = null;
    let camerasEnabled = true;

    document.getElementById('connectBtn').onclick = async () => {
      const enableCam = document.getElementById('enableCam').checked;
      const enableMic = document.getElementById('enableMic').checked;
      const [w, h, fps] = document.getElementById('camPreset').value.split('x').map(Number);
      canvas.width = w;
      canvas.height = h;
      if (animTimer) clearInterval(animTimer);
      animTimer = setInterval(drawCanvasFrame, Math.round(1000 / fps));
      sharedCanvasStream = canvas.captureStream(fps);
      const baseVideoTrack = sharedCanvasStream.getVideoTracks()[0];

      document.getElementById('connectBtn').disabled = true;
      log('Connecting ' + entries.length + ' dummy users (Camera=' + enableCam + ' @ ' + w + 'x' + h + ' ' + fps + 'fps, Mic=' + enableMic + ')...');

      let ok = 0;
      for (let i = 0; i < entries.length; i++) {
        const item = entries[i];
        try {
          const room = new LivekitClient.Room();
          await room.connect(item.url, item.token, { autoSubscribe: false });

          if (enableCam && baseVideoTrack) {
            const camTrack = baseVideoTrack.clone();
            await room.localParticipant.publishTrack(camTrack, {
              name: 'camera',
              source: LivekitClient.Track.Source.Camera,
              simulcast: false,
            });
          }

          let voiceController = null;
          if (enableMic) {
            voiceController = createDummyAudioTrack(i);
            await room.localParticipant.publishTrack(voiceController.track, {
              name: 'microphone',
              source: LivekitClient.Track.Source.Microphone,
            });
          }

          rooms.push({ room, item, voiceController });
          ok++;
          log('Connected [' + ok + '/' + entries.length + '] ' + item.name + ' (' + item.empId + ')');
        } catch (err) {
          log('Error connecting ' + item.name + ': ' + err.message);
        }
      }
      camerasEnabled = enableCam;
      document.getElementById('speakBtn').disabled = false;
      document.getElementById('toggleCamBtn').disabled = false;
      document.getElementById('disconnectBtn').disabled = false;
      log('Done! ' + ok + ' dummy users are now live in the call.');
    };

    const PHRASE_PRESETS = {
      short_id: 'Hadir',
      long_id: 'Kami putra dan putri Indonesia, mengaku bertumpah darah yang satu, tanah air Indonesia.\\nKami putra dan putri Indonesia, mengaku berbangsa yang satu, bangsa Indonesia.\\nKami putra dan putri Indonesia, menjunjung bahasa persatuan, bahasa Indonesia.',
      long_en: 'My mother died today. Or maybe yesterday, I don\\'t know. I received a telegram from the old people\\'s home: "Mother deceased. Funeral tomorrow. Very sincerely yours." That doesn\\'t mean anything. It might have been yesterday.',
    };

    const presetSelect = document.getElementById('phrasePreset');
    const phraseInputEl = document.getElementById('phraseInput');
    presetSelect.addEventListener('change', () => {
      const val = presetSelect.value;
      if (val === 'short_id' || val === 'long_id' || val === 'long_en') {
        phraseInputEl.value = PHRASE_PRESETS[val];
      } else if (val === 'mixed_long') {
        phraseInputEl.value = '[Bilingual Mode] Even dummies speak Indonesian (Sumpah Pemuda); Odd dummies speak English (The Stranger).';
      }
    });

    document.getElementById('speakBtn').onclick = async () => {
      const preset = presetSelect.value;
      const customText = (phraseInputEl.value || 'Hadir').trim();
      if (!customText && preset !== 'mixed_long') return;
      log('Making ' + rooms.length + ' dummy users speak (' + preset + ', staggered over ' + (rooms.length * 180) + 'ms)...');
      for (let i = 0; i < rooms.length; i++) {
        const { room, item, voiceController } = rooms[i];
        const phrase = preset === 'mixed_long'
          ? (i % 2 === 0 ? PHRASE_PRESETS.long_id : PHRASE_PRESETS.long_en)
          : customText;
        const pulseMs = Math.min(6000, Math.max(850, phrase.length * 28));
        setTimeout(async () => {
          if (voiceController) voiceController.pulseVoice(pulseMs);
          try {
            const requestId = 'dummy-utt-' + item.empId + '-' + Date.now() + '-' + i;
            const res = await fetch(apiBase + '/meetings/' + encodeURIComponent(item.meetingId) + '/transcript', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + item.token,
                'X-CSRF-Token': item.csrfToken,
              },
              body: JSON.stringify({
                text: phrase,
                requestId,
              }),
            });
            if (!res.ok) {
              const errText = await res.text();
              log('Transcript error for ' + item.name + ' (HTTP ' + res.status + '): ' + errText);
              return;
            }
            const data = await res.json();
            const entry = data && data.entry;
            if (entry && room && room.localParticipant) {
              const entryId = entry.revision ? (entry.id + ':' + entry.revision) : entry.id;
              await room.localParticipant.publishData(
                textEncoder.encode(JSON.stringify({ v: 1, meetingId: item.meetingId, entryId })),
                { reliable: true, topic: TRANSCRIPT_TOPIC }
              );
            }
            log('Recorded transcript [' + (i + 1) + '/' + rooms.length + '] ' + item.name + ': "' + phrase.slice(0, 48) + (phrase.length > 48 ? '…' : '') + '"');
          } catch (err) {
            log('Transcript failed for ' + item.name + ': ' + err.message);
          }
        }, i * 180);
      }
    };

    document.getElementById('toggleCamBtn').onclick = async () => {
      if (!sharedCanvasStream) return;
      const baseVideoTrack = sharedCanvasStream.getVideoTracks()[0];
      camerasEnabled = !camerasEnabled;
      log((camerasEnabled ? 'Enabling' : 'Disabling') + ' cameras for ' + rooms.length + ' dummy users...');
      for (const entry of rooms) {
        try {
          const pubs = [...entry.room.localParticipant.videoTrackPublications.values()];
          if (!camerasEnabled) {
            for (const pub of pubs) {
              if (pub.track) await entry.room.localParticipant.unpublishTrack(pub.track);
            }
          } else if (pubs.length === 0 && baseVideoTrack) {
            await entry.room.localParticipant.publishTrack(baseVideoTrack.clone(), {
              name: 'camera',
              source: LivekitClient.Track.Source.Camera,
              simulcast: false,
            });
          }
        } catch {}
      }
      log('Cameras are now ' + (camerasEnabled ? 'ON' : 'OFF') + ' for all dummies.');
    };

    document.getElementById('disconnectBtn').onclick = async () => {
      if (animTimer) clearInterval(animTimer);
      for (const entry of rooms.splice(0)) {
        try { await entry.room.disconnect(); } catch {}
      }
      document.getElementById('connectBtn').disabled = false;
      document.getElementById('speakBtn').disabled = true;
      document.getElementById('toggleCamBtn').disabled = true;
      document.getElementById('disconnectBtn').disabled = true;
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
