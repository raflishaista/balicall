import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeTranscripts} from '../src/transcriptMerge.ts';
const entry={id:'same-entry',speakerId:'owner',speakerName:'Room',text:'Rapat',timestamp:'2026-10-20T00:00:00Z'};
test('late pre-rename fetch/save responses cannot overwrite a newer manual speaker name',()=>{
 const old={...entry,segments:[{speaker:'Pembicara 1'}]};
 const named={...entry,revision:1,segments:[{speaker:'Pembicara 1',speakerName:'Budi'}]};
 assert.equal(mergeTranscripts([named],[old])[0].segments[0].speakerName,'Budi');
 const cleared={...entry,revision:2,segments:[{speaker:'Pembicara 1'}]};
 assert.equal(mergeTranscripts([cleared],[named])[0].segments[0].speakerName,undefined);
 assert.equal(mergeTranscripts([named],[cleared])[0].revision,2);
});
