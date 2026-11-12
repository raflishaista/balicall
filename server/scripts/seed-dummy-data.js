/**
 * BaliCall Dummy Data Seeder for Admin Dashboard Testing
 * Run: node scripts/seed-dummy-data.js
 */
import { getPool, initDb } from '../db.js';
import { initAuthDb, hashToken } from '../authStore.js';
import { PgAdminStore } from '../adminStore.js';
import { hashPassword } from '../auth.js';

const pool = getPool();

const DUMMY_PASSWORD = 'BaliCallSuperAdmin2026!'; // 23 chars, satisfies 15-128 chars constraint

const MOCK_EMPLOYEES = [
  { id: 'BT-10492', name: 'Rafli Aditya', email: 'rafli.aditya@balitower.co.id', dept: 'AI & Computer Vision', pos: 'AI Research Lead', status: 'active', admin: true },
  { id: 'BT-10214', name: 'Budi Santoso', email: 'budi.santoso@balitower.co.id', dept: 'Field Transmission', pos: 'Transmission Field Specialist', status: 'active', admin: false },
  { id: 'BT-10883', name: 'Siti Rahma', email: 'siti.rahma@balitower.co.id', dept: 'Project Management', pos: 'Project Coordinator', status: 'active', admin: false },
  { id: 'BT-10550', name: 'Agus Pratama', email: 'agus.pratama@balitower.co.id', dept: 'Fiber Infrastructure', pos: 'Fiber Optic Splicing Lead', status: 'active', admin: false },
  { id: 'BT-10101', name: 'Eko Prasetyo', email: 'eko.prasetyo@balitower.co.id', dept: 'Tower Maintenance', pos: 'Site Inspector', status: 'inactive', admin: false },
  { id: 'BT-10332', name: 'Dewi Lestari', email: 'dewi.lestari@balitower.co.id', dept: 'Radio Frequency', pos: 'RF Planning & Optimization', status: 'active', admin: false },
  { id: 'BT-10771', name: 'Hendra Wijaya', email: 'hendra.wijaya@balitower.co.id', dept: 'Power & Electrical', pos: 'Power & Genset Technician', status: 'active', admin: false },
  { id: 'BT-10999', name: 'Linda Kusuma', email: 'linda.kusuma@balitower.co.id', dept: 'IT Security & NOC', pos: 'Security Operations Analyst', status: 'active', admin: false },
  { id: 'BT-11002', name: 'Fais Salman', email: 'fais.salman@balitower.co.id', dept: 'AI & Computer Vision', pos: 'Machine Learning Engineer', status: 'active', admin: false },
  { id: 'BT-11003', name: 'Christoporus Deo Putratama', email: 'deo.putratama@balitower.co.id', dept: 'AI & Computer Vision', pos: 'Computer Vision Engineer', status: 'active', admin: false },
  { id: 'BT-11004', name: 'Arka Hamzah', email: 'arka.hamzah@balitower.co.id', dept: 'AI & Computer Vision', pos: 'Data Engineer', status: 'active', admin: false },
  { id: 'BT-99001', name: 'Akun Uji BaliCall', email: 'qa.balicall@example.test', dept: 'IT Operations', pos: 'Testing Lead', status: 'active', admin: true },
];

const MOCK_MEETINGS = [
  {
    id: 'meet-cv-standup-06',
    title: 'Standup AI Computer Vision 06 Nov',
    status: 'ended',
    createdMinutesAgo: 60 * 24 * 2,
    endedMinutesAgo: 60 * 24 * 2 - 45,
    attendees: ['BT-10492', 'BT-11002', 'BT-11003', 'BT-11004'],
  },
  {
    id: 'meet-noc-weekly-sync',
    title: 'NOC & Core Weekly Incident Review',
    status: 'ended',
    createdMinutesAgo: 60 * 24 * 3,
    endedMinutesAgo: 60 * 24 * 3 - 60,
    attendees: ['BT-10492', 'BT-10999', 'BT-10214'],
  },
  {
    id: 'meet-fiber-expansion-q4',
    title: 'Perencanaan Ekspansi Fiber Optic Jabodetabek',
    status: 'active',
    createdMinutesAgo: 25,
    endedMinutesAgo: null,
    attendees: ['BT-10550', 'BT-10883'],
  },
];

const MOCK_SCHEDULES = [
  {
    id: 'sched-tower-coloc-01',
    title: 'Audit Kolokasi Tower Regional 2',
    hostId: 'BT-10101',
    hostName: 'Eko Prasetyo',
    status: 'active',
    startInHours: 4,
    durationHours: 1,
  },
  {
    id: 'sched-ai-sprint-review',
    title: 'Sprint Review & Demo Model YOLOv12',
    hostId: 'BT-10492',
    hostName: 'Rafli Aditya',
    status: 'active',
    startInHours: 28,
    durationHours: 2,
  },
];

const MOCK_RECORDINGS = [
  {
    id: 'rec-standup-cv-06',
    ownerId: 'BT-10492',
    fileSize: 48500000, // ~48.5 MB
    duration: 2700,
  },
  {
    id: 'rec-noc-weekly-03',
    ownerId: 'BT-10999',
    fileSize: 92400000, // ~92.4 MB
    duration: 3600,
  },
];

