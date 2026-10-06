import dotenv from '../server/node_modules/dotenv/lib/main.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../server/.env') });

import db, {
  initDb,
  isDbConnected,
  saveMeeting,
  saveMeetingSummary,
  saveTranscripts,
  saveAttendees,
  getMeetingDetails,
} from '../server/db.js';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';

async function testFlow() {
  console.log('--- TESTING END CALL & SUMMARY FLOW ---');
  await initDb();
  console.log('Database connected:', isDbConnected());

  const config = loadConfig(process.env);
  const { app, store } = createApp(config);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  try {
    // 1. Join call
    console.log('1. Joining room test-flow-room...');
    const tokenRes = await fetch(`${baseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomName: 'test-flow-room',
        employeeId: 'BT-10492',
        employeeName: 'Rafli Aditya',
        department: 'NOC & Core Network',
      }),
    });
    const tokenData = await tokenRes.json();
    console.log('Token response:', tokenRes.status, 'MeetingId:', tokenData.meetingId);

    const meetingId = tokenData.meetingId;
    const token = tokenData.token;
    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };

    // 2. Add transcript lines
    console.log('2. Adding transcripts...');
    await fetch(`${baseUrl}/meetings/${meetingId}/transcript`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        text: 'Halo tim NOC, kami melakukan pengujian kabel fiber optik di site Seminyak.',
      }),
    });
    await fetch(`${baseUrl}/meetings/${meetingId}/transcript`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        text: 'Semua kabel sudah tersambung dengan redaman normal di bawah 0.2 dB.',
      }),
    });

    // 3. Participant LEAVES FIRST (End call first!)
    console.log('3. Leaving call first (End call)...');
    const leaveRes = await fetch(`${baseUrl}/meetings/${meetingId}/leave`, {
      method: 'POST',
      headers: authHeaders,
    });
    const leaveData = await leaveRes.json();
    console.log('Leave response:', leaveRes.status, leaveData);

    // 4. Request summary AFTER leaving
    console.log('4. Requesting summary after call ended...');
    const sumRes = await fetch(`${baseUrl}/meetings/${meetingId}/summarize`, {
      method: 'POST',
      headers: authHeaders,
    });
    const sumData = await sumRes.json();
    console.log('Summarize response status:', sumRes.status);
    console.log('Summarize data dbSummaryId:', sumData.summary?.dbSummaryId);
    console.log('Summarize title:', sumData.summary?.title);

    // 5. Query PostgreSQL database to verify persistence
    console.log('5. Verifying database records in PostgreSQL...');
    const details = await getMeetingDetails(meetingId);
    console.log('DB Details:');
    console.log(' - Meeting:', details?.meeting);
    console.log(' - Transcripts count:', details?.transcripts?.length);
    console.log(' - Attendees count:', details?.attendees?.length);
    console.log(' - Summary:', details?.summary ? {
      id: details.summary.id,
      title: details.summary.title,
      executive_summary: details.summary.executive_summary,
      created_at: details.summary.created_at,
    } : 'NO SUMMARY FOUND IN DB');

    if (details?.summary && details?.transcripts?.length > 0) {
      console.log('🎉 SUCCESS: Both transcripts and summary exist in PostgreSQL database!');
    } else {
      console.error('❌ FAILURE: Missing data in database!');
    }
  } finally {
    server.close();
    process.exit(0);
  }
}

testFlow().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
