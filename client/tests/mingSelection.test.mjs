import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MING_LIVE_MODEL, modelOptions, isLiveTranscriptionModel, modelPreferencePatch, liveTranscriptBody} from '../src/modelSelection.ts';
import {supportsSharedMicrophone,transcriptionModelLabel} from '../src/preferences.ts';

test('Ming is hidden even when the server advertises it',()=>{
 const options=modelOptions(['small','qwen3-asr-0.6b-live']);
 assert.equal(options.some(x=>x.model===MING_LIVE_MODEL),false);
 assert.equal(modelOptions(['small',MING_LIVE_MODEL,MING_LIVE_MODEL]).some(x=>x.model===MING_LIVE_MODEL),false);
});
test('Ming selects live English without enabling unsupported shared-microphone modes',()=>{
 assert.equal(isLiveTranscriptionModel(MING_LIVE_MODEL),true);
 assert.equal(isLiveTranscriptionModel('small'),false);
 assert.equal(supportsSharedMicrophone(MING_LIVE_MODEL,true),false);
 assert.deepEqual(modelPreferencePatch(MING_LIVE_MODEL),{transcriptionModel:MING_LIVE_MODEL,speechLanguage:'en-US',sharedRoomMic:false,liveDiarization:false,batchDiarization:false});
 assert.match(transcriptionModelLabel(MING_LIVE_MODEL),/Ming/);
});
test('final model identity is captured by the stream instead of forced to Qwen',()=>{
 const final={text:'hello',segmentId:'one-1'};
 const beforeSwitch=()=>liveTranscriptBody(final,MING_LIVE_MODEL,'request');
 assert.deepEqual(beforeSwitch(),{sttModel:MING_LIVE_MODEL,final});
 assert.deepEqual(liveTranscriptBody(final,'qwen3-asr-0.6b-live','request'),{sttModel:'qwen3-asr-0.6b-live',final});
 assert.deepEqual(liveTranscriptBody(' hello ','small','request'),{text:'hello',requestId:'request'});
 assert.throws(()=>liveTranscriptBody(final,'small','request'));
});