async function seed() {
  if (!pool) {
    console.error('❌ DATABASE_URL tidak dikonfigurasi di server/.env.');
    process.exit(1);
  }

  console.log('🔄 Memulai inisialisasi schema tabel BaliCall...');
  const ready = await initDb();
  if (!ready) {
    console.error('❌ Gagal terhubung ke database.');
    process.exit(1);
  }

  await initAuthDb(pool);
  console.log('✅ Skema tabel balicall_* & auth/admin berhasil diverifikasi.');

  console.log('🔄 Menyiapkan password hash untuk akun...');
  const passwordHash = await hashPassword(DUMMY_PASSWORD);

  // 1. Seed Employees & Auth Accounts
  console.log('🔄 Menyemai data karyawan & akun login...');
  for (const emp of MOCK_EMPLOYEES) {
    await pool.query(`
      INSERT INTO balicall_employees (employee_id, name, email, department, position, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (employee_id) DO UPDATE SET
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        department = EXCLUDED.department,
        position = EXCLUDED.position,
        status = EXCLUDED.status
    `, [emp.id, emp.name, emp.email, emp.dept, emp.pos, emp.status]);

    await pool.query(`
      INSERT INTO balicall_auth_accounts (employee_id, login_email, password_hash)
      VALUES ($1, $2, $3)
      ON CONFLICT (employee_id) DO UPDATE SET
        login_email = EXCLUDED.login_email,
        password_hash = COALESCE(balicall_auth_accounts.password_hash, EXCLUDED.password_hash)
    `, [emp.id, emp.email.toLowerCase(), emp.status === 'active' ? passwordHash : null]);

    if (emp.admin) {
      await pool.query(`
        INSERT INTO balicall_admin_roles (employee_id, role)
        VALUES ($1, 'super_admin')
        ON CONFLICT (employee_id) DO NOTHING
      `, [emp.id]);
    }
  }

  // 2. Seed Meetings & Attendees
  console.log('🔄 Menyemai data rapat & peserta...');
  for (const m of MOCK_MEETINGS) {
    await pool.query(`
      INSERT INTO balicall_meetings (id, room_name, status, created_at, ended_at)
      VALUES ($1, $2, $3, NOW() - ($4 || ' minutes')::interval, CASE WHEN $5::int IS NULL THEN NULL ELSE NOW() - ($5 || ' minutes')::interval END)
      ON CONFLICT (id) DO UPDATE SET
        room_name = EXCLUDED.room_name,
        status = EXCLUDED.status,
        created_at = EXCLUDED.created_at,
        ended_at = EXCLUDED.ended_at
    `, [m.id, m.title, m.status, m.createdMinutesAgo, m.endedMinutesAgo]);

    for (const attId of m.attendees) {
      await pool.query(`
        INSERT INTO balicall_attendees (meeting_id, employee_id, name, joined_at)
        SELECT $1, $2, name, NOW() - ($3 || ' minutes')::interval
        FROM balicall_employees WHERE employee_id = $2
        ON CONFLICT DO NOTHING
      `, [m.id, attId, m.createdMinutesAgo]);
    }
  }

  // 3. Seed Schedules
  console.log('🔄 Menyemai data jadwal rapat...');
  for (const s of MOCK_SCHEDULES) {
    await pool.query(`
      INSERT INTO balicall_schedules (id, room_name, host_id, host_name, status, scheduled_start, scheduled_end)
      VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' hours')::interval, NOW() + (($6 + $7) || ' hours')::interval)
      ON CONFLICT (id) DO UPDATE SET
        room_name = EXCLUDED.room_name,
        host_id = EXCLUDED.host_id,
        host_name = EXCLUDED.host_name,
        status = EXCLUDED.status,
        scheduled_start = EXCLUDED.scheduled_start,
        scheduled_end = EXCLUDED.scheduled_end
    `, [s.id, s.title, s.hostId, s.hostName, s.status, s.startInHours, s.durationHours]);
  }

  // 4. Seed Recording Uploads
  console.log('🔄 Menyemai data rekaman terunggah...');
  for (const r of MOCK_RECORDINGS) {
    await pool.query(`
      INSERT INTO balicall_recording_uploads (id, owner_id, file_size, duration, created_at)
      VALUES ($1, $2, $3, $4, NOW() - interval '2 days')
      ON CONFLICT (id) DO NOTHING
    `, [r.id, r.ownerId, r.fileSize, r.duration]);
  }

  // 5. Seed Audit Entries
  console.log('🔄 Menyemai catatan audit admin...');
  await pool.query(`
    INSERT INTO balicall_admin_audit (actor_id, target_id, action, result, previous_value, new_value, reason, occurred_at)
    VALUES
      (NULL, 'BT-10492', 'admin.bootstrap', 'succeeded', NULL, 'super_admin', NULL, NOW() - interval '3 days'),
      ('BT-10492', 'BT-99001', 'admin.grant', 'succeeded', 'none', 'super_admin', NULL, NOW() - interval '2 days'),
      ('BT-10492', 'BT-10101', 'account.status.change', 'succeeded', 'active', 'inactive', 'Cuti panjang / mutasi', NOW() - interval '1 day')
    ON CONFLICT DO NOTHING
  `);

  console.log('\n======================================================');
  console.log('🎉 Data dummy berhasil disemai ke PostgreSQL!');
  console.log('======================================================');
  console.log('Detail Akun Super Admin untuk masuk ke Dashboard:');
  console.log('  Email       : rafli.aditya@balitower.co.id (atau qa.balicall@example.test)');
  console.log(`  Password    : ${DUMMY_PASSWORD}`);
  console.log('  URL Dashboard: http://localhost:5187/#/admin');
  console.log('======================================================\n');
}

seed().catch(err => {
  console.error('❌ Terjadi kesalahan saat seeding:', err);
  process.exitCode = 1;
}).finally(() => {
  pool?.end();
});
