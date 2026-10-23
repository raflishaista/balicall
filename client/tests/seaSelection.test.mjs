import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SEA_LIVE_MODEL,SEA_LIVE_NOTICE,modelOptions,modelPreferencePatch,isLiveTranscriptionModel,liveTranscriptBody} from '../src/modelSelection.ts';
import {supportsSharedMicrophone,transcriptionModelLabel,mediaChoices,normalizePreferences,qwenDiarizationForModel} from '../src/preferences.ts';

test('SEA becomes selectable only after worker readiness and fixes language to Indonesian',()=>{
 assert.equal(modelOptions(['small']).find(x=>x.model===SEA_LIVE_MODEL).disabled,true);
 assert.equal(modelOptions([SEA_LIVE_MODEL]).find(x=>x.model===SEA_LIVE_MODEL).disabled,false);
 assert.equal(isLiveTranscriptionModel(SEA_LIVE_MODEL),true);
 assert.deepEqual(modelPreferencePatch(SEA_LIVE_MODEL),{transcriptionModel:SEA_LIVE_MODEL,speechLanguage:'id-ID',sharedRoomMic:false,liveDiarization:true,batchDiarization:false});
 assert.equal(supportsSharedMicrophone(SEA_LIVE_MODEL,true),true);
 assert.equal(mediaChoices(normalizePreferences({transcriptionModel:SEA_LIVE_MODEL,batchDiarization:true})).batchDiarization,false);
 assert.equal(transcriptionModelLabel(SEA_LIVE_MODEL),'SEA-ASR-ID · Live (Indonesia)');
 const final={text:'halo',segmentId:'one-1'};
 assert.deepEqual(liveTranscriptBody(final,SEA_LIVE_MODEL,'request'),{sttModel:SEA_LIVE_MODEL,final});
});

test('SEA uses its own diarizer capability and suspends saved shared mic while offline',()=>{
 const preferences=normalizePreferences({transcriptionModel:SEA_LIVE_MODEL,sharedRoomMic:true,liveDiarization:true});
 assert.equal(qwenDiarizationForModel(SEA_LIVE_MODEL,{qwenLiveDiarizationReady:true}),false);
 assert.equal(qwenDiarizationForModel(SEA_LIVE_MODEL,{seaLiveDiarizationReady:true}),true);
 assert.equal(mediaChoices(preferences,false).sharedRoomMic,false);
 assert.equal(mediaChoices(preferences,true).sharedRoomMic,true);
 assert.equal(preferences.sharedRoomMic,true);
});
test('SEA notice distinguishes participant microphone labels from acoustic voice separation',()=>{
 assert.match(SEA_LIVE_NOTICE,/QC produksi belum lulus/i);
 assert.match(SEA_LIVE_NOTICE,/akun peserta/i);
 assert.match(SEA_LIVE_NOTICE,/sesi mikrofon/i);
 assert.match(SEA_LIVE_NOTICE,/Nemotron/i);
 assert.equal(supportsSharedMicrophone(SEA_LIVE_MODEL,false),false);
});
