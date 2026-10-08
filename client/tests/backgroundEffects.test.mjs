import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BackgroundEffectSession, NO_BACKGROUND, BLUR_BACKGROUND, backgroundOptions, validateBackgroundFile, shouldMirrorCamera } from '../src/backgroundEffects.ts';

test('image backgrounds preserve readable text while plain/blur cameras follow mirror preference', () => {
  for (const choice of [undefined, NO_BACKGROUND, BLUR_BACKGROUND]) {
    assert.equal(shouldMirrorCamera(true, choice), true);
    assert.equal(shouldMirrorCamera(false, choice), false);
  }
  for (const id of ['skyline', 'sentra', 'studio', 'upload']) {
    assert.equal(shouldMirrorCamera(true, { id, label: id, imagePath: 'blob:image' }), false);
    assert.equal(shouldMirrorCamera(false, { id, label: id, imagePath: 'blob:image' }), false);
  }
});

function fixture() {
  const calls = [], processors = [];
  const factory = options => {
    const p = { options, async switchTo(next) { calls.push(['switch', next.mode]); p.options = next; }, async destroy() { calls.push(['destroy']); } };
    processors.push(p); return p;
  };
  const makeTrack = () => {
    let processor;
    return { getProcessor: () => processor, async setProcessor(p) { processor = p; calls.push(['attach']); }, async stopProcessor() { calls.push(['stop']); await processor?.destroy(); processor = undefined; } };
  };
  return { calls, processors, factory, makeTrack, session: new BackgroundEffectSession(factory) };
}
test('camera background switches blur/image without duplicate processors and removes effect', async () => {
  const f = fixture(), track = f.makeTrack();
  await f.session.apply(track, BLUR_BACKGROUND);
  await f.session.apply(track, { id: 'image', label: 'Office', imagePath: 'blob:local' });
  assert.equal(f.processors.length, 1);
  assert.deepEqual(f.processors[0].options, { mode: 'virtual-background', imagePath: 'blob:local' });
  await f.session.apply(track, NO_BACKGROUND);
  assert.equal(track.getProcessor().options.mode, 'disabled');
  assert.equal(f.calls.filter(([x]) => x === 'stop').length, 0);
  await f.session.close();
  assert.equal(track.getProcessor(), undefined);
});
test('camera replacement releases old processor and creates a fresh one', async () => {
  const f = fixture(), old = f.makeTrack(), replacement = f.makeTrack();
  await f.session.apply(old, BLUR_BACKGROUND); await f.session.apply(replacement, BLUR_BACKGROUND);
  assert.equal(old.getProcessor(), undefined);
  assert.equal(f.processors.length, 2);
  await f.session.close(); assert.equal(replacement.getProcessor(), undefined);
});
test('leaving during model initialization waits then releases camera processing', async () => {
  const f = fixture(), track = f.makeTrack();
  let release;
  const original = track.setProcessor;
  track.setProcessor = async p => { await new Promise(resolve => { release = resolve; }); await original(p); };
  const applying = f.session.apply(track, BLUR_BACKGROUND);
  await new Promise(resolve => setImmediate(resolve));
  const closing = f.session.close();
  release();
  assert.equal(await applying, false); await closing;
  assert.equal(track.getProcessor(), undefined);
  assert.equal(await f.session.apply(track, BLUR_BACKGROUND), false);
});
test('processor failure cleans up and next selection can retry', async () => {
  const f = fixture(), track = f.makeTrack();
  await f.session.apply(track, BLUR_BACKGROUND);
  f.processors[0].switchTo = async () => { throw new Error('GPU unavailable'); };
  await assert.rejects(f.session.apply(track, { id: 'image', label: 'Image', imagePath: 'blob:local' }), /GPU/);
  assert.equal(track.getProcessor(), undefined);
  assert.equal(await f.session.apply(track, BLUR_BACKGROUND), true);
  await f.session.close();
});
test('background uploads reject unsupported, empty and oversized files', () => {
  for (const type of ['image/jpeg','image/png','image/webp']) assert.doesNotThrow(() => validateBackgroundFile({ type, size: 512 }));
  assert.throws(() => validateBackgroundFile({ type: 'image/svg+xml', size: 512 }), /JPG/);
  assert.throws(() => validateBackgroundFile({ type: 'image/png', size: 0 }), /5 MB/);
  assert.throws(() => validateBackgroundFile({ type: 'image/png', size: 5 * 1024 * 1024 + 1 }), /5 MB/);
  assert.throws(() => backgroundOptions({ id: 'image', label: 'Invalid' }), /belum tersedia/);
});
