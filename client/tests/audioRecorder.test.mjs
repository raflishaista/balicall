import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startAudioRecorder } from '../src/audioRecorder.ts';

class FakeRecorder {
  state = 'inactive'; mimeType = 'audio/webm'; starts = 0;
  start() { this.starts++; this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['container-header-and-audio']) }); this.onstop?.(new Event('stop')); });
  }
}
function setup(extra = {}) {
  const instances = [], audio = [], errors = [];
  const controller = startAudioRecorder({
    createRecorder: () => { const recorder = new FakeRecorder(); instances.push(recorder); return recorder; },
    hasVoice: () => true, onAudio: blob => audio.push(blob), onError: error => errors.push(error), segmentMs: 20,
    ...extra,
  });
  return { controller, instances, audio, errors };
}

test('backend STT receives independent complete recordings and the last segment is flushed', async () => {
  const { controller, instances, audio } = setup();
  await new Promise(resolve => setTimeout(resolve, 28));
  assert.equal(instances.length, 2);
  assert.equal(await audio[0].text(), 'container-header-and-audio');
  await controller.finish();
  assert.equal(audio.length, 2); assert.equal(instances.length, 2);
  controller.dispose();
});

test('silence-only segments are skipped', async () => {
  const { controller, audio } = setup({ hasVoice: () => false, segmentMs: 1000 });
  await controller.finish(); assert.equal(audio.length, 0); controller.dispose();
});

test('mute/disconnect cleanup discards future recorder events and prevents restart', async () => {
  const { controller, instances, audio } = setup({ segmentMs: 1000 });
  controller.dispose();
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(instances.length, 1); assert.equal(audio.length, 0);
});

test('recorder failures are visible and stop capture', () => {
  const { controller, instances, errors } = setup({ segmentMs: 1000 });
  instances[0].onerror(new Event('error'));
  assert.equal(errors.length, 1); assert.equal(instances[0].state, 'inactive'); controller.dispose();
});

test('missing stop event has a bounded finish timeout', async () => {
  const { controller, instances } = setup({ segmentMs: 1000, finishTimeoutMs: 20 });
  instances[0].stop = () => { instances[0].state = 'inactive'; };
  await assert.rejects(controller.finish(), /belum selesai/);
  controller.dispose();
});
