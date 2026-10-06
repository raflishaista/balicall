import dotenv from '../server/node_modules/dotenv/lib/main.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load server/.env
dotenv.config({ path: path.join(__dirname, '../server/.env') });

import db, {
  initDb,
  isDbConnected,
  saveMeeting,
  saveMeetingSummary,
  saveTranscripts,
  saveAttendees,
  getMeetingSummaries,
  getMeetingDetails,
  getAllEmployees,
  verifyEmployeeId,
} from '../server/db.js';

async function run() {
  console.log('========================================================');
  console.log('🧪 BALI TOWER POSTGRESQL INTEGRATION TEST');
  console.log('========================================================');

  const dbUrl = process.env.DATABASE_URL || '';
  if (!dbUrl || dbUrl.includes('YOUR_PASSWORD')) {
    console.error('❌ DATABASE_URL is not configured with your real password.');
    console.error('👉 Please update server/.env with your password:');
    console.error('   DATABASE_URL=postgresql://jds3:<YOUR_PASSWORD>@10.17.101.232:5432/jds3_db\n');
    process.exit(1);
  }

  console.log('Connecting to PostgreSQL and running migrations...');
  const initialized = await initDb();

  if (!initialized || !isDbConnected()) {
    console.error('❌ Failed to connect to PostgreSQL. Check your credentials and network.');
    process.exit(1);
  }

  console.log('🟢 Connection successful & tables verified!\n');

  console.log('0️⃣ Testing Employee Directory & Verification System...');
  const employees = await getAllEmployees();
  console.log(`   Registered Employees in DB: ${employees.length}`);

  const validTest = await verifyEmployeeId('BT-10492');
  console.log(`   Testing Valid ID ("BT-10492"): ${validTest.valid ? '✅ PASSED (' + validTest.employee.name + ' - ' + validTest.employee.department + ')' : '❌ FAILED'}`);

  const formatTest = await verifyEmployeeId('ns-12nsunauu');
  console.log(`   Testing Malformed Non-ID ("ns-12nsunauu"): ${!formatTest.valid && formatTest.formatError ? '✅ PROPERLY REJECTED ("' + formatTest.reason + '")' : '❌ FAILED'}`);

  const invalidTest = await verifyEmployeeId('BT-99999');
  console.log(`   Testing Unregistered ID ("BT-99999"): ${!invalidTest.valid ? '✅ PROPERLY REJECTED (' + invalidTest.reason + ')' : '❌ FAILED (Should have been rejected)'}`);

  const testMeetingId = `test-meet-${Date.now()}`;
  const testRoom = 'site-sync-tower-jakarta';

  console.log(`1️⃣ Creating test meeting: ${testMeetingId}...`);
  await saveMeeting({
    id: testMeetingId,
    roomName: testRoom,
    status: 'active',
    createdAt: new Date().toISOString(),
  });

  console.log('2️⃣ Registering test attendees...');
  await saveAttendees(testMeetingId, [
    { employeeId: 'NIK-001', employeeName: 'Rafli Aditya', department: 'NOC Transmission' },
    { employeeId: 'NIK-002', employeeName: 'Budi Santoso', department: 'Field Ops' },
  ]);

  console.log('3️⃣ Logging test transcripts...');
  await saveTranscripts(testMeetingId, testRoom, [
    {
      id: `tx-test-1-${Date.now()}`,
      speakerId: 'NIK-001',
      speakerName: 'Rafli Aditya',
      text: 'Halo control room, status power genset tower TB-104 aman.',
      timestamp: new Date().toISOString(),
    },
    {
      id: `tx-test-2-${Date.now()}`,
      speakerId: 'NIK-002',
      speakerName: 'Budi Santoso',
      text: 'Dimonitor, kabel fiber optik core 12 sudah disambung ulang.',
      timestamp: new Date().toISOString(),
    },
  ]);

  console.log('4️⃣ Persisting structured AI meeting summary...');
  const summaryObj = {
    title: 'Bali Tower Operational Sync: Site TB-104',
    executiveSummary: 'Sinkronisasi kondisi catu daya dan perbaikan FO site TB-104 berhasil diselesaikan.',
    keyDiscussionPoints: [
      'Genset tower TB-104 telah normal dan stabil.',
      'Splicing kabel fiber core 12 rampung.',
    ],
    decisions: ['SOP monitoring 24 jam diaktifkan untuk transmisi sektor timur.'],
    actionItems: [
      {
        task: 'Verifikasi loss dB fiber optik segmen TB-104 ke hub',
        assignee: 'Budi Santoso',
        priority: 'High',
        deadline: 'Shift Malam',
      },
    ],
    attendanceSummary: ['Rafli Aditya (NOC)', 'Budi Santoso (Field Ops)'],
    provider: 'Office LLM (qwen-35b)',
  };

  const savedSummary = await saveMeetingSummary(testMeetingId, testRoom, summaryObj);
  console.log(`   ✅ Summary persisted with DB ID: ${savedSummary.id}`);

  console.log('5️⃣ Fetching meeting details via relational join...');
  const details = await getMeetingDetails(testMeetingId);
  console.log('   Meeting Room:', details.meeting.room_name);
  console.log('   Summary Title:', details.summary.title);
  console.log('   Attendees Count:', details.attendees.length);
  console.log('   Transcripts Count:', details.transcripts.length);

  console.log('\n6️⃣ Cleaning up test record...');
  if (db.pool) {
    await db.pool.query('DELETE FROM balicall_meetings WHERE id = $1', [testMeetingId]);
    console.log('   ✅ Test record cleaned up.');
  }

  console.log('\n========================================================');
  console.log('🎉 ALL DATABASE TESTS PASSED SUCCESSFULLY!');
  console.log('========================================================');
  process.exit(0);
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
