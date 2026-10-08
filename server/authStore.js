import { randomBytes, createHash } from 'node:crypto';
import { getPool } from './db.js';

export const hashToken = value => createHash('sha256').update(value).digest('hex');
export const publicUser = row => ({ employeeId: row.employee_id, name: row.name, email: row.login_email, department: row.department, position: row.position });
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
    await client.query('COMMIT');
  } catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export class PgAuthStore {
  constructor(pool = getPool()) { this.pool = pool; }
  query(sql, params) {
    if (!this.pool) throw Object.assign(new Error('Layanan login belum tersambung ke database.'), { status: 503 });
    return this.pool.query(sql, params);
  }
  async account(email) {
    const {rows} = await this.query(`SELECT a.*,e.name,e.department,e.position,e.status FROM balicall_auth_accounts a JOIN balicall_employees e USING(employee_id) WHERE a.login_email=$1`,[email]);
    return rows[0];
  }
  async session(tokenHash) {
    const {rows} = await this.query(`SELECT a.*,e.name,e.department,e.position FROM balicall_auth_sessions s JOIN balicall_auth_accounts a USING(employee_id) JOIN balicall_employees e USING(employee_id) WHERE s.token_hash=$1 AND s.expires_at>NOW() AND e.status='active' AND a.password_hash IS NOT NULL`,[tokenHash]);
    return rows[0] ? publicUser(rows[0]) : null;
  }
  async createSession(tokenHash, employeeId, hours) {
    await this.query('DELETE FROM balicall_auth_sessions WHERE expires_at<=NOW()');
    await this.query('INSERT INTO balicall_auth_sessions(token_hash,employee_id,expires_at) VALUES($1,$2,NOW()+$3*interval \'1 hour\')',[tokenHash,employeeId,hours]);
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
    const token=randomBytes(32).toString('base64url');
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      const {rows}=await client.query(`SELECT a.login_email FROM balicall_auth_accounts a JOIN balicall_employees e USING(employee_id) WHERE a.employee_id=$1 AND e.status='active' FOR UPDATE OF a`,[employeeId]);
      if(!rows[0]) throw new Error('Akun karyawan aktif tidak ditemukan.');
      await client.query('UPDATE balicall_auth_invites SET used_at=NOW() WHERE employee_id=$1 AND used_at IS NULL',[employeeId]);
      await client.query("INSERT INTO balicall_auth_invites(token_hash,employee_id,expires_at) VALUES($1,$2,NOW()+interval '24 hours')",[hashToken(token),employeeId]);
      await client.query('COMMIT');
      return {email:rows[0].login_email,employeeId,activationCode:token,expiresIn:'24 jam'};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
}
