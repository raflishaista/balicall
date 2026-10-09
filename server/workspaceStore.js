import { randomUUID, createHash } from 'node:crypto';
import { getPool } from './db.js';

export async function initWorkspaceDb(pool = getPool()) {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS balicall_profiles (
      employee_id VARCHAR(32) PRIMARY KEY REFERENCES balicall_employees(employee_id) ON DELETE CASCADE,
      display_name VARCHAR(80), photo BYTEA, revision INTEGER NOT NULL DEFAULT 0,
      photo_version TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS balicall_push_subscriptions (
      endpoint_hash CHAR(64) PRIMARY KEY, employee_id VARCHAR(32) NOT NULL REFERENCES balicall_employees(employee_id) ON DELETE CASCADE,
      subscription JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS balicall_push_employee ON balicall_push_subscriptions(employee_id);
    CREATE TABLE IF NOT EXISTS balicall_notifications (
      id UUID PRIMARY KEY, employee_id VARCHAR(32) NOT NULL REFERENCES balicall_employees(employee_id) ON DELETE CASCADE,
      event_key TEXT NOT NULL, kind TEXT NOT NULL, room_name TEXT NOT NULL, meeting_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), read_at TIMESTAMPTZ,
      push_state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(employee_id,event_key)
    );
    CREATE INDEX IF NOT EXISTS balicall_notifications_employee ON balicall_notifications(employee_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS balicall_notifications_pending ON balicall_notifications(next_attempt_at) WHERE push_state='pending';
  `);
}
export class WorkspaceStore {
  constructor(pool = getPool()) { this.pool = pool; }
  query(sql, params = []) {
    if (!this.pool) throw Object.assign(new Error('Profil dan notifikasi memerlukan koneksi database.'), { status: 503 });
    return this.pool.query(sql, params);
  }
  async profile(id) {
    const {rows}=await this.query(`SELECT e.employee_id,e.name,e.department,e.position,a.login_email,p.display_name,p.revision,p.photo_version
      FROM balicall_employees e JOIN balicall_auth_accounts a USING(employee_id) LEFT JOIN balicall_profiles p USING(employee_id) WHERE e.employee_id=$1 AND e.status='active'`,[id]);
    if (!rows[0]) throw Object.assign(new Error('Profil tidak ditemukan.'),{status:404});
    const p=rows[0]; return {employeeId:p.employee_id,legalName:p.name,name:p.display_name||p.name,email:p.login_email,department:p.department,position:p.position,revision:p.revision||0,photoVersion:p.photo_version||null};
  }
  async updateProfile(id,{displayName,photo,deletePhoto,revision}) {
    const {rows}=await this.query(`INSERT INTO balicall_profiles(employee_id,display_name,photo,revision,photo_version)
      SELECT $1::varchar(32),$2::varchar(80),$3::bytea,1,$4::text WHERE $6=0 OR EXISTS(SELECT 1 FROM balicall_profiles WHERE employee_id=$1::varchar(32) AND revision=$6)
      ON CONFLICT(employee_id) DO UPDATE SET display_name=EXCLUDED.display_name,
      photo=CASE WHEN $5 THEN NULL WHEN $3::bytea IS NOT NULL THEN EXCLUDED.photo ELSE balicall_profiles.photo END,
      photo_version=CASE WHEN $5 OR $3::bytea IS NOT NULL THEN EXCLUDED.photo_version ELSE balicall_profiles.photo_version END,
      revision=balicall_profiles.revision+1,updated_at=NOW() WHERE balicall_profiles.revision=$6 RETURNING revision`,
      [id,displayName,photo||null,photo?randomUUID():null,deletePhoto,revision]);
    if (!rows[0]) throw Object.assign(new Error('Profil berubah di perangkat lain. Muat ulang profil sebelum menyimpan.'),{status:409});
    return this.profile(id);
  }
  async photo(id) { return (await this.query('SELECT photo FROM balicall_profiles WHERE employee_id=$1',[id])).rows[0]?.photo; }
  async subscribe(id,subscription) {
    const endpointHash=createHash('sha256').update(subscription.endpoint).digest('hex');
    await this.query(`INSERT INTO balicall_push_subscriptions(endpoint_hash,employee_id,subscription) VALUES($1,$2,$3)
      ON CONFLICT(endpoint_hash) DO UPDATE SET employee_id=EXCLUDED.employee_id,subscription=EXCLUDED.subscription,created_at=NOW()`,[endpointHash,id,JSON.stringify(subscription)]);
    await this.query(`DELETE FROM balicall_push_subscriptions WHERE employee_id=$1 AND endpoint_hash NOT IN
      (SELECT endpoint_hash FROM balicall_push_subscriptions WHERE employee_id=$1 ORDER BY created_at DESC LIMIT 10)`,[id]);
  }
  async unsubscribe(id,endpoint) { await this.query('DELETE FROM balicall_push_subscriptions WHERE employee_id=$1 AND endpoint_hash=$2',[id,createHash('sha256').update(endpoint).digest('hex')]); }
  async subscriptions(id) { return (await this.query('SELECT subscription FROM balicall_push_subscriptions WHERE employee_id=$1',[id])).rows.map(r=>r.subscription); }
  async notify(id,event) {
    await this.query(`INSERT INTO balicall_notifications(id,employee_id,event_key,kind,room_name,meeting_id)
      SELECT $1,employee_id,$3,$4,$5,$6 FROM balicall_employees WHERE employee_id=$2 AND status='active'
      ON CONFLICT(employee_id,event_key) DO NOTHING`,[randomUUID(),id,event.key,event.kind,event.roomName,event.meetingId||null]);
  }
  async list(id) { return (await this.query(`SELECT id,kind,room_name AS "roomName",meeting_id AS "meetingId",created_at AS "createdAt",read_at AS "readAt"
    FROM balicall_notifications WHERE employee_id=$1 ORDER BY created_at DESC LIMIT 50`,[id])).rows; }
  async read(id,notificationId) { await this.query('UPDATE balicall_notifications SET read_at=NOW() WHERE employee_id=$1 AND id=$2',[id,notificationId]); }
  async claim() {
    return (await this.query(`WITH ready AS (SELECT id FROM balicall_notifications WHERE push_state='pending' AND next_attempt_at<=NOW() AND attempts<4 ORDER BY next_attempt_at LIMIT 20 FOR UPDATE SKIP LOCKED)
      UPDATE balicall_notifications n SET attempts=attempts+1,next_attempt_at=NOW()+interval '2 minutes' FROM ready WHERE n.id=ready.id RETURNING n.*`)).rows;
  }
  async delivered(id,retry) { await this.query("UPDATE balicall_notifications SET push_state=CASE WHEN $2 THEN CASE WHEN attempts<4 THEN 'pending' ELSE 'failed' END ELSE 'sent' END WHERE id=$1",[id,retry]); }
}
