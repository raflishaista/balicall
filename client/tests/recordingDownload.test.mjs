import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recordingDownloadName} from '../src/recordingDownload.ts';
const response=(type,disposition)=>({headers:new Headers({'Content-Type':type,...(disposition?{'Content-Disposition':disposition}:{})})});
test('audio keeps the server OGG filename while video keeps MP4',()=>{
  assert.equal(recordingDownloadName(response('audio/ogg','attachment; filename="meeting-qc.ogg"'),'qc'),'meeting-qc.ogg');
  assert.equal(recordingDownloadName(response('video/mp4','attachment; filename="meeting-qc.mp4"'),'qc'),'meeting-qc.mp4');
});
test('missing or unsafe filename uses the media type instead of forcing audio to MP4',()=>{
  assert.equal(recordingDownloadName(response('audio/ogg'),'qc'),'balicall-recording-qc.ogg');
  assert.equal(recordingDownloadName(response('audio/ogg','attachment; filename="../wrong.mp4"'),'qc'),'balicall-recording-qc.ogg');
  assert.equal(recordingDownloadName(response('video/mp4'),'qc'),'balicall-recording-qc.mp4');
});
