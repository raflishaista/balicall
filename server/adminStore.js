import { getPool } from './db.js';
import { issueActivationInvite } from './authStore.js';

export const AdminPermission = Object.freeze({
  MANAGE_ACCOUNTS: 'accounts:manage',
  READ_MEETINGS: 'meetings:read',
  READ_SYSTEM: 'system:read',
  READ_AUDIT: 'audit:read',
  READ_RECORDINGS: 'recordings:read',
});
const superAdminPermissions = Object.freeze(Object.values(AdminPermission));
const EMPLOYEE_PAGE_SIZE = 20;
const AUDIT_PAGE_SIZE = 50;
const MEETING_HISTORY_PAGE_SIZE = 20;
const RECORDING_PAGE_SIZE = 20;
export const validAdminEmployeeId = value =>
  typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,31}$/i.test(value);

async function isActiveSuperAdmin(client, employeeId) {
  const { rows } = await client.query(`
    SELECT 1 FROM balicall_admin_roles r
    JOIN balicall_auth_accounts a USING (employee_id)
    JOIN balicall_employees e USING (employee_id)
    WHERE r.employee_id=$1 AND r.role='super_admin'
      AND e.status='active' AND a.password_hash IS NOT NULL
  `, [employeeId]);
  return rows.length > 0;
}

async function accountForUpdate(client, employeeId) {
  const { rows } = await client.query(`
    SELECT e.status, e.email, a.login_email, a.password_hash IS NOT NULL AS activated, r.role IS NOT NULL AS is_admin
    FROM balicall_employees e
    LEFT JOIN balicall_auth_accounts a USING (employee_id)
    LEFT JOIN balicall_admin_roles r USING (employee_id)
    WHERE e.employee_id=$1 FOR UPDATE OF e
  `, [employeeId]);
  return rows[0];
}

async function hasAnotherAdmin(client, employeeId) {
  const { rows } = await client.query(`
    SELECT 1 FROM balicall_admin_roles r
    JOIN balicall_auth_accounts a USING (employee_id)
    JOIN balicall_employees e USING (employee_id)
    WHERE r.employee_id<>$1 AND r.role='super_admin'
      AND e.status='active' AND a.password_hash IS NOT NULL LIMIT 1
  `, [employeeId]);
  return rows.length > 0;
}

async function grantRole(client, employeeId) {
  await client.query("INSERT INTO balicall_admin_roles(employee_id,role) VALUES ($1,'super_admin')", [employeeId]);
}

const changed = () => ({ ok: true, changed: true, result: 'succeeded' });
const unchanged = () => ({ ok: true, changed: false, result: 'no_change' });
const denied = (status, reason, error) => ({ ok: false, status, result: 'denied', reason, error });
const lastAdmin = () => denied(409, 'last_super_admin', 'Super Admin aktif terakhir harus dipertahankan.');

export class PgAdminStore {
  constructor(pool = getPool()) {
    this.pool = pool;
  }

  requirePool() {
    if (!this.pool) throw Object.assign(new Error('Layanan admin memerlukan PostgreSQL.'), { status: 503 });
    return this.pool;
  }

  async permissions(employeeId) {
    return await isActiveSuperAdmin(this.requirePool(), employeeId) ? superAdminPermissions : [];
  }

  async listAudit({ from, to, action, page }) {
    const { rows: [result] } = await this.requirePool().query(`
      WITH matching AS (
        SELECT * FROM balicall_admin_audit
        WHERE ($1::date IS NULL OR occurred_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Jakarta'))
          AND ($2::date IS NULL OR occurred_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Jakarta'))
          AND ($3 = '' OR action = $3)
      ), page_info AS (
        SELECT COUNT(*)::int AS total,
          LEAST($4::bigint, GREATEST(1, (COUNT(*) + $5::int - 1) / $5::int))::int AS page
        FROM matching
      ), page_rows AS (
        SELECT id::text AS id, actor_id AS "actorId", target_id AS "targetId", action, result,
          previous_value AS "previousValue", new_value AS "newValue", reason, occurred_at AS "occurredAt"
        FROM matching ORDER BY occurred_at DESC, matching.id DESC
        LIMIT $5 OFFSET (((SELECT page FROM page_info) - 1)::bigint * $5)
      )
      SELECT page_info.*,
        COALESCE((SELECT JSON_AGG(p ORDER BY p."occurredAt" DESC, p.id::bigint DESC) FROM page_rows p), '[]'::json) AS entries,
        ARRAY(SELECT DISTINCT action FROM balicall_admin_audit ORDER BY action) AS actions
      FROM page_info
    `, [from, to, action, page, AUDIT_PAGE_SIZE]);
    return { ...result, pageSize: AUDIT_PAGE_SIZE };
  }

