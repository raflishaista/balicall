import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

// This test process uses an in-memory PostgreSQL implementation, never a real server.
process.env.DATABASE_URL = '';
const database = new PGlite();
const query = (sql, params) => params?.length ? database.query(sql, params)
  : database.exec(sql).then(results => results.at(-1));
const original = Object.getOwnPropertyDescriptor(pg, 'Pool');
Object.defineProperty(pg, 'Pool', { configurable: true, value: class {
  on() {}
  query(sql, params) { return query(sql, params); }
  async connect() { return { query, release() {} }; }
} });
const { initDb } = await import('../db.js');
const { createApp } = await import('../app.js');
const { loadConfig } = await import('../config.js');
Object.defineProperty(pg, 'Pool', original);

test('upload choices reach the worker and database without losing speaker segments', async t => {
  t.after(() => database.close());
  assert.equal(await initDb('postgresql://synthetic/in-memory'), true);
  const directory = mkdtempSync(join(tmpdir(), 'balicall-upload-integration-'));
  const calls = [];
  const config = { ...loadConfig({ LLM_PROVIDER: 'demo', RECORDING_STT_URL: 'http://synthetic-worker/v1',
    RECORDING_STT_MODEL: 'small', RECORDING_STT_MODELS: 'small,small-id,base,sea',
    RECORDING_DIARIZERS: 'nemotron,pyannote', QWEN_STT_BASE_URL: 'http://synthetic-qwen/v1',
    QWEN_Q8_BATCH_URL: 'http://127.0.0.1:8017/v1', QWEN_Q8_BATCH_KEY: 'synthetic-key' }),
    recordingUploadDir: join(directory, 'uploads'), dataFile: join(directory, 'meetings.json'), recordingPollMs: 1 };
  config.recordingPyannoteUrl = 'http://127.0.0.1:8018/v1';
  config.recordingPyannoteKey = 'synthetic-key';
  config.recordingDiarizers.push('pyannote-jswook');
  const transcript = { text: 'Rapat dimulai.', duration: 2,
    segments: [{ text: 'Rapat dimulai.', speaker: 'Pembicara 1', start: 0, end: 2 }] };
  const qwen = 'qwen3-asr-0.6b';
  const q8 = 'qwen3-asr-0.6b-gguf-q8';
  let workerResult;
  let whisperReady = true;
  const context = createApp(config, { livekitProbe: async () => [], fetchImpl: async (url, options) => {
    if (url === 'http://synthetic-worker/health') {
      return Response.json({ recordingModels: whisperReady ? [{ model: 'small', diarizers: ['none', 'nemotron'] }] : [] });
    }
    if (url === 'http://synthetic-qwen/health') {
      return Response.json({ recordingModels: [{ model: qwen, diarizers: ['none'] }] });
    }
    if (url === 'http://127.0.0.1:8017/health') {
      return Response.json({ ready: true, model: q8, batchDiarization: true });
    }
    if (url === 'http://127.0.0.1:8018/health') {
      return Response.json({ recordingModels: [{ model: 'small', diarizers: ['pyannote-jswook'] }] });
    }
    if (url === `${config.recordingPyannoteUrl}/audio/transcriptions`) {
      const file = options.body.get('file');
      calls.push({ name: file.name, type: file.type, diarizer: 'pyannote-jswook' });
      return Response.json({ ...transcript, sttModelUsed: 'small', diarizerUsed: 'pyannote-jswook' });
    }
    if (url.endsWith('/audio/transcriptions/jobs')) {
      const file = options.body.get('file');
      calls.push({ name: file.name, type: file.type, diarize: options.body.get('diarize'), diarizer: options.body.get('diarizer') });
      return Response.json({ job_id: 'synthetic-job' });
    }
    assert.ok(url.endsWith('/audio/transcriptions/jobs/synthetic-job'));
    return Response.json({ status: 'done', result: workerResult });
  } });
  const server = context.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/recording-uploads`;
  t.after(async () => { context.close(); await new Promise(resolve => server.close(resolve)); rmSync(directory, { recursive: true, force: true }); });
  const choices = await (await fetch(base + '/options')).json();
  assert.deepEqual(choices.stt.models, ['small', qwen, q8]);
  assert.deepEqual(choices.diarizer.byModel, { small: ['none', 'nemotron', 'pyannote-jswook'], [qwen]: ['none'], [q8]: ['nemotron'] });
  const mp3Frame = Buffer.from([0xff, 0xfb, 0x90, 0x64]);
  const taggedMp3 = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 3]), Buffer.alloc(3), mp3Frame]);
  const mp4 = Buffer.from('0000ftypSynthetic fixture');
  async function submit(model, diarizer, extension, payload) {
    const form = new FormData();
    form.append('language', 'id');
    form.append('llmModel', config.llmModel); form.append('sttModel', model); form.append('diarizer', diarizer);
    form.append('file', new Blob([payload]), `Synthetic QA.${extension}`);
    return fetch(base, { method: 'POST', body: form });
  }
  async function finished(response) {
    const submitted = await response.json(); assert.equal(response.status, 202, JSON.stringify(submitted));
    assert.equal(submitted.upload.title, 'Synthetic QA');
    let stored;
    for (let tries = 0; tries < 100; tries++) {
      stored = (await (await fetch(base + '/' + submitted.upload.id)).json()).upload;
      if (['done', 'failed'].includes(stored.status)) break;
      await delay(20);
    }
    return stored;
  }
  for (const [model, diarizer, extension, type, payload] of [
    ['small', 'nemotron', 'mp4', 'video/mp4', mp4],
    [qwen, 'none', 'MP3', 'audio/mpeg', mp3Frame],
    ['small', 'pyannote-jswook', 'mp3', 'audio/mpeg', taggedMp3],
    [q8, 'nemotron', 'mp3', 'audio/mpeg', taggedMp3],
  ]) {
    workerResult = model === q8 ? { ...transcript, model, diarizer, speaker_scope: 'recording' }
      : { ...transcript, sttModelUsed: model, diarizerUsed: diarizer };
    const stored = await finished(await submit(model, diarizer, extension, payload));
    assert.equal(stored.status, 'done', JSON.stringify(stored));
    assert.equal(stored.diarizer, diarizer);
    assert.equal(stored.transcript.sttModelUsed, model);
    assert.equal(stored.transcript.diarizerUsed, diarizer);
    assert.equal(stored.transcript.segments[0]?.speaker, diarizer === 'none' ? undefined : 'Pembicara 1');
    assert.equal(calls.at(-1).name, `recording.${extension.toLowerCase()}`);
    assert.equal(calls.at(-1).type, type);
    if (diarizer !== 'pyannote-jswook') assert.equal(calls.at(-1).diarize, diarizer === 'none' ? 'false' : 'true');
    assert.equal(calls.at(-1).diarizer, diarizer === 'none' ? null : diarizer);
  }
  const callsBeforeRejection = calls.length;
  assert.equal((await submit('sea', 'none', 'mp4', mp4)).status, 400);
  assert.equal((await submit(q8, 'none', 'mp4', mp4)).status, 400);
  assert.equal((await submit('small', 'pyannote', 'mp4', mp4)).status, 400);
  whisperReady = false;
  assert.equal((await submit('small', 'nemotron', 'mp4', mp4)).status, 400);
  whisperReady = true;
  assert.equal(calls.length, callsBeforeRejection);

  workerResult = { ...transcript, sttModelUsed: 'base', diarizerUsed: 'nemotron' };
  const mismatch = await finished(await submit('small', 'nemotron', 'mp4', mp4));
  assert.equal(mismatch.status, 'failed');
  assert.match(mismatch.error, /model transkripsi yang dipilih/);
  assert.equal(mismatch.transcript, null);

  workerResult = { ...transcript, sttModelUsed: 'small', diarizerUsed: 'none' };
  const partial = await finished(await submit('small', 'nemotron', 'mp4', mp4));
  assert.equal(partial.status, 'done');
  assert.equal(partial.diarizer, 'nemotron');
  assert.equal(partial.transcript.diarizerUsed, 'none');
  assert.equal(partial.transcript.diarizationStatus, 'unavailable');
  assert.deepEqual(partial.transcript.segments, []);
  for (const [name, payload] of [['wrong.mp3', mp4], ['wrong.mp4', taggedMp3], ['unsupported.wav', mp3Frame]]) {
    const form = new FormData();
    form.append('file', new Blob([payload]), name);
    assert.equal((await fetch(base, { method: 'POST', body: form })).status, 415);
  }
  await t.test('manual speaker labels update persisted transcript rows without duplicating speech',async()=>{
    const {saveTranscripts}=await import('../db.js');
    await query("INSERT INTO balicall_meetings (id,room_name) VALUES ('named-speaker-qa','Synthetic room')");
    const entry={id:'named-entry',speakerId:'owner',speakerName:'Room',text:'Rapat',segments:[{speaker:'Pembicara 1',sessionId:'session-qa',sourceId:'owner',text:'Rapat'}]};
    await saveTranscripts('named-speaker-qa','Synthetic room',[entry]);
    entry.segments[0].speakerName='Budi';
    await saveTranscripts('named-speaker-qa','Synthetic room',[entry]);
    const rows=(await query("SELECT speaker_name FROM balicall_transcripts WHERE meeting_id='named-speaker-qa'")).rows;
    assert.equal(rows.length,1);assert.match(rows[0].speaker_name,/Budi/);
  });
  await t.test('PostgreSQL stores the batch revision separately and serves it over a later live summary',async()=>{
    const {savePostMeetingBatch,saveTranscripts,saveMeetingSummary,getMeetingDetails,getMeetingSummaries}=await import('../db.js');
    const id='post-batch-pg-qc';
    const meeting={id,roomName:'Synthetic batch QC',livekitRoom:'meeting-'+id,status:'ended',createdAt:new Date().toISOString(),endedAt:new Date().toISOString(),participants:new Map()};
    const summary={title:'Batch Qwen result',executiveSummary:'Synthetic result',keyDiscussionPoints:[],decisions:[],actionItems:[],attendanceSummary:[],provider:'Synthetic QC',generatedAt:new Date().toISOString(),transcriptSource:'qwen-post-meeting'};
    const batch={id:'batch-pg-1',status:'done',summary,transcripts:[{id:'batch-entry-1',speakerId:'recording',speakerName:'Rekaman rapat',text:'Batch text',timestamp:new Date().toISOString(),sttModel:'qwen3-asr-0.6b-batch',segments:[{speaker:'Pembicara 1',sessionId:'batch-pg-1',text:'Batch text',start:0,end:1}]}]};
    await savePostMeetingBatch(meeting,batch);
    await saveTranscripts(id,meeting.roomName,[{id:'live-pg-entry',speakerId:'owner',speakerName:'Owner',text:'Live original'}]);
    await saveMeetingSummary(id,meeting.roomName,{...summary,title:'Later live result'});
    await savePostMeetingBatch(meeting,batch);
    const details=await getMeetingDetails(id);
    assert.equal(details.summary.title,'Batch Qwen result');
    assert.equal(details.transcripts[0].text,'Batch text');
    assert.equal(details.liveTranscripts[0].text,'Live original');
    assert.equal(details.postMeetingBatch.transcripts[0].segments[0].sessionId,'batch-pg-1');
    assert.equal((await query('SELECT * FROM balicall_post_meeting_batches WHERE meeting_id=$1',[id])).rows.length,1);
    assert.equal((await getMeetingSummaries()).find(row=>row.meeting_id===id).title,'Batch Qwen result');
  });

  await t.test('summary source evidence survives PostgreSQL detail and archive reload',async()=>{
    const {saveMeeting,saveMeetingSummary,getMeetingDetails,getMeetingSummaries}=await import('../db.js');
    const meeting={id:'source-evidence-qc',roomName:'Evidence QC',status:'ended',createdAt:new Date().toISOString(),participants:new Map()};
    const evidence={version:1,transcriptDigest:'a'.repeat(64),utteranceCount:1,checkedFields:['decisions','actionItems'],items:[{field:'decisions',index:0,sources:[{utteranceId:'U0001',speaker:'QC',text:'Disepakati 13 juta.',quote:'Disepakati 13 juta.'}]}]};
    await saveMeeting(meeting);
    const summary={title:'Evidence',executiveSummary:'QC',keyDiscussionPoints:[],decisions:['Anggaran 13 juta.'],actionItems:[],attendanceSummary:[],sourceEvidence:evidence};
    assert.ok(await saveMeetingSummary(meeting.id,meeting.roomName,summary));
    assert.deepEqual((await getMeetingDetails(meeting.id)).summary.source_evidence,evidence);
    assert.deepEqual((await getMeetingSummaries(50)).find(row=>row.meeting_id===meeting.id).source_evidence,evidence);
  });

});
