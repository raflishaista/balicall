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
test('participant attribution uses the saved account and microphone session, never a voice alias',()=>{
 const segment={speaker:'Peserta',speakerName:'Untrusted alias',attribution:'participant',sessionId:'11111111-aaaa'};
 assert.equal(speakerDisplayLabel(segment,'Rafli Aditya'),'Rafli Aditya · sesi 11111111');
 assert.equal(speakerDisplayLabel(segment),'Peserta · sesi 11111111');
 assert.equal(speakerDisplayLabel({...segment,sessionId:'22222222-bbbb'},'Rafli Aditya'),'Rafli Aditya · sesi 22222222');
 assert.equal(speakerDisplayLabel({speaker:'Peserta',attribution:'unknown',sessionId:'old-session'},'Rafli'),'Peserta · sesi old-sess');
});