  async listMeetingMetadata() {
    const { rows } = await this.requirePool().query(`
      SELECT m.id, m.room_name AS title, m.status, m.created_at AS "createdAt", m.ended_at AS "endedAt",
        attendance.first_join AS "startedAt", attendance.attendee_count AS "attendeeCount"
      FROM balicall_meetings m
      LEFT JOIN LATERAL (
        SELECT MIN(joined_at) AS first_join, COUNT(joined_at)::int AS attendee_count
        FROM balicall_attendees WHERE meeting_id=m.id
      ) attendance ON TRUE
      WHERE m.status IN ('active', 'ended')
      ORDER BY COALESCE(m.ended_at, attendance.first_join, m.created_at) DESC, m.id DESC LIMIT 50
    `);
    return rows;
  }

  async listMeetingHistory({ search, from, to, page }) {
    const { rows: [result] } = await this.requirePool().query(`
      WITH matching AS (
        SELECT id, room_name, created_at, ended_at, COALESCE(ended_at, created_at) AS archive_date
        FROM balicall_meetings
        WHERE (status = 'ended' OR ended_at IS NOT NULL)
          AND ($1 = '' OR STRPOS(LOWER(room_name), LOWER($1)) > 0)
          AND ($2::date IS NULL OR COALESCE(ended_at, created_at) >= ($2::date::timestamp AT TIME ZONE 'Asia/Jakarta'))
          AND ($3::date IS NULL OR COALESCE(ended_at, created_at) < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Jakarta'))
      ), page_info AS (
        SELECT COUNT(*)::int AS total,
          LEAST($4::bigint, GREATEST(1, (COUNT(*) + $5::int - 1) / $5::int))::int AS page
        FROM matching
      ), page_rows AS (
        SELECT * FROM matching ORDER BY archive_date DESC NULLS LAST, id DESC
        LIMIT $5 OFFSET (((SELECT page FROM page_info) - 1)::bigint * $5)
      ), metadata AS (
        SELECT m.id, m.room_name AS title, m.created_at AS "createdAt", m.ended_at AS "endedAt",
          attendance.first_join AS "startedAt", attendance.attendee_count AS "participantCount",
          CASE WHEN m.ended_at >= attendance.first_join
            THEN FLOOR(EXTRACT(EPOCH FROM (m.ended_at - attendance.first_join)))::double precision
          END AS "durationSeconds"
        FROM page_rows m
        CROSS JOIN LATERAL (
          SELECT MIN(joined_at) AS first_join, COUNT(joined_at)::int AS attendee_count
          FROM balicall_attendees WHERE meeting_id = m.id
        ) attendance
      )
      SELECT page_info.*, COALESCE((
        SELECT JSON_AGG(m ORDER BY COALESCE(m."endedAt", m."createdAt") DESC NULLS LAST, m.id DESC)
        FROM metadata m
      ), '[]'::json) AS meetings
      FROM page_info
    `, [search, from, to, page, MEETING_HISTORY_PAGE_SIZE]);
    return { ...result, pageSize: MEETING_HISTORY_PAGE_SIZE };
  }

  async listScheduleMetadata() {
    const { rows } = await this.requirePool().query(`
      SELECT id, title, host_id AS "hostId", host_name AS "hostName", status,
        scheduled_start AS "scheduledStart", scheduled_end AS "scheduledEnd"
      FROM balicall_schedules
      ORDER BY (scheduled_start < NOW()), CASE WHEN scheduled_start >= NOW() THEN scheduled_start END,
        scheduled_start DESC, id LIMIT 50
    `);
    return rows;
  }

  async listRecordingMetadata({ search, status, page }) {
    const { rows: [result] } = await this.requirePool().query(`
      WITH matching AS (
        SELECT id, title, file_size::text AS "fileSize", status, stage, created_at AS "createdAt"
        FROM balicall_recording_uploads
        WHERE ($1 = '' OR STRPOS(LOWER(title), LOWER($1)) > 0)
          AND ($2 = '' OR status = $2)
      ), page_info AS (
        SELECT COUNT(*)::int AS total,
          LEAST($3::bigint, GREATEST(1, (COUNT(*) + $4::int - 1) / $4::int))::int AS page
        FROM matching
      ), page_rows AS (
        SELECT * FROM matching ORDER BY "createdAt" DESC NULLS LAST, id DESC
        LIMIT $4 OFFSET (((SELECT page FROM page_info) - 1)::bigint * $4)
      ), inventory AS (
        SELECT COUNT(*)::int AS "totalUploads", COALESCE(SUM(file_size), 0)::text AS "uploadedBytes"
        FROM balicall_recording_uploads
      )
      SELECT page_info.*, inventory.*,
        COALESCE((SELECT JSON_AGG(r ORDER BY r."createdAt" DESC NULLS LAST, r.id DESC) FROM page_rows r), '[]'::json) AS recordings
      FROM page_info CROSS JOIN inventory
    `, [search, status, page, RECORDING_PAGE_SIZE]);
    return { ...result, pageSize: RECORDING_PAGE_SIZE };
  }

