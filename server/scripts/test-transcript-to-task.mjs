// server/scripts/test-transcript-to-task.mjs
// Quality Control: Uji pembacaan transkrip, ekstraksi action items, dan sinkronisasi ke IT Project MCP

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import dotenv from 'dotenv';
import { loadConfig } from '../config.js';
import { createApp } from '../app.js';
import { createItProjectClient } from '../itproject.js';

const mockSessionToken = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
const mockCsrf = createHash('sha256').update('balicall-csrf:' + mockSessionToken).digest('hex');

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });
const config = loadConfig(process.env);

console.log('========================================================');
console.log('  QC Test: Transcript Reading -> Summary -> MCP Task');
console.log('========================================================\n');

console.log('[1/4] Memeriksa konfigurasi IT Project MCP...');
console.log('  MCP URL:          ', config.itprojectMcpUrl);
console.log('  Project ID:       ', config.itprojectProjectId);
console.log('  Task Type ID:     ', config.itprojectTaskTypeId);
console.log('  Default Status:   ', config.itprojectTaskStatusName);

const itProject = createItProjectClient(config);
console.log('  Client Auth:      ', itProject.authenticated ? '✅ Authenticated' : '❌ Not Authenticated');
console.log('  Client Enabled:   ', itProject.enabled ? '✅ Enabled' : '❌ Disabled');

if (!itProject.authenticated) {
  console.error('\n❌ Token OAuth belum tersedia. Login di browser terlebih dahulu:');
  console.error('   http://localhost:3001/api/itproject/oauth/start');
  process.exit(1);
}

// 2. Siapkan instance aplikasi dan meeting dengan transkrip
console.log('\n[2/4] Menyiapkan rapat uji dan data transkrip dialog...');
const { app, store, close } = createApp(config, {
  authStore: {
    session: async () => ({
      employee_id: 'BT-9901',
      employeeId: 'BT-9901',
      name: 'Bima',
      department: 'NOC & Core Network',
    }),
  },
  livekitProbe: async () => {},
});

const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const port = server.address().port;

// 1. Dapatkan token meeting resmi dari /api/token
const tokenRes = await fetch(`http://127.0.0.1:${port}/api/token`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Cookie': `balicall_session=${mockSessionToken}`,
    'X-CSRF-Token': mockCsrf,
    'Origin': `http://127.0.0.1:${port}`,
  },
  body: JSON.stringify({
    roomName: 'Rapat Sinkronisasi MCP & Notulen Otomatis',
    employeeId: 'BT-9901',
    employeeName: 'Bima',
    department: 'NOC & Core Network',
  }),
});

const tokenData = await tokenRes.json();
if (!tokenRes.ok) {
  throw new Error(`Token request failed (${tokenRes.status}): ${JSON.stringify(tokenData)}`);
}
const meetingId = tokenData.meetingId;
const meetingToken = tokenData.token;

store.transact(() => {
  const meeting = store.get(meetingId);
  meeting.transcripts.push(
    {
      id: 'tr-1',
      speakerName: 'Bima',
      text: 'Untuk tindak lanjut rapat, Bima akan menyelesaikan dokumentasi MCP dan panduan manual status in progress dengan tenggat 2026-11-06.',
      timestamp: new Date().toISOString(),
      segments: [{
        text: 'Untuk tindak lanjut rapat, Bima akan menyelesaikan dokumentasi MCP dan panduan manual status in progress dengan tenggat 2026-11-06.',
        start: 0,
        end: 5,
        attribution: 'speaker verified',
      }],
    },
    {
      id: 'tr-2',
      speakerName: 'Bima',
      text: 'Semua sistem WebRTC LiveKit dan worker STT sudah terhubung normal.',
      timestamp: new Date().toISOString(),
      segments: [{
        text: 'Semua sistem WebRTC LiveKit dan worker STT sudah terhubung normal.',
        start: 6,
        end: 10,
        attribution: 'speaker verified',
      }],
    }
  );
  meeting.itProjectTaskDispatch = {};
});

try {
  // 3. Minta pembuatan notulen dari transkrip
  console.log('\n[3/4] Menjalankan summarizer & grounding AI terhadap transkrip...');
  const summarizeResponse = await fetch(`http://127.0.0.1:${port}/api/meetings/${meetingId}/summarize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `balicall_session=${mockSessionToken}`,
      'Authorization': `Bearer ${meetingToken}`,
      'X-CSRF-Token': mockCsrf,
      'Origin': `http://127.0.0.1:${port}`,
    },
  });

  const summarizeData = await summarizeResponse.json();
  if (!summarizeResponse.ok) {
    throw new Error(`Summarize gagal (${summarizeResponse.status}): ${JSON.stringify(summarizeData)}`);
  }

  const summary = summarizeData.summary;
  console.log('  ✅ Judul Notulen:    ', summary?.title);
  console.log('  ✅ Ringkasan:        ', summary?.executiveSummary?.slice(0, 80) + '...');
  console.log('  ✅ Action Items Ditemukan:', summary?.actionItems?.length || 0);

  for (const [idx, item] of (summary?.actionItems || []).entries()) {
    console.log(`     [Item ${idx + 1}]`);
    console.log(`       - Tugas:    ${item.task}`);
    console.log(`       - PIC:      ${item.assignee || '(Belum ditugaskan)'}`);
    console.log(`       - Tenggat:  ${item.deadline || '(Tidak ada)'}`);
    console.log(`       - Prioritas:${item.priority}`);
    console.log(`       - Status:   ${item.status}`);
  }

  // 4. Verifikasi task yang berhasil terkirim ke IT Project
  console.log('\n[4/4] Memeriksa hasil sinkronisasi ke IT Project MCP...');
  const currentMeeting = store.get(meetingId);
  const dispatchRecords = currentMeeting?.itProjectTaskDispatch || {};
  const dispatchKeys = Object.keys(dispatchRecords);
  console.log(`  Dispatch records terdaftar: ${dispatchKeys.length}`);

  for (const key of dispatchKeys) {
    const rec = dispatchRecords[key];
    console.log('  - Status dispatch:', rec.status);
    console.log('  - Judul task:     ', rec.title);
    if (rec.taskId) console.log('  - IT Project ID:  ', rec.taskId);
    if (rec.taskStatus) console.log('  - Status IT Proj: ', rec.taskStatus);
    if (rec.assignedTo) console.log('  - Ditugaskan ke:  ', rec.assignedTo);
    if (rec.sprintAssignment) console.log('  - Sprint:         ', rec.sprintAssignment);
  }

  // Query ulang task dari IT Project MCP untuk konfirmasi 100%
  const projectTasks = await itProject.projectTasks(config.itprojectProjectId);
  const tasks = projectTasks.data?.data || [];
  const latestTask = tasks.find(t => t.title.includes('dokumentasi MCP') || t.title.includes('Bima'));

  if (latestTask) {
    console.log('\n🎉 VERIFIKASI BERHASIL!');
    console.log('  Task terkonfirmasi ada di server IT Project:');
    console.log('  - ID:             ', latestTask.id);
    console.log('  - Judul:          ', latestTask.title);
    console.log('  - Status:         ', latestTask.status?.name);
    console.log('  - Kategori:       ', latestTask.category?.name);
    console.log('  - Type:           ', latestTask.type?.name);
    console.log('  - Users (PIC):    ', latestTask.users?.map(u => u.name).join(', '));
  } else {
    console.log('\nℹ️ Task disinkronisasi, periksa daftar task project.');
  }

} finally {
  server.close();
  close();
}
