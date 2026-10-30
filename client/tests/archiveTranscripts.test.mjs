import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeArchiveTranscripts} from '../src/summaryHistory.ts';
test('database speaker names become UI fields without losing original segments',()=>{
 const raw={id:'one',speaker_id:'account',speaker_name:'Nama dari arsip',text:'Ucapan rapat',timestamp:'2026-10-28T02:00:00Z',segments:[{speaker:'Pembicara 2',sessionId:'session',attribution:'assigned',text:'Ucapan rapat'}]};
 const [result]=normalizeArchiveTranscripts([raw]);
 assert.equal(result.speakerName,'Nama dari arsip');assert.equal(result.speakerId,'account');
 assert.deepEqual(result.segments,raw.segments);assert.equal(raw.speakerName,undefined);
});
test('existing edited names win and empty names fall back to database then unknown',()=>{
 const values=normalizeArchiveTranscripts([{speakerName:'Nama edit',speaker_name:'Nama lama'},{speakerName:' ',speaker_name:'Nama tersimpan'},{speaker_name:null}]);
 assert.equal(values[0].speakerName,'Nama edit');assert.equal(values[1].speakerName,'Nama tersimpan');assert.equal(values[2].speakerName,'Pembicara tidak diketahui');
 assert.deepEqual(normalizeArchiveTranscripts(null),[]);
});