  async recordingQueue() {
    const { rows: [metrics] } = await this.requirePool().query(`
      WITH uploads AS (
        SELECT status, CASE
          WHEN status = 'done' AND isfinite(created_at) AND isfinite(completed_at)
            AND completed_at BETWEEN NOW() - INTERVAL '168 hours' AND NOW()
            AND completed_at >= created_at
          THEN EXTRACT(EPOCH FROM (completed_at - created_at))::double precision
        END AS completion_seconds
        FROM balicall_recording_uploads
      )
      SELECT COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
        COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY completion_seconds) AS "medianCompletionSeconds",
        COUNT(completion_seconds)::int AS "completionSampleSize"
      FROM uploads
    `);
    return metrics;
  }

  async databaseReady() {
    try {
      await this.requirePool().query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async overview(days) {
    const { rows: [totals] } = await this.requirePool().query(`
      SELECT
        (SELECT COUNT(*)::int FROM balicall_employees) AS "totalEmployees",
        (SELECT COUNT(*)::int FROM balicall_auth_accounts WHERE password_hash IS NOT NULL) AS "activatedAccounts",
        (SELECT COUNT(*)::int FROM balicall_meetings m
          LEFT JOIN LATERAL (
            SELECT MIN(a.joined_at) AS first_join FROM balicall_attendees a WHERE a.meeting_id=m.id
          ) attendance ON TRUE
          WHERE m.status IN ('active', 'ended')
            AND COALESCE(attendance.first_join, m.created_at)
              BETWEEN NOW() - $1::int * INTERVAL '24 hours' AND NOW()
        ) AS "totalMeetings",
        (SELECT COALESCE(SUM(file_size), 0)::text FROM balicall_recording_uploads) AS "uploadedBytes"
    `, [days]);
    return { days, ...totals };
  }

  async listEmployees({ search, department, status, page }) {
    const { rows: [result] } = await this.requirePool().query(`
      WITH matching AS (
        SELECT e.employee_id AS "employeeId", e.name, BTRIM(e.department) AS department,
          BTRIM(e.status) AS status, a.password_hash IS NOT NULL AS activated,
          r.role IS NOT NULL AS "isSuperAdmin"
        FROM balicall_employees e
        LEFT JOIN balicall_auth_accounts a USING (employee_id)
        LEFT JOIN balicall_admin_roles r USING (employee_id)
        WHERE ($1 = '' OR STRPOS(LOWER(e.name), LOWER($1)) > 0)
          AND ($2 = '' OR BTRIM(e.department)=$2)
          AND ($3 = '' OR BTRIM(e.status)=$3)
      ), page_info AS (
        SELECT COUNT(*)::int AS total,
          LEAST($4::bigint, GREATEST(1, (COUNT(*) + $5::int - 1) / $5::int))::int AS page
        FROM matching
      ), page_rows AS (
        SELECT * FROM matching ORDER BY LOWER(name), "employeeId"
        LIMIT $5 OFFSET (((SELECT page FROM page_info) - 1)::bigint * $5)
      )
      SELECT page_info.*,
        COALESCE((SELECT JSON_AGG(p ORDER BY LOWER(p.name), p."employeeId") FROM page_rows p), '[]'::json) AS employees,
        ARRAY(SELECT DISTINCT BTRIM(department) FROM balicall_employees WHERE BTRIM(department) <> ''
          ORDER BY BTRIM(department)) AS departments,
        ARRAY(SELECT DISTINCT BTRIM(status) FROM balicall_employees WHERE BTRIM(status) <> ''
          ORDER BY BTRIM(status)) AS statuses
      FROM page_info
    `, [search, department, status, page, EMPLOYEE_PAGE_SIZE]);
    return { ...result, pageSize: EMPLOYEE_PAGE_SIZE };
  }

  async mutate({ actorId, targetId, action, newValue }, apply) {
    const client = await this.requirePool().connect();
    try {
      await client.query('BEGIN');
      // Serialize bootstrap, role changes, and account status changes across API processes.
      await client.query('LOCK TABLE balicall_admin_roles IN SHARE ROW EXCLUSIVE MODE');
      const outcome = actorId && !await isActiveSuperAdmin(client, actorId)
        ? denied(403, 'admin_access_revoked', 'Akses Super Admin diperlukan.')
        : await apply(client);
      await client.query(`
        INSERT INTO balicall_admin_audit(actor_id,target_id,action,result,previous_value,new_value,reason)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [actorId, targetId, action, outcome.result, outcome.previousValue ?? null, newValue, outcome.reason ?? null]);
      await client.query('COMMIT');
      return outcome;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  bootstrap(targetId) {
    return this.mutate({ actorId: null, targetId, action: 'admin.bootstrap', newValue: 'super_admin' }, async client => {
      const { rows } = await client.query('SELECT employee_id FROM balicall_admin_roles LIMIT 1');
      if (rows.length) {
        return rows[0].employee_id === targetId
          ? unchanged() : denied(409, 'bootstrap_complete', 'Super Admin pertama sudah ditetapkan.');
      }
      const account = await accountForUpdate(client, targetId);
      if (account?.status !== 'active' || !account.activated) {
        return denied(409, 'account_not_activated', 'Gunakan akun karyawan aktif yang sudah diaktivasi.');
      }
      await grantRole(client, targetId);
      return changed();
    });
  }

  setSuperAdmin(actorId, targetId, granted) {
    const action = granted ? 'admin.grant' : 'admin.revoke';
    return this.mutate({ actorId, targetId, action, newValue: granted ? 'super_admin' : 'none' }, async client => {
      const account = await accountForUpdate(client, targetId);
      if (!account) return denied(404, 'account_not_found', 'Akun karyawan tidak ditemukan.');
      if (account.is_admin === granted) return unchanged();
      if (granted && (account.status !== 'active' || !account.activated)) {
        return denied(409, 'account_not_activated', 'Gunakan akun karyawan aktif yang sudah diaktivasi.');
      }
      if (!granted && account.status === 'active' && account.activated && !await hasAnotherAdmin(client, targetId)) {
        return lastAdmin();
      }
      if (granted) await grantRole(client, targetId);
      else await client.query('DELETE FROM balicall_admin_roles WHERE employee_id=$1', [targetId]);
      return { ...changed(), previousValue: granted ? 'none' : 'super_admin' };
    });
  }

  setAccountStatus(actorId, targetId, status) {
    return this.mutate({ actorId, targetId, action: 'account.status.change', newValue: status }, async client => {
      const account = await accountForUpdate(client, targetId);
      if (!account) return denied(404, 'account_not_found', 'Akun karyawan tidak ditemukan.');
      if (account.status === status) return unchanged();
      if (status === 'inactive' && account.is_admin && account.status === 'active'
        && account.activated && !await hasAnotherAdmin(client, targetId)) return lastAdmin();
      await client.query('UPDATE balicall_employees SET status=$2 WHERE employee_id=$1', [targetId, status]);
      if (status === 'inactive') {
        await client.query('DELETE FROM balicall_auth_sessions WHERE employee_id=$1', [targetId]);
        await client.query('UPDATE balicall_auth_invites SET used_at=NOW() WHERE employee_id=$1 AND used_at IS NULL', [targetId]);
      }
      return { ...changed(), previousValue: account.status };
    });
  }

  inviteEmployee(actorId, targetId) {
    return this.mutate({ actorId, targetId, action: 'account.invite', newValue: null }, async client => {
      const account = await accountForUpdate(client, targetId);
      if (!account) return denied(404, 'account_not_found', 'Karyawan tidak ditemukan.');
      if (account.status !== 'active') {
        return denied(409, 'account_inactive', 'Aktifkan status akun sebelum membuat undangan.');
      }
      if (!account.login_email) {
        const email = account.email?.trim().toLowerCase() ?? '';
        if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
          return denied(409, 'employee_email_missing', 'Email karyawan belum tersedia atau tidak valid.');
        }
        const { rows } = await client.query(`
          INSERT INTO balicall_auth_accounts(employee_id,login_email) VALUES ($1,$2)
          ON CONFLICT DO NOTHING RETURNING employee_id
        `, [targetId, email]);
        if (!rows.length) return denied(409, 'login_email_conflict', 'Email login sudah dipakai akun lain.');
      }
      try {
        const invite = await issueActivationInvite(client, targetId, { activationOnly: true });
        return { ...changed(), invite };
      } catch (error) {
        if (error.code !== 'ACCOUNT_ALREADY_ACTIVATED') throw error;
        return denied(409, 'account_already_activated', 'Akun ini sudah diaktivasi.');
      }
    });
  }
}
