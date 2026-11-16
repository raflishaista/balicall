import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { MeetingStore } from '../meetingStore.js';

test('meeting chat files can be uploaded, listed, and downloaded for both active call and notulen', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'balicall-files-'));
  const filesDir = join(dir, 'meeting-files');
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const config = loadConfig({
    ...process.env,
    AUTH_ENABLED: 'false',
    LLM_PROVIDER: 'demo',
    LIVEKIT_API_KEY: 'testkey',
    LIVEKIT_API_SECRET: 'testsecret123456789012345678901234',
    LIVEKIT_URL: 'ws://127.0.0.1:7880',
    MEETINGS_FILE: join(dir, 'meetings.json'),
    RECORDING_UPLOAD_DIR: join(dir, 'uploads'),
  });
  config.meetingFilesDir = filesDir;

  const store = new MeetingStore(config.meetingsFile, 0);
  const context = createApp(config, { store });
  const server = context.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    context.close();
    await new Promise(resolve => server.close(resolve));
  });

  const base = `http://127.0.0.1:${server.address().port}/api`;
  const joinRes = await fetch(`${base}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      roomName: 'file-share-room',
      employeeId: 'BT-10001',
      employeeName: 'Rafli Aditya',
      intent: 'create',
    }),
  });
  assert.equal(joinRes.status, 200);
  const { meetingId, token } = await joinRes.json();

  const emptyList = await (await fetch(`${base}/meetings/${meetingId}/files`)).json();
  assert.deepEqual(emptyList.files, []);

  const form = new FormData();
  const payloadText = 'Agenda rapat dan catatan arsitektur BaliCall';
  form.append('file', new Blob([payloadText], { type: 'text/plain' }), 'agenda-rapat.txt');

  const unauthUpload = await fetch(`${base}/meetings/${meetingId}/files`, { method: 'POST', body: form });
  assert.equal(unauthUpload.status, 401);

  const uploadRes = await fetch(`${base}/meetings/${meetingId}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  assert.equal(uploadRes.status, 201);
  const { file } = await uploadRes.json();
  assert.equal(file.originalFilename, 'agenda-rapat.txt');
  assert.equal(file.uploaderName, 'Rafli Aditya');
  assert.equal(file.fileSize, Buffer.byteLength(payloadText));

  const listed = await (await fetch(`${base}/meetings/${meetingId}/files`)).json();
  assert.equal(listed.files.length, 1);
  assert.equal(listed.files[0].id, file.id);

  const downloadRes = await fetch(`${base}/meetings/${meetingId}/files/${file.id}/download`);
  assert.equal(downloadRes.status, 200);
  assert.match(downloadRes.headers.get('content-disposition') || '', /agenda-rapat\.txt/);
  assert.equal(await downloadRes.text(), payloadText);

  const oversizedForm = new FormData();
  oversizedForm.append('file', new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]), 'too-big.bin');
  const oversizedRes = await fetch(`${base}/meetings/${meetingId}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: oversizedForm,
  });
  assert.equal(oversizedRes.status, 413);
});
