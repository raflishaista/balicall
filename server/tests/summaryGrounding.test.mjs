import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarize} from '../providers.js';
import {loadConfig} from '../config.js';
const config=loadConfig({LLM_PROVIDER:'office',LLM_KEY:'synthetic',LLM_RETRY_COUNT:'0'});
const meeting={roomName:'QC',participants:new Map(),transcripts:[{id:'one',speakerName:'Ketua',timestamp:'2026-10-27T02:00:00Z',text:'Siti, tolong periksa 12 perangkat sebelum Jumat pukul 15:00. Disepakati tanpa memutus koneksi.'}]};
const response=patch=>({title:'Pemeriksaan jaringan',executiveSummary:'Tim membahas pemeriksaan perangkat.',keyDiscussionPoints:[],decisions:['Pemeriksaan tanpa memutus koneksi.'],actionItems:[{task:'Periksa 12 perangkat tanpa memutus koneksi.',assignee:'Siti',deadline:'sebelum Jumat pukul 15:00',priority:'Medium'}],attendanceSummary:[],evidence:{decisions:[{index:0,sources:[{utteranceId:'U0001',quote:'Disepakati tanpa memutus koneksi.'}]}],actionItems:[{index:0,sources:[{utteranceId:'U0001',quote:meeting.transcripts[0].text}]}]},...patch});
const run=(value,subject=meeting,capture=()=>{})=>summarize(subject,config,async(_url,options)=>{capture(JSON.parse(options.body));return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});});
test('summary separates instructions from raw attributed transcript and does not rewrite text',async()=>{
 let request;const before=structuredClone(meeting);const value=await run(response(),meeting,body=>request=body);
 assert.equal(request.messages[0].role,'system');assert.match(request.messages[0].content,/untrusted/i);
 const input=JSON.parse(request.messages[1].content);assert.equal(input.utterances[0].text,meeting.transcripts[0].text);assert.deepEqual(meeting,before);
 assert.equal(value.sourceEvidence.version,1);assert.equal(value.sourceEvidence.items.length,2);
 assert.equal(value.actionItems[0].assignee,'Siti');
});
test('missing or invented citations fail instead of storing unsupported decisions',async()=>{
 for(const patch of [{evidence:undefined},{evidence:{decisions:[],actionItems:[]}}])await assert.rejects(run(response(patch)),/rujukan/i);
 const value=response();value.evidence.decisions[0].sources[0].quote='Disepakati migrasi besok';await assert.rejects(run(value),/kutipan/i);
 const unknown=response();unknown.evidence.actionItems[0].sources[0].utteranceId='U0099';await assert.rejects(run(unknown),/rujukan/i);
});
test('invented assignees, deadlines and numeric changes are rejected',async()=>{
 for(const patch of [{assignee:'Rian'},{deadline:'30 Oktober 2026'},{task:'Periksa 50 perangkat.'}]){
 const value=response();Object.assign(value.actionItems[0],patch);await assert.rejects(run(value),/rujukan|angka|PIC|tenggat/i);
 }
});
test('unknown assignment is allowed without borrowing account name',async()=>{
 const subject={...meeting,transcripts:[{speakerName:'Akun ruang',text:'Saya akan periksa koneksi.',segments:[{speaker:'Pembicara 1',attribution:'unknown',sessionId:'session-x',text:'Saya akan periksa koneksi.'}]}]};
 const value=response({decisions:[],actionItems:[{task:'Periksa koneksi.',assignee:'',deadline:'',priority:'Medium'}],evidence:{decisions:[],actionItems:[{index:0,sources:[{utteranceId:'U0001',quote:'Saya akan periksa koneksi.'}]}]}});
 assert.equal((await run(value,subject)).actionItems[0].assignee,'');
 value.actionItems[0].assignee='Akun ruang';await assert.rejects(run(value,subject),/PIC/);
});
test('summary keeps literal ASR words, negations, corrections, and final utterances in input',async()=>{
 const subject={...meeting,transcripts:[{speakerName:'QC',text:'Enok ikut perlombongan. Belum disepakati. Angka awal 12, koreksi menjadi 13.'},{speakerName:'QC',text:'Terakhir: usulan Jumat masih menunggu persetujuan.'}]};let request;
 await run(response({decisions:[],actionItems:[],evidence:{decisions:[],actionItems:[]}}),subject,body=>request=body);
 const input=JSON.parse(request.messages[1].content);assert.equal(input.utterances.length,2);assert.equal(input.utterances[0].text,subject.transcripts[0].text);assert.equal(input.utterances[1].text,subject.transcripts[1].text);
 assert.match(request.messages[0].content,/proposal|tentative/i);assert.match(request.messages[0].content,/correction/i);
});
test('truncated model output is rejected even if its prefix parses as valid JSON',async()=>{
 await assert.rejects(summarize(meeting,config,async()=>Response.json({choices:[{finish_reason:'length',message:{content:JSON.stringify(response())}}]})),/terpotong/i);
});
import {normalizeTranscriptText} from '../providers.js';
test('normalization does not guess a person name or change a phonetic word into another meaning',()=>{
 assert.equal(normalizeTranscriptText('Enok ikut perlombongan, bukan permohonan.'),'Enok ikut perlombongan, bukan permohonan.');
});
test('decimal values cannot be confused with whole numbers by citation validation',async()=>{
 const subject={...meeting,transcripts:[{speakerName:'QC',text:'Disepakati anggaran 1.5 juta.'}]};
 const value=response({decisions:['Anggaran 15 juta.'],actionItems:[],evidence:{decisions:[{index:0,sources:[{utteranceId:'U0001',quote:'Disepakati anggaran 1.5 juta.'}]}],actionItems:[]}});
 await assert.rejects(run(value,subject),/angka/i);
});

