import {test} from 'node:test';
import assert from 'node:assert/strict';
import {QWEN_GGUF_LIVE_MODEL,isLiveTranscriptionModel,liveTranscriptBody,modelOptions} from '../src/modelSelection.ts';
import {qwenDiarizationForModel,supportsSharedMicrophone,transcriptionModelLabel} from '../src/preferences.ts';

test('Q8 diarization uses its own readiness and live model identity',()=>{
 assert.equal(isLiveTranscriptionModel(QWEN_GGUF_LIVE_MODEL),true);
 assert.equal(qwenDiarizationForModel(QWEN_GGUF_LIVE_MODEL,{qwenLiveDiarizationReady:true}),false);
 assert.equal(qwenDiarizationForModel(QWEN_GGUF_LIVE_MODEL,{qwenGgufLiveDiarizationReady:true}),true);
 assert.equal(supportsSharedMicrophone(QWEN_GGUF_LIVE_MODEL,false),false);
 assert.equal(supportsSharedMicrophone(QWEN_GGUF_LIVE_MODEL,true),true);
 assert.match(transcriptionModelLabel(QWEN_GGUF_LIVE_MODEL),/Q8/);
 const final={text:'tes',segmentId:'s-1',sessionProof:'signed'};
 assert.deepEqual(liveTranscriptBody(final,QWEN_GGUF_LIVE_MODEL,'r'),{sttModel:QWEN_GGUF_LIVE_MODEL,final});
 assert.equal(modelOptions([QWEN_GGUF_LIVE_MODEL]).find(x=>x.model===QWEN_GGUF_LIVE_MODEL).disabled,false);
});
