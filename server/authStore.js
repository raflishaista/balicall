import { randomBytes, createHash } from 'node:crypto';
import { getPool } from './db.js';
import { initWorkspaceDb } from './workspaceStore.js';

export const hashToken = value => createHash('sha256').update(value).digest('hex');
export const publicUser = row => ({ employeeId: row.employee_id, name: row.display_name||row.name, legalName:row.name, email: row.login_email, department: row.department, position: row.position, photoVersion:row.photo_version||null, ...(row.is_super_admin ? { isSuperAdmin: true } : {}) });
const superAdminColumn = "EXISTS (SELECT 1 FROM balicall_admin_roles r WHERE r.employee_id=a.employee_id AND r.role='super_admin') AS is_super_admin";

export async function initAdminDb(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS balicall_admin_roles (
      employee_id VARCHAR(32) PRIMARY KEY REFERENCES balicall_auth_accounts(employee_id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role = 'super_admin')
    );
    CREATE TABLE IF NOT EXISTS balicall_admin_audit (
      id BIGSERIAL PRIMARY KEY,
      actor_id VARCHAR(32),
      target_id VARCHAR(32) NOT NULL,
      action TEXT NOT NULL,
      result TEXT NOT NULL CHECK (result IN ('succeeded', 'no_change', 'denied')),
      previous_value TEXT,
      new_value TEXT,
      reason TEXT,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE IF NOT EXISTS balicall_activation_requests (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(128) NOT NULL,
      email TEXT NOT NULL UNIQUE CHECK(email = lower(email)),
      password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
      reviewed_by VARCHAR(32),
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function issueActivationInvite(client, employeeId, { activationOnly = false } = {}) {
  const { rows: [account] } = await client.query(`
    SELECT a.login_email, a.password_hash IS NOT NULL AS activated
    FROM balicall_auth_accounts a JOIN balicall_employees e USING (employee_id)
    WHERE a.employee_id=$1 AND e.status='active' FOR UPDATE OF a
  `, [employeeId]);
  if (!account) throw new Error('Akun karyawan aktif tidak ditemukan.');
  if (activationOnly && account.activated) {
    throw Object.assign(new Error('Akun ini sudah diaktivasi.'), { code: 'ACCOUNT_ALREADY_ACTIVATED' });
  }
  const activationCode = randomBytes(32).toString('base64url');
  await client.query('UPDATE balicall_auth_invites SET used_at=NOW() WHERE employee_id=$1 AND used_at IS NULL', [employeeId]);
  await client.query("INSERT INTO balicall_auth_invites(token_hash,employee_id,expires_at) VALUES($1,$2,NOW()+interval '24 hours')",
    [hashToken(activationCode), employeeId]);
  return { email: account.login_email, employeeId, activationCode, expiresIn: '24 jam' };
}
export async function initAuthDb(pool = getPool()) {
  if (!pool) throw new Error('Login memerlukan PostgreSQL.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS balicall_auth_accounts (
        employee_id VARCHAR(32) PRIMARY KEY REFERENCES balicall_employees(employee_id),
        login_email TEXT NOT NULL UNIQUE CHECK(login_email=lower(login_email)),
        password_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        password_changed_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS balicall_auth_sessions (
        token_hash CHAR(64) PRIMARY KEY,
        employee_id VARCHAR(32) NOT NULL REFERENCES balicall_auth_accounts(employee_id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS balicall_auth_sessions_employee ON balicall_auth_sessions(employee_id);
      CREATE INDEX IF NOT EXISTS balicall_auth_sessions_expiry ON balicall_auth_sessions(expires_at);
      CREATE TABLE IF NOT EXISTS balicall_auth_invites (
        token_hash CHAR(64) PRIMARY KEY,
        employee_id VARCHAR(32) NOT NULL REFERENCES balicall_auth_accounts(employee_id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS balicall_auth_rate_limits (
        bucket_hash CHAR(64) PRIMARY KEY,
        hits INTEGER NOT NULL,
        reset_at TIMESTAMPTZ NOT NULL
      );
      INSERT INTO balicall_auth_accounts(employee_id,login_email)
      SELECT employee_id,lower(trim(email)) FROM balicall_employees
      WHERE status='active' AND email IS NOT NULL AND trim(email) LIKE '%@%'
      ON CONFLICT DO NOTHING;
    `);
    await initAdminDb(client);
    await client.query('COMMIT');
  } catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  await initWorkspaceDb(pool);
}
export class PgAuthStore {
  constructor(pool = getPool()) { this.pool = pool; }
  query(sql, params) {
    if (!this.pool) throw Object.assign(new Error('Layanan login belum tersambung ke database.'), { status: 503 });
    return this.pool.query(sql, params);
  }
  async account(email) {
    const {rows} = await this.query(`SELECT a.*,e.name,e.department,e.position,e.status,p.display_name,p.photo_version,${superAdminColumn} FROM balicall_auth_accounts a JOIN balicall_employees e USING(employee_id) LEFT JOIN balicall_profiles p USING(employee_id) WHERE a.login_email=$1`,[email]);
    return rows[0];
  }
  async session(tokenHash) {
    const {rows} = await this.query(`SELECT a.*,e.name,e.department,e.position,p.display_name,p.photo_version,${superAdminColumn} FROM balicall_auth_sessions s JOIN balicall_auth_accounts a USING(employee_id) JOIN balicall_employees e USING(employee_id) LEFT JOIN balicall_profiles p USING(employee_id) WHERE s.token_hash=$1 AND s.expires_at>NOW() AND e.status='active' AND a.password_hash IS NOT NULL`,[tokenHash]);
    return rows[0] ? publicUser(rows[0]) : null;
  }
  async createSession(tokenHash, employeeId, hours) {
    await this.query('DELETE FROM balicall_auth_sessions WHERE expires_at<=NOW()');
    const { rows } = await this.query(`
      INSERT INTO balicall_auth_sessions(token_hash,employee_id,expires_at)
      SELECT $1,e.employee_id,NOW()+$3*interval '1 hour'
      FROM balicall_employees e JOIN balicall_auth_accounts a USING (employee_id)
      WHERE e.employee_id=$2 AND e.status='active' AND a.password_hash IS NOT NULL
      FOR UPDATE OF e
      RETURNING employee_id
    `, [tokenHash, employeeId, hours]);
    return rows.length === 1;
  }
  async hasActiveSession(employeeId, exceptTokenHash = null) {
    await this.query('DELETE FROM balicall_auth_sessions WHERE expires_at<=NOW()');
    const sql = exceptTokenHash
      ? 'SELECT 1 FROM balicall_auth_sessions WHERE employee_id=$1 AND expires_at>NOW() AND token_hash<>$2 LIMIT 1'
      : 'SELECT 1 FROM balicall_auth_sessions WHERE employee_id=$1 AND expires_at>NOW() LIMIT 1';
    const params = exceptTokenHash ? [employeeId, exceptTokenHash] : [employeeId];
    const {rows} = await this.query(sql, params);
    return Boolean(rows[0]);
  }
  async revokeAllForEmployee(employeeId) {
    await this.query('DELETE FROM balicall_auth_sessions WHERE employee_id=$1', [employeeId]);
  }
  async revoke(tokenHash) { await this.query('DELETE FROM balicall_auth_sessions WHERE token_hash=$1',[tokenHash]); }
  async consumeLimit(bucket, max, minutes) {
    // Persistent across API restarts; raw emails/IPs are not stored in these buckets.
    const {rows} = await this.query(`INSERT INTO balicall_auth_rate_limits(bucket_hash,hits,reset_at) VALUES($1,1,NOW()+$2*interval '1 minute')
      ON CONFLICT(bucket_hash) DO UPDATE SET hits=CASE WHEN balicall_auth_rate_limits.reset_at<=NOW() THEN 1 ELSE balicall_auth_rate_limits.hits+1 END,
      reset_at=CASE WHEN balicall_auth_rate_limits.reset_at<=NOW() THEN EXCLUDED.reset_at ELSE balicall_auth_rate_limits.reset_at END RETURNING hits`,[hashToken(bucket),minutes]);
    await this.query("DELETE FROM balicall_auth_rate_limits WHERE reset_at<NOW()-interval '1 day'");
    return rows[0].hits <= max;
  }
  async validInvite(email, tokenHash) {
    const {rows} = await this.query(`SELECT a.employee_id FROM balicall_auth_invites i JOIN balicall_auth_accounts a USING(employee_id) JOIN balicall_employees e USING(employee_id)
      WHERE i.token_hash=$1 AND a.login_email=$2 AND i.used_at IS NULL AND i.expires_at>NOW() AND e.status='active'`,[tokenHash,email]);
    return Boolean(rows[0]);
  }
  async activate(email, tokenHash, passwordHash) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const {rows} = await client.query(`SELECT a.employee_id FROM balicall_auth_invites i JOIN balicall_auth_accounts a USING(employee_id) JOIN balicall_employees e USING(employee_id)
        WHERE i.token_hash=$1 AND a.login_email=$2 AND i.used_at IS NULL AND i.expires_at>NOW() AND e.status='active' FOR UPDATE OF i,a`,[tokenHash,email]);
      if (!rows[0]) { await client.query('ROLLBACK'); return false; }
      const id=rows[0].employee_id;
      await client.query('UPDATE balicall_auth_accounts SET password_hash=$1,password_changed_at=NOW() WHERE employee_id=$2',[passwordHash,id]);
      await client.query('UPDATE balicall_auth_invites SET used_at=NOW() WHERE employee_id=$1 AND used_at IS NULL',[id]);
      await client.query('DELETE FROM balicall_auth_sessions WHERE employee_id=$1',[id]);
      await client.query('COMMIT'); return true;
    } catch(error) { await client.query('ROLLBACK'); throw error; }
    finally {client.release();}
  }
  async invite(employeeId) {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      const invite = await issueActivationInvite(client, employeeId);
      await client.query('COMMIT');
      return invite;
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async createActivationRequest({ name, email, passwordHash }) {
    const { rows: existingAccount } = await this.query(
      'SELECT password_hash IS NOT NULL AS activated FROM balicall_auth_accounts WHERE login_email=$1',
      [email]
    );
    if (existingAccount[0]?.activated) {
      throw Object.assign(new Error('Akun dengan email ini sudah aktif. Silakan masuk.'), { status: 409 });
    }
    const { rows: existingReq } = await this.query(
      'SELECT status FROM balicall_activation_requests WHERE email=$1',
      [email]
    );
    if (existingReq[0]?.status === 'pending') {
      throw Object.assign(new Error('Permintaan aktivasi untuk email ini sudah dikirim dan sedang menunggu persetujuan admin.'), { status: 409 });
    }
    const { rows } = await this.query(`
      INSERT INTO balicall_activation_requests(name, email, password_hash, status, reviewed_by, reviewed_at, created_at)
      VALUES ($1, $2, $3, 'pending', NULL, NULL, NOW())
      ON CONFLICT (email) DO UPDATE SET
        name = EXCLUDED.name,
        password_hash = EXCLUDED.password_hash,
        status = 'pending',
        reviewed_by = NULL,
        reviewed_at = NULL,
        created_at = NOW()
      RETURNING id::text AS id, name, email, status, created_at AS "createdAt"
    `, [name, email, passwordHash]);
    return rows[0];
  }
}