const decisionCase=(source,decision,quote=source)=>{
 const subject={...meeting,transcripts:[{id:'context',speakerName:'QC',text:source}]};
 return run(response({decisions:[decision],actionItems:[],evidence:{decisions:[{index:0,sources:[{utteranceId:'U0001',quote}]}],actionItems:[]}}),subject);
};

for(const [name,source,claim] of [
 ['quantity multiplier','Disepakati anggaran 13 juta rupiah.','Anggaran disetujui sebesar 13 miliar rupiah.'],
 ['negative sign','Disepakati perubahan target sebesar -3 persen.','Perubahan target sebesar 3 persen.'],
 ['unicode negative sign','Disepakati perubahan target sebesar −3 persen.','Perubahan target sebesar 3 persen.'],
 ['spoken negative sign','Disepakati perubahan target sebesar minus 3 persen.','Perubahan target sebesar 3 persen.'],
 ['currency','Disepakati biaya USD 13 juta.','Disepakati biaya IDR 13 juta.'],
 ['units attached to each number','Disepakati 12 router dan 13 server.','Disepakati 12 server dan 13 router.'],
 ['time versus decimal','Disepakati rapat pukul 15:00.','Disepakati nilai 15.00.'],
])test('citation validation rejects changed '+name,async()=>{
 await assert.rejects(decisionCase(source,claim),/angka|satuan|tanda|rujukan/i);
});

for(const [name,source,claim,quote] of [
 ['rejected proposal','Anggaran 13 juta belum disepakati; jangan mulai pembelian.','Disepakati anggaran 13 juta dan mulai pembelian.'],
 ['trimmed negation','Belum disepakati anggaran 13 juta.','Disepakati anggaran 13 juta.','disepakati anggaran 13 juta.'],
 ['unrelated negative phrase','Anggaran 13 juta belum disepakati; jangan mulai pembelian.','Disepakati anggaran 13 juta tanpa menunda pembelian.'],
 ['same-utterance correction','Disepakati 12 perangkat, koreksi menjadi 13 perangkat.','Disepakati 12 perangkat.','Disepakati 12 perangkat'],
 ['missing no-interruption condition','Disepakati migrasi tanpa memutus koneksi.','Disepakati migrasi dengan memutus koneksi.'],
])test('citation validation rejects loss of context: '+name,async()=>{
 await assert.rejects(decisionCase(source,claim,quote),/konteks|negasi|syarat|rujukan/i);
});

test('faithful positive paraphrases keep the same signed quantity, multiplier and unit',async()=>{
 for(const [source,claim] of [
  ['Disepakati anggaran 13 juta rupiah.','Anggaran sebesar 13 juta rupiah.'],
  ['Disepakati perubahan target sebesar −3 persen.','Perubahan target sebesar -3 persen.'],
  ['Disepakati 12 router dan 13 server.','Pengadaan 12 router dan 13 server.'],
 ])assert.equal((await decisionCase(source,claim)).decisions[0],claim);
});

test('a complete unchanged rejection is preserved without inventing approval',async()=>{
 const source='Anggaran 13 juta belum disepakati; jangan mulai pembelian.';
 assert.equal((await decisionCase(source,source)).decisions[0],source);
});

test('action items use the same numeric and uncertainty safeguards as decisions',async()=>{
 for(const [source,task] of [
  ['Siti, siapkan biaya 13 juta rupiah.','Siapkan biaya 13 miliar rupiah.'],
  ['Siti, jangan mulai pembelian sebelum persetujuan.','Mulai pembelian sebelum persetujuan.'],
 ]){
  const subject={...meeting,transcripts:[{speakerName:'QC',text:source}]};
  const value=response({decisions:[],actionItems:[{task,assignee:'Siti',deadline:'',priority:'Medium'}],evidence:{decisions:[],actionItems:[{index:0,sources:[{utteranceId:'U0001',quote:source}]}]}});
  await assert.rejects(run(value,subject),/angka|satuan|konteks|negasi|rujukan/i);
 }
});

test('a deadline after a monetary multiplier is not mistaken for a unit',async()=>{
 const text='Rina, kirim revisi anggaran 13 juta besok, tanpa memasukkan biaya lisensi.';
 const subject={...meeting,transcripts:[{speakerName:'Ketua',text}]};
 const value=response({decisions:[],actionItems:[{task:'Kirim revisi anggaran 13 juta tanpa memasukkan biaya lisensi.',assignee:'Rina',deadline:'besok',priority:'Medium'}],evidence:{decisions:[],actionItems:[{index:0,sources:[{utteranceId:'U0001',quote:text}]}]}});
 assert.equal((await run(value,subject)).actionItems[0].deadline,'besok');
});

test('a week duration cannot lose its unit as though it were a day name',async()=>{
 await assert.rejects(decisionCase('Disepakati pemeriksaan 3 minggu.','Disepakati pemeriksaan 3.'),/angka|satuan/i);
});

test('faithful Indonesian and English duration units remain equivalent',async()=>{
 assert.equal((await decisionCase('Disepakati pemeriksaan 3 minggu.','Pemeriksaan 3 weeks.')).decisions[0],'Pemeriksaan 3 weeks.');
});

test('English pending and canceled Indonesian plans cannot become approvals',async()=>{
 for(const [source,claim] of [
  ['No agreement reached on migration.','Agreement reached on migration.'],
  ['The migration is unapproved.','The migration is approved.'],
  ['Rencana migrasi dibatalkan.','Migrasi disetujui.'],
 ])await assert.rejects(decisionCase(source,claim),/konteks|negasi/i);
});
