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
    RECORDING_STT_MODEL: 'small', RECORDING_STT_MODELS: 'small', RECORDING_DIARIZERS: 'nemotron,pyannote' }),
    recordingUploadDir: join(directory, 'uploads'), dataFile: join(directory, 'meetings.json'), recordingPollMs: 1 };
  const context = createApp(config, { livekitProbe: async () => [], fetchImpl: async (url, options) => {
    if (url.endsWith('/audio/transcriptions/jobs')) {
      calls.push({ diarize: options.body.get('diarize'), diarizer: options.body.get('diarizer'), model: options.body.get('model') });
      return Response.json({ job_id: 'synthetic-job' });
    }
    assert.ok(url.endsWith('/audio/transcriptions/jobs/synthetic-job'));
    return Response.json({ status: 'done', result: { text: 'Rapat dimulai.', duration: 2,
      segments: [{ text: 'Rapat dimulai.', speaker: 'Pembicara 1', start: 0, end: 2 }] } });
  } });
  const server = context.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/recording-uploads`;
  t.after(async () => { context.close(); await new Promise(resolve => server.close(resolve)); rmSync(directory, { recursive: true, force: true }); });
  const choices = await (await fetch(base + '/options')).json();
  assert.deepEqual(choices.diarizer.options, ['none', 'nemotron', 'pyannote']);
  for (const diarizer of ['nemotron', 'none']) {
    const form = new FormData();
    form.append('title', 'Synthetic QA'); form.append('language', 'id');
    form.append('llmModel', config.llmModel); form.append('sttModel', 'small'); form.append('diarizer', diarizer);
    form.append('file', new Blob([Buffer.from('0000ftypSynthetic fixture')], { type: 'video/mp4' }), 'synthetic.mp4');
    const response = await fetch(base, { method: 'POST', body: form });
    const submitted = await response.json(); assert.equal(response.status, 202, JSON.stringify(submitted));
    assert.equal(submitted.upload.diarizer, diarizer);
    let stored;
    for (let tries = 0; tries < 100; tries++) {
      stored = (await (await fetch(base + '/' + submitted.upload.id)).json()).upload;
      if (['done', 'failed'].includes(stored.status)) break;
      await delay(20);
    }
    assert.equal(stored.status, 'done', JSON.stringify(stored));
    assert.equal(stored.diarizer, diarizer);
    assert.equal(stored.transcript.segments[0].speaker, 'Pembicara 1');
    assert.equal(calls.at(-1).diarize, diarizer === 'none' ? 'false' : 'true');
    assert.equal(calls.at(-1).diarizer, diarizer === 'none' ? null : diarizer);
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

});
