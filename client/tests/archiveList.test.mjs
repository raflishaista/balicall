import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeSummaryRecords,normalizeDbSummary,HISTORY_LIMIT} from '../src/summaryHistory.ts';
const row=(id,date,count)=>normalizeDbSummary({meeting_id:id,created_at:date,transcript_count:count,title:id});
test('server utterance counts survive normalization including zero and unknown',()=>{
 assert.equal(row('one','2026-10-28',1449).summary.transcriptCount,1449);
 assert.equal(row('empty','2026-10-28',0).summary.transcriptCount,0);
 assert.equal(row('unknown','2026-10-28').summary.transcriptCount,undefined);
});
test('descending server results stay newest first and older revisions cannot replace newer',()=>{
 const latest=row('new','2026-10-30',5),old=row('old','2026-10-28',3);
 const result=mergeSummaryRecords([], [latest,old,row('new','2026-10-27',1)]);
 assert.deepEqual(result.map(x=>x.meetingId),['new','old']);assert.equal(result[0].summary.transcriptCount,5);
 assert.equal(mergeSummaryRecords([latest],[])[0],latest);
 assert.equal(mergeSummaryRecords([],Array.from({length:30},(_,i)=>row(String(i),new Date(2026,9,i+1).toISOString(),i))).length,HISTORY_LIMIT);
});
