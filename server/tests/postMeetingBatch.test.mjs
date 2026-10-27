import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { MeetingStore } from '../meetingStore.js';
import { createPostMeetingBatch, publicBatch } from '../postMeetingBatch.js';

function fixture(t, transform = x => x) {
  const dir = mkdtempSync(join(tmpdir(), 'balicall-post-batch-'));
  const store = new MeetingStore(join(dir, 'meetings.json'));
  const session = store.join('batch-test', { employeeId: 'host', employeeName: 'Host', department: 'QC' });
  const meeting = store.get(session.id);
  const now = new Date().toISOString();
  store.transact(() => {
    meeting.status = 'ended'; meeting.endedAt = now;
    meeting.recording = { egressId: 'EG-qc', startedAt: now, stoppedAt: now };
    meeting.transcripts = [{ id: 'live-original', text: 'Ucapan live', speakerName: 'Host', sttModel: 'qwen3-asr-0.6b-live' }];
    meeting.summary = { title: 'Live summary' };
  });
  writeFileSync(join(dir, `${meeting.livekitRoom}.mp4`), 'isolated-recording-fixture');
  const calls = [];
  const config = { qwenBatchEnabled: true, qwenBatchRecordingsDir: dir, qwenSttBaseUrl: 'http://worker/v1',
    recordingUploadMaxMb: 1, recordingPollMs: 2, recordingMaxProcessMin: 1 };
  let egressStatus = 3;
  const options = { store, config, egress: { async listEgress() { return [{ egressId: 'EG-qc', roomName: meeting.livekitRoom, status: egressStatus }]; } },
    fetchImpl: async (url, options) => {
      calls.push(url);
      if (url.endsWith('/health')) return Response.json({ ready: true, model: 'qwen3-asr-0.6b', batchDiarization: true });
      if (options.method === 'POST') {
        assert.equal(options.body.get('model'), 'qwen3-asr-0.6b');
        assert.equal(options.body.get('diarizer'), 'nemotron');
        assert.equal(options.body.get('diarize'), 'true');
        assert.equal(await options.body.get('file').text(), 'isolated-recording-fixture');
        return Response.json({ job_id: 'worker-qc-job' });
      }
      return Response.json({ status: 'done', result: transform({ model: 'qwen3-asr-0.6b', diarizer: 'nemotron', speaker_scope: 'recording', duration: 5,
        segments: [{ text: 'Pertama', speaker: 'Pembicara 1', start: 0, end: 1 },
          { text: 'Kedua', speaker: 'Pembicara 2', start: 2, end: 3 },
          { text: 'Kembali', speaker: 'Pembicara 1', start: 4, end: 5 }] }) });
    },
    summarize: async snapshot => ({ title: 'Batch summary', text: snapshot.transcripts.map(t => t.text).join(' ') }),
  };
  let controller = createPostMeetingBatch(options);
  t.after(() => { controller.close(); rmSync(dir, { recursive: true, force: true }); });
  return { store, meeting, calls, config, get controller() { return controller; },
    setEgressStatus(status) { egressStatus = status; },
    restart() { controller.close(); controller = createPostMeetingBatch(options); } };
}
async function finished(meeting) {
  for (let i = 0; i < 100 && !['done', 'failed'].includes(meeting.postMeetingBatch?.status); i++) await delay(5);
  return meeting.postMeetingBatch;
}

test('completed room recording produces a separate Qwen revision; live transcript stays intact and repeated calls deduplicate', async t => {
  const f = fixture(t);
  const [a, b] = await Promise.all([f.controller.start(f.meeting.id), f.controller.start(f.meeting.id)]);
  assert.equal(a.id, b.id);
  const job = await finished(f.meeting);
  assert.equal(job.status, 'done', job.error);
  assert.equal(job.transcripts.length, 3);
  assert.equal(job.transcripts[0].segments[0].sessionId, job.transcripts[2].segments[0].sessionId);
  assert.equal(job.summary.text, 'Pertama Kedua Kembali');
  assert.equal(f.meeting.transcripts[0].id, 'live-original');
  assert.equal(f.meeting.summary.title, 'Live summary');
  assert.equal(publicBatch(job).workerJobId, undefined);
  await f.controller.start(f.meeting.id);
  assert.equal(f.calls.filter(x => x.endsWith('/jobs')).length, 1);
  f.restart();
  assert.equal(f.meeting.postMeetingBatch.status, 'done');
});

test('unfinished Egress and incomplete recording are rejected before submitting any audio', async t => {
  const f = fixture(t);
  f.setEgressStatus(2);
  await assert.rejects(f.controller.start(f.meeting.id), e => e.status === 409);
  assert.equal(f.calls.length, 0);
  f.setEgressStatus(3);
  f.meeting.recordingRuns = 2;
  await assert.rejects(f.controller.start(f.meeting.id), e => e.status === 409);
  f.meeting.recordingRuns = 1;
  f.meeting.status = 'active';
  await assert.rejects(f.controller.start(f.meeting.id), e => e.status === 409);
});

test('out of range worker output fails without overwriting live or its summary', async t => {
  const f = fixture(t, data => ({ ...data, segments: [{ text: 'invalid', speaker: 'a', start: 0, end: 500 }] }));
  await f.controller.start(f.meeting.id);
  assert.equal((await finished(f.meeting)).status, 'failed');
  assert.equal(f.meeting.transcripts[0].text, 'Ucapan live');
  assert.equal(f.meeting.summary.title, 'Live summary');
});

test('wrong model provenance cannot publish batch minutes', async t => {
  const f = fixture(t, data => ({ ...data, model: 'whisper' }));
  await f.controller.start(f.meeting.id);
  assert.equal((await finished(f.meeting)).status, 'failed');
  assert.equal(f.meeting.postMeetingBatch.summary, undefined);
});


test('failed Egress stops automatic retry promptly with an actionable failure', async t => {
  const f=fixture(t);
  f.setEgressStatus(4);
  await assert.rejects(f.controller.start(f.meeting.id),e=>e.status===422 && /Egress/.test(e.message));
  f.meeting.postMeetingBatchRequested={language:'id'};
  f.controller.schedule(f.meeting.id);
  const job=await finished(f.meeting);
  assert.equal(job?.status,'failed');
  assert.match(job.error,/Egress/);
  assert.equal(f.calls.length,0);
});
