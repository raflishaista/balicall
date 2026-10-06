import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Load .env relative to server directory and current directory
const __dbDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dbDir, '.env') });
dotenv.config({ path: join(__dbDir, '../.env') });
dotenv.config();

const { Pool } = pg;

let pool = null;
let isConnected = false;
const standbySchedules = new Map();

export function getPool() {
  const url = process.env.DATABASE_URL || '';
  if (!pool && url) {
    pool = new Pool({
      connectionString: url,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      max: 10,
    });
    pool.on('error', (err) => {
      console.error('[DB] ❌ Unexpected PostgreSQL client error:', err.message);
    });
  }
  return pool;
}

// Attempt initial pool creation if DATABASE_URL is present
getPool();

/**
 * Check if the database connection pool is active and ready
 */
export function isDbConnected() {
  return isConnected;
}

/**
 * Initialize database tables and schema with prefix `balicall_`
 * Does NOT require CREATE DATABASE permission, only table DDL in jds3_db.public.
 */
export async function initDb(customUrl) {
  if (customUrl && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = customUrl;
  }
  const activePool = getPool();
  if (!activePool) {
    console.log('[DB] ℹ️ Skipping database initialization (no DATABASE_URL configured).');
    return false;
  }

  try {
    const client = await activePool.connect();
    try {
      const res = await client.query('SELECT current_user, current_database(), NOW() as server_time');
      const info = res.rows[0];
      console.log(`[DB] 🟢 Connected to PostgreSQL as "${info.current_user}" on database "${info.current_database}"`);
      console.log(`[DB] 🕒 Server Time: ${info.server_time}`);

      // 1. Create balicall_meetings table
      await client.query(`
        CREATE TABLE IF NOT EXISTS balicall_meetings (
          id VARCHAR(64) PRIMARY KEY,
          room_name VARCHAR(128) NOT NULL,
          status VARCHAR(32) DEFAULT 'active',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          ended_at TIMESTAMP WITH TIME ZONE
        );
      `);

      // 2. Create balicall_summaries table
      await client.query(`
        CREATE TABLE IF NOT EXISTS balicall_summaries (
          id SERIAL PRIMARY KEY,
          meeting_id VARCHAR(64) REFERENCES balicall_meetings(id) ON DELETE CASCADE,
          room_name VARCHAR(128) NOT NULL,
          title TEXT,
          executive_summary TEXT,
          key_discussion_points JSONB,
          decisions JSONB,
          action_items JSONB,
          attendance_summary JSONB,
          provider VARCHAR(64),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      // 3. Create balicall_transcripts table (individual dialogue lines)
      await client.query(`
        CREATE TABLE IF NOT EXISTS balicall_transcripts (
          id VARCHAR(64) PRIMARY KEY,
          meeting_id VARCHAR(64) REFERENCES balicall_meetings(id) ON DELETE CASCADE,
          room_name VARCHAR(128) NOT NULL,
          speaker_id VARCHAR(64),
          speaker_name VARCHAR(128),
          text TEXT NOT NULL,
          timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      // 4. Create balicall_attendees table (attendance roster)
      await client.query(`
        CREATE TABLE IF NOT EXISTS balicall_attendees (
          id SERIAL PRIMARY KEY,
          meeting_id VARCHAR(64) REFERENCES balicall_meetings(id) ON DELETE CASCADE,
          employee_id VARCHAR(64) NOT NULL,
          employee_name VARCHAR(128) NOT NULL,
          department VARCHAR(64),
          joined_at TIMESTAMP WITH TIME ZONE,
          left_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          CONSTRAINT unique_meeting_employee UNIQUE (meeting_id, employee_id)
        );
      `);

      // 5. Create balicall_employees table (authorized employees directory)
      await client.query(`
        CREATE TABLE IF NOT EXISTS balicall_employees (
          employee_id VARCHAR(32) PRIMARY KEY,
          name VARCHAR(128) NOT NULL,
          email VARCHAR(128) UNIQUE,
          department VARCHAR(64) NOT NULL,
          position VARCHAR(64) NOT NULL,
          status VARCHAR(32) DEFAULT 'active',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      // Seed mock employees if none exist
      await client.query(`
        INSERT INTO balicall_employees (employee_id, name, email, department, position, status)
        VALUES
          ('BT-10492', 'Rafli Aditya', 'rafli.aditya@balitower.co.id', 'NOC & Core Network', 'Network Operations Engineer', 'active'),
          ('BT-10214', 'Budi Santoso', 'budi.santoso@balitower.co.id', 'Field Transmission', 'Transmission Field Specialist', 'active'),
          ('BT-10883', 'Siti Rahma', 'siti.rahma@balitower.co.id', 'Project Management', 'Project Coordinator', 'active'),
          ('BT-10550', 'Agus Pratama', 'agus.pratama@balitower.co.id', 'Fiber Infrastructure', 'Fiber Optic Splicing Lead', 'active'),
          ('BT-10101', 'Eko Prasetyo', 'eko.prasetyo@balitower.co.id', 'Tower Maintenance', 'Site Inspector', 'active'),
          ('BT-10332', 'Dewi Lestari', 'dewi.lestari@balitower.co.id', 'Radio Frequency', 'RF Planning & Optimization', 'active'),
          ('BT-10771', 'Hendra Wijaya', 'hendra.wijaya@balitower.co.id', 'Power & Electrical', 'Power & Genset Technician', 'active'),
          ('BT-10999', 'Linda Kusuma', 'linda.kusuma@balitower.co.id', 'IT Security & NOC', 'Security Operations Analyst', 'active')
        ON CONFLICT (employee_id) DO NOTHING;
      `);

      // 6. Create balicall_schedules table (meeting scheduling & calendar)
      await client.query(`
        CREATE TABLE IF NOT EXISTS balicall_schedules (
          id VARCHAR(128) PRIMARY KEY,
          room_name VARCHAR(128) NOT NULL,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          host_id VARCHAR(64) NOT NULL,
          host_name VARCHAR(128) NOT NULL,
          department VARCHAR(128),
          scheduled_start TIMESTAMP WITH TIME ZONE NOT NULL,
          scheduled_end TIMESTAMP WITH TIME ZONE NOT NULL,
          status VARCHAR(32) DEFAULT 'scheduled',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      // 7. Create performance indexes
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_balicall_summaries_meeting ON balicall_summaries(meeting_id);
        CREATE INDEX IF NOT EXISTS idx_balicall_summaries_room ON balicall_summaries(room_name);
        CREATE INDEX IF NOT EXISTS idx_balicall_transcripts_meeting ON balicall_transcripts(meeting_id);
        CREATE INDEX IF NOT EXISTS idx_balicall_attendees_meeting ON balicall_attendees(meeting_id);
        CREATE INDEX IF NOT EXISTS idx_balicall_employees_dept ON balicall_employees(department);
        CREATE INDEX IF NOT EXISTS idx_balicall_schedules_start ON balicall_schedules(scheduled_start);
        CREATE INDEX IF NOT EXISTS idx_balicall_schedules_room ON balicall_schedules(room_name);
      `);

      isConnected = true;
      console.log('[DB] ✅ Balicall database schema (employees, meetings, summaries, transcripts, attendees, schedules) verified successfully.');
      return true;
    } finally {
      client.release();
    }
  } catch (err) {
    isConnected = false;
    console.error('[DB] ❌ Database connection / migration error:', err.message);
    if (err.code === '28P01') {
      console.error('[DB] 👉 Tip: Password authentication failed. Check your password in server/.env DATABASE_URL');
    }
    return false;
  }
}

/**
 * Upsert meeting record
 */
export async function saveMeeting(meeting) {
  const activePool = getPool();
  if (!activePool || !isConnected) return null;
  const status = meeting.status || 'active';
  const endedAt = meeting.endedAt || (status === 'ended' ? new Date().toISOString() : null);
  const query = `
    INSERT INTO balicall_meetings (id, room_name, status, created_at, ended_at)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      ended_at = COALESCE(EXCLUDED.ended_at, balicall_meetings.ended_at)
    RETURNING *;
  `;
  try {
    const res = await activePool.query(query, [
      meeting.id,
      meeting.roomName,
      status,
      meeting.createdAt || new Date().toISOString(),
      endedAt,
    ]);
    return res.rows[0];
  } catch (err) {
    console.error(`[DB] ❌ Failed to save meeting ${meeting.id}:`, err.message);
    return null;
  }
}

/**
 * Insert structured AI meeting summary
 */
export async function saveMeetingSummary(meetingId, roomName, summary) {
  const activePool = getPool();
  if (!activePool || !isConnected) return null;
  const query = `
    INSERT INTO balicall_summaries (
      meeting_id,
      room_name,
      title,
      executive_summary,
      key_discussion_points,
      decisions,
      action_items,
      attendance_summary,
      provider,
      created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
    RETURNING *;
  `;

  try {
    const res = await activePool.query(query, [
      meetingId,
      roomName,
      summary.title || `Meeting: ${roomName}`,
      summary.executiveSummary || '',
      JSON.stringify(summary.keyDiscussionPoints || []),
      JSON.stringify(summary.decisions || []),
      JSON.stringify(summary.actionItems || []),
      JSON.stringify(summary.attendanceSummary || []),
      summary.provider || 'AI Secretary',
    ]);
    console.log(`[DB] 💾 Meeting summary persisted for room "${roomName}" (ID: ${res.rows[0].id})`);
    return res.rows[0];
  } catch (err) {
    console.error(`[DB] ❌ Failed to save meeting summary for ${meetingId}:`, err.message);
    return null;
  }
}

/**
 * Batch save dialogue transcripts with deduplication
 */
export async function saveTranscripts(meetingId, roomName, transcripts) {
  const activePool = getPool();
  if (!activePool || !isConnected || !transcripts || transcripts.length === 0) return [];
  
  const client = await activePool.connect();
  try {
    await client.query('BEGIN');
    const insertQuery = `
      INSERT INTO balicall_transcripts (id, meeting_id, room_name, speaker_id, speaker_name, text, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO NOTHING;
    `;

    for (const t of transcripts) {
      const id = t.id || `tx-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const timestamp = t.timestamp ? new Date(t.timestamp).toISOString() : new Date().toISOString();
      await client.query(insertQuery, [
        id,
        meetingId,
        roomName,
        t.speakerId || 'unknown',
        t.speakerName || 'Anonymous',
        t.text,
        timestamp,
      ]);
    }
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`[DB] ❌ Failed to save transcripts for ${meetingId}:`, err.message);
    return false;
  } finally {
    client.release();
  }
}

/**
 * Upsert meeting attendees into attendance roster
 */
export async function saveAttendees(meetingId, attendees) {
  const activePool = getPool();
  if (!activePool || !isConnected || !attendees || attendees.length === 0) return [];

  const query = `
    INSERT INTO balicall_attendees (meeting_id, employee_id, employee_name, department, joined_at, left_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (meeting_id, employee_id) DO UPDATE SET
      left_at = EXCLUDED.left_at,
      department = COALESCE(EXCLUDED.department, balicall_attendees.department);
  `;

  try {
    for (const att of attendees) {
      await activePool.query(query, [
        meetingId,
        att.employeeId || att.id,
        att.employeeName || att.name || 'Anonymous',
        att.department || 'General',
        att.joinedAt || new Date().toISOString(),
        att.leftAt || null,
      ]);
    }
    return true;
  } catch (err) {
    console.error(`[DB] ❌ Failed to save attendees for ${meetingId}:`, err.message);
    return false;
  }
}

/**
 * Retrieve recent saved meeting summaries from PostgreSQL
 */
export async function getMeetingSummaries(limit = 20) {
  const activePool = getPool();
  if (!activePool || !isConnected) return [];

  const query = `
    SELECT 
      s.id,
      s.meeting_id,
      s.room_name,
      s.title,
      s.executive_summary,
      s.key_discussion_points,
      s.decisions,
      s.action_items,
      s.attendance_summary,
      s.provider,
      s.created_at,
      m.created_at as meeting_created_at,
      m.ended_at as meeting_ended_at,
      m.status as meeting_status
    FROM balicall_summaries s
    LEFT JOIN balicall_meetings m ON s.meeting_id = m.id
    ORDER BY s.created_at DESC
    LIMIT $1;
  `;

  try {
    const res = await activePool.query(query, [limit]);
    return res.rows;
  } catch (err) {
    console.error('[DB] ❌ Failed to fetch meeting summaries:', err.message);
    return [];
  }
}

/**
 * Retrieve comprehensive meeting record with summary, transcripts, and attendees
 */
export async function getMeetingDetails(meetingId) {
  const activePool = getPool();
  if (!activePool || !isConnected) return null;

  try {
    const meetingRes = await activePool.query('SELECT * FROM balicall_meetings WHERE id = $1', [meetingId]);
    if (meetingRes.rows.length === 0) return null;

    const summaryRes = await activePool.query('SELECT * FROM balicall_summaries WHERE meeting_id = $1 ORDER BY created_at DESC LIMIT 1', [meetingId]);
    const transcriptsRes = await activePool.query('SELECT * FROM balicall_transcripts WHERE meeting_id = $1 ORDER BY timestamp ASC', [meetingId]);
    const attendeesRes = await activePool.query('SELECT * FROM balicall_attendees WHERE meeting_id = $1 ORDER BY joined_at ASC', [meetingId]);

    return {
      meeting: meetingRes.rows[0],
      summary: summaryRes.rows[0] || null,
      transcripts: transcriptsRes.rows,
      attendees: attendeesRes.rows,
    };
  } catch (err) {
    console.error(`[DB] ❌ Failed to fetch meeting details for ${meetingId}:`, err.message);
    return null;
  }
}

/**
 * Standard preset list of Bali Tower employees
 */
export const DEFAULT_EMPLOYEE_PRESETS = [
  { employee_id: 'BT-10492', name: 'Rafli Aditya', department: 'NOC & Core Network', position: 'Network Operations Engineer', status: 'active' },
  { employee_id: 'BT-10214', name: 'Budi Santoso', department: 'Field Transmission', position: 'Transmission Field Specialist', status: 'active' },
  { employee_id: 'BT-10883', name: 'Siti Rahma', department: 'Project Management', position: 'Project Coordinator', status: 'active' },
  { employee_id: 'BT-10550', name: 'Agus Pratama', department: 'Fiber Infrastructure', position: 'Fiber Optic Splicing Lead', status: 'active' },
  { employee_id: 'BT-10101', name: 'Eko Prasetyo', department: 'Tower Maintenance', position: 'Site Inspector', status: 'active' },
  { employee_id: 'BT-10332', name: 'Dewi Lestari', department: 'Radio Frequency', position: 'RF Planning & Optimization', status: 'active' },
  { employee_id: 'BT-10771', name: 'Hendra Wijaya', department: 'Power & Electrical', position: 'Power & Genset Technician', status: 'active' },
  { employee_id: 'BT-10999', name: 'Linda Kusuma', department: 'IT Security & NOC', position: 'Security Operations Analyst', status: 'active' },
];

/**
 * Fetch employee details by ID from PostgreSQL
 */
export async function getEmployeeById(employeeId) {
  const activePool = getPool();
  if (!activePool || !isConnected || !employeeId) return null;
  try {
    const res = await activePool.query(
      'SELECT employee_id, name, email, department, position, status FROM balicall_employees WHERE employee_id = $1',
      [employeeId.trim()]
    );
    return res.rows[0] || null;
  } catch (err) {
    console.error(`[DB] ❌ Failed to fetch employee ${employeeId}:`, err.message);
    return null;
  }
}

/**
 * Official Bali Tower Employee ID format: 'BT-' followed by 4 to 6 digits (e.g. BT-10492)
 */
export const EMPLOYEE_ID_REGEX = /^BT-\d{4,6}$/i;

export function isValidEmployeeIdFormat(id) {
  if (!id || typeof id !== 'string') return false;
  return EMPLOYEE_ID_REGEX.test(id.trim());
}

/**
 * Verify whether an employee ID exists and is active in the company database
 */
export async function verifyEmployeeId(employeeId) {
  const cleanId = (employeeId || '').trim();
  if (!cleanId) {
    return { checked: true, valid: false, reason: 'Empty employee ID' };
  }

  // 0. Format Validation Check (Rejects non-ID text such as "ns-12nsunauu")
  if (!isValidEmployeeIdFormat(cleanId)) {
    return {
      checked: true,
      valid: false,
      formatError: true,
      reason: 'Format ID Salah.',
      employee: null,
    };
  }

  // Path 1: Database is connected - check authoritative PostgreSQL balicall_employees table
  const activePool = getPool();
  if (activePool && isConnected) {
    const emp = await getEmployeeById(cleanId);
    if (!emp) {
      return { checked: true, valid: false, reason: 'Employee ID not found in database', employee: null };
    }
    if (emp.status && emp.status.toLowerCase() !== 'active') {
      return { checked: true, valid: false, inactive: true, reason: 'Employee status is inactive', employee: emp };
    }
    return { checked: true, valid: true, employee: emp };
  }

  // Path 2: Standby mode (DB disconnected/offline) - validate against known Bali Tower preset personas
  const match = DEFAULT_EMPLOYEE_PRESETS.find(p => p.employee_id.toUpperCase() === cleanId.toUpperCase());
  if (match) {
    return { checked: false, valid: true, standby: true, employee: match };
  }

  return { checked: false, valid: false, standby: true, reason: 'Employee ID not recognized in standby roster', employee: null };
}

/**
 * Get list of all active registered employees
 */
export async function getAllEmployees() {
  const activePool = getPool();
  if (activePool && isConnected) {
    try {
      const res = await activePool.query(
        'SELECT employee_id, name, email, department, position, status FROM balicall_employees WHERE status = $1 ORDER BY employee_id ASC',
        ['active']
      );
      return res.rows;
    } catch (err) {
      console.error('[DB] ❌ Failed to fetch employees list:', err.message);
    }
  }
  return DEFAULT_EMPLOYEE_PRESETS;
}

/**
 * Create a new scheduled meeting in PostgreSQL or standby store
 */
export async function createSchedule(schedule) {
  const {
    id = `sched-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    roomName,
    title,
    description = '',
    hostId = '',
    hostName = 'Penyelenggara BaliCall',
    department = 'General',
    scheduledStart,
    scheduledEnd,
  } = schedule;

  const activePool = getPool();
  if (activePool && isConnected) {
    const query = `
      INSERT INTO balicall_schedules (
        id, room_name, title, description, host_id, host_name, department,
        scheduled_start, scheduled_end, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'scheduled', NOW())
      RETURNING *;
    `;
    try {
      const res = await activePool.query(query, [
        id,
        roomName,
        title,
        description,
        hostId,
        hostName,
        department,
        new Date(scheduledStart).toISOString(),
        new Date(scheduledEnd).toISOString(),
      ]);
      const row = res.rows[0];
      return {
        id: row.id,
        roomName: row.room_name,
        title: row.title,
        description: row.description,
        hostId: row.host_id,
        hostName: row.host_name,
        department: row.department,
        scheduledStart: row.scheduled_start,
        scheduledEnd: row.scheduled_end,
        status: row.status,
        createdAt: row.created_at,
      };
    } catch (err) {
      console.error('[DB] ❌ Failed to insert schedule into PostgreSQL:', err.message);
    }
  }

  // Fallback / Standby in-memory store
  const record = {
    id,
    roomName,
    title,
    description,
    hostId,
    hostName,
    department,
    scheduledStart: new Date(scheduledStart).toISOString(),
    scheduledEnd: new Date(scheduledEnd).toISOString(),
    status: 'scheduled',
    createdAt: new Date().toISOString(),
  };
  standbySchedules.set(id, record);
  return record;
}

/**
 * Get all upcoming and active scheduled meetings
 */
export async function getUpcomingSchedules() {
  const activePool = getPool();
  if (activePool && isConnected) {
    try {
      const res = await activePool.query(`
        SELECT id, room_name, title, description, host_id, host_name, department,
               scheduled_start, scheduled_end, status, created_at
        FROM balicall_schedules
        WHERE status != 'cancelled'
          AND scheduled_end >= (NOW() - INTERVAL '2 hours')
        ORDER BY scheduled_start ASC;
      `);
      return res.rows.map(row => ({
        id: row.id,
        roomName: row.room_name,
        title: row.title,
        description: row.description,
        hostId: row.host_id,
        hostName: row.host_name,
        department: row.department,
        scheduledStart: row.scheduled_start,
        scheduledEnd: row.scheduled_end,
        status: row.status,
        createdAt: row.created_at,
      }));
    } catch (err) {
      console.error('[DB] ❌ Failed to fetch schedules from PostgreSQL:', err.message);
    }
  }

  // Standby in-memory store fallback
  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  return [...standbySchedules.values()]
    .filter(s => s.status !== 'cancelled' && Date.parse(s.scheduledEnd) >= twoHoursAgo)
    .sort((a, b) => Date.parse(a.scheduledStart) - Date.parse(b.scheduledStart));
}

/**
 * Cancel a scheduled meeting
 */
export async function cancelSchedule(id) {
  const activePool = getPool();
  if (activePool && isConnected) {
    try {
      const res = await activePool.query(
        `UPDATE balicall_schedules SET status = 'cancelled' WHERE id = $1 RETURNING *`,
        [id]
      );
      if (res.rows.length > 0) return true;
    } catch (err) {
      console.error(`[DB] ❌ Failed to cancel schedule ${id} in PostgreSQL:`, err.message);
    }
  }

  if (standbySchedules.has(id)) {
    const item = standbySchedules.get(id);
    item.status = 'cancelled';
    return true;
  }
  return false;
}

export { pool };

export default {
  pool,
  isDbConnected,
  initDb,
  saveMeeting,
  saveMeetingSummary,
  saveTranscripts,
  saveAttendees,
  getMeetingSummaries,
  getMeetingDetails,
  getEmployeeById,
  verifyEmployeeId,
  getAllEmployees,
  isValidEmployeeIdFormat,
  EMPLOYEE_ID_REGEX,
  DEFAULT_EMPLOYEE_PRESETS,
  createSchedule,
  getUpcomingSchedules,
  cancelSchedule,
};
