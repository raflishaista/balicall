import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';

test('recording metadata and download endpoints', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'balicall-recordings-test-'));
  const recordingsDir = join(directory, 'recordings');
  const dataFile = join(directory, 'meetings.json');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(recordingsDir, { recursive: true });

  const meetingWithRecId = '3375b069-28a0-47d7-954d-f4717ef925ba';
  const meetingNoRecId = 'ffffffff-0000-0000-0000-000000000000';

  // Create a synthetic MP4 recording file
  const mp4Content = Buffer.from('fake mp4 video content for testing recording download');
  const recFilePath = join(recordingsDir, `meeting-${meetingWithRecId}.mp4`);
  writeFileSync(recFilePath, mp4Content);

  const config = {
    ...loadConfig({ LLM_PROVIDER: 'demo' }),
    dataFile,
    livekitRecordingsDir: recordingsDir,
    authEnabled: false,
  };

  const context = createApp(config, {
    livekitProbe: async () => [],
    fetchImpl: async () => Response.json({}),
  });

  const server = context.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/meetings`;

  t.after(async () => {
    context.close();
    await new Promise(resolve => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  });

  // 1. Check recording metadata for meeting with recording
  const metaRes = await fetch(`${base}/${meetingWithRecId}/recording`);
  assert.equal(metaRes.status, 200);
  const meta = await metaRes.json();
  assert.equal(meta.success, true);
  assert.equal(meta.hasRecording, true);
  assert.equal(meta.recordingSize, mp4Content.length);
  assert.equal(meta.fileName, `meeting-${meetingWithRecId}.mp4`);

  // 2. Check recording metadata for meeting without recording
  const noMetaRes = await fetch(`${base}/${meetingNoRecId}/recording`);
  assert.equal(noMetaRes.status, 200);
  const noMeta = await noMetaRes.json();
  assert.equal(noMeta.success, true);
  assert.equal(noMeta.hasRecording, false);
  assert.equal(noMeta.recordingSize, null);

  // 3. Download recording for meeting with recording
  const dlRes = await fetch(`${base}/${meetingWithRecId}/recording/download`);
  assert.equal(dlRes.status, 200);
  assert.match(dlRes.headers.get('content-disposition') || '', /attachment;\s*filename="meeting-3375b069/);
  const dlBuffer = Buffer.from(await dlRes.arrayBuffer());
  assert.deepEqual(dlBuffer, mp4Content);

  // 4. Download recording for meeting without recording -> 404
  const noDlRes = await fetch(`${base}/${meetingNoRecId}/recording/download`);
  assert.equal(noDlRes.status, 404);
  const noDlJson = await noDlRes.json();
  assert.match(noDlJson.error, /Berkas rekaman tidak ditemukan/);
});

test('guest access cannot download or access recording endpoints', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'balicall-guest-rec-test-'));
  const recordingsDir = join(directory, 'recordings');
  const dataFile = join(directory, 'meetings.json');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(recordingsDir, { recursive: true });

  const meetingId = 'test-guest-meeting-id';
  const recFilePath = join(recordingsDir, `meeting-${meetingId}.mp4`);
  writeFileSync(recFilePath, Buffer.from('test mp4'));

  const config = {
    ...loadConfig({ LLM_PROVIDER: 'demo' }),
    dataFile,
    livekitRecordingsDir: recordingsDir,
    authEnabled: true,
  };

  const context = createApp(config, {
    livekitProbe: async () => [],
    fetchImpl: async () => Response.json({}),
  });

  const server = context.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  t.after(async () => {
    context.close();
    await new Promise(resolve => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  });

  // Without session cookie when auth is enabled -> 401
  const unauthRes = await fetch(`${base}/meetings/${meetingId}/recording`);
  assert.equal(unauthRes.status, 401);

  const unauthDlRes = await fetch(`${base}/meetings/${meetingId}/recording/download`);
  assert.equal(unauthDlRes.status, 401);
});

