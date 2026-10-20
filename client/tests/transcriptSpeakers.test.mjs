import {test} from 'node:test';
import assert from 'node:assert/strict';
import {speakerDisplayLabel} from '../src/transcriptSpeakers.ts';
test('anonymous speaker labels display their session namespace',()=>{
 assert.equal(speakerDisplayLabel({speaker:'Pembicara 1'}),'Pembicara 1');
 const first=speakerDisplayLabel({speaker:'Pembicara 1',sessionId:'11111111-aaaa'});
 const next=speakerDisplayLabel({speaker:'Pembicara 1',sessionId:'22222222-bbbb'});
 assert.notEqual(first,next);assert.match(first,/sesi 11111111/);
 assert.equal(speakerDisplayLabel({speaker:'Pembicara 1',speakerName:'Budi',sessionId:'11111111-aaaa'}),'Budi · sesi 11111111');
});
