import { getPool, isDbConnected } from './db.js';

function db() {
  const pool = getPool();
  if (!pool || !isDbConnected()) {
    const error = new Error('Database belum tersedia. Fitur upload rekaman memerlukan PostgreSQL.');
    error.status = 503;
    throw error;
  }
  return pool;
}

export const toApi = (row, { detail = false } = {}) => ({
  id: row.id,
  title: row.title,
  originalFilename: row.original_filename,
  fileSize: row.file_size === null ? null : Number(row.file_size),
  language: row.language,
  status: row.status,
  stage: row.stage,
  error: row.error,
  durationSeconds: row.duration_seconds,
  provider: row.provider,
  ownerId: row.owner_id,
  ownerName: row.owner_name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  completedAt: row.completed_at,
  hasSummary: row.has_summary ?? Boolean(row.summary),
  ...(detail ? { transcript: row.transcript, summary: row.summary } : {}),
});

const COLUMNS = {
  status: 'status', stage: 'stage', error: 'error', workerJobId: 'worker_job_id',
  durationSeconds: 'duration_seconds', transcript: 'transcript', summary: 'summary',
  provider: 'provider', filePath: 'file_path', completedAt: 'completed_at',
};

export async function createUpload(u) {
  const res = await db().query(
    `INSERT INTO balicall_recording_uploads
       (id, owner_id, owner_name, title, original_filename, file_path, file_size, language, status, stage)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'queued','queued') RETURNING *`,
    [u.id, u.ownerId, u.ownerName, u.title, u.originalFilename, u.filePath, u.fileSize, u.language],
  );
  return toApi(res.rows[0]);
}

// Raw row (includes file_path). Never send this directly to the client; use toApi().
export async function getUploadRow(id) {
  const res = await db().query('SELECT * FROM balicall_recording_uploads WHERE id = $1', [id]);
  return res.rows[0] || null;
}

export async function listUploads(ownerId, limit = 50) {
  const res = await db().query(
    `SELECT id, owner_id, owner_name, title, original_filename, file_size, language, status, stage,
            error, duration_seconds, provider, created_at, updated_at, completed_at,
            (summary IS NOT NULL) AS has_summary
       FROM balicall_recording_uploads
      WHERE ($1::text IS NULL OR owner_id = $1)
      ORDER BY created_at DESC
      LIMIT $2`,
    [ownerId, limit],
  );
  return res.rows.map(row => toApi(row));
}

export async function updateUpload(id, fields) {
  const sets = [];
  const values = [id];
  for (const [key, value] of Object.entries(fields)) {
    const column = COLUMNS[key]; // whitelist: only known column names reach the SQL text
    if (!column) continue;
    values.push(['transcript', 'summary'].includes(key) && value !== null ? JSON.stringify(value) : value);
    sets.push(`${column} = $${values.length}`);
  }
  if (!sets.length) return null;
  sets.push('updated_at = NOW()');
  const res = await db().query(
    `UPDATE balicall_recording_uploads SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, values);
  return res.rows[0] ? toApi(res.rows[0], { detail: true }) : null;
}

export async function deleteUpload(id) {
  await db().query('DELETE FROM balicall_recording_uploads WHERE id = $1', [id]);
}

// Jobs run inside this Node process, so anything still queued/processing at startup was interrupted.
export async function failInterrupted() {
  await db().query(
    `UPDATE balicall_recording_uploads
        SET status = 'failed', stage = NULL, updated_at = NOW(),
            error = CASE WHEN transcript IS NOT NULL
                         THEN 'Server dimulai ulang sebelum ringkasan selesai. Coba ringkas ulang.'
                         ELSE 'Server dimulai ulang saat rekaman diproses. Unggah ulang rekaman.' END
      WHERE status IN ('queued', 'processing')`);
}