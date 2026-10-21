import {test} from 'node:test';
import assert from 'node:assert/strict';
import {supportsSharedMicrophone,mediaChoices,DEFAULT_PREFERENCES} from '../src/preferences.ts';
test('Qwen shared microphone requires explicit live capability and never enables batch',()=>{
 assert.equal(supportsSharedMicrophone('qwen3-asr-0.6b'),false);
 assert.equal(supportsSharedMicrophone('qwen3-asr-0.6b',true),true);
 assert.equal(supportsSharedMicrophone('small'),true);
 const choices=mediaChoices({...DEFAULT_PREFERENCES,transcriptionModel:'qwen3-asr-0.6b',sharedRoomMic:true},true);
 assert.equal(choices.sharedRoomMic,true);assert.equal(choices.batchDiarization,false);
});
