import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpeakerSpotlight } from '../src/speakerSpotlight.ts';

function fixture(ids = ['A', 'B', 'C']) {
  let time = 0, sequence = 0;
  const timers = new Map();
  const changes = [];
  const selection = createSpeakerSpotlight(ids, {
    now: () => time,
    setTimer(callback, delay) { const id = ++sequence; timers.set(id, { callback, at: time + delay }); return id; },
    clearTimer(id) { timers.delete(id); },
  });
  selection.subscribe(() => changes.push(selection.getSnapshot()));
  return {
    selection, changes,
    get pending() { return timers.size; },
    advance(ms) {
      const target = time + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next; time = timer.at; timers.delete(id); timer.callback();
      }
      time = target;
    },
  };
}

test('initial fallback retains arrival order despite roster reordering and new attendees', () => {
  const f = fixture(['', 'A', 'B', 'A']);
  f.selection.updateParticipants(['B', 'C', 'A']);
  assert.equal(f.selection.getSnapshot(), 'A');
  f.selection.updateParticipants(['C', 'B']);
  assert.equal(f.selection.getSnapshot(), 'B');
});

test('new speaker is promoted after the confirmation interval, then retained in silence', () => {
  const f = fixture();
  f.selection.updateSpeakers(['B']); f.advance(599);
  assert.equal(f.selection.getSnapshot(), 'A');
  f.advance(1); assert.equal(f.selection.getSnapshot(), 'B');
  f.selection.updateSpeakers([]); f.advance(10000);
  assert.equal(f.selection.getSnapshot(), 'B');
  assert.deepEqual(f.changes, ['B']);
});

test('brief speaking events cancel promotion without tile changes', () => {
  const f = fixture();
  for (let i = 0; i < 5; i++) {
    f.selection.updateSpeakers(['C']); f.advance(200);
    f.selection.updateSpeakers([]); f.advance(400);
  }
  assert.equal(f.selection.getSnapshot(), 'A');
  assert.deepEqual(f.changes, []);
  assert.equal(f.pending, 0);
});

test('overlapping latest speaker wins without following loudness-order fluctuations', () => {
  const f = fixture();
  f.selection.updateSpeakers(['A']); f.advance(1000);
  f.selection.updateSpeakers(['A', 'B']); f.advance(300);
  f.selection.updateSpeakers(['B', 'A']); f.advance(300);
  assert.equal(f.selection.getSnapshot(), 'B');
  for (let i = 0; i < 10; i++) { f.selection.updateSpeakers(i % 2 ? ['B', 'A'] : ['A', 'B']); f.advance(200); }
  assert.equal(f.selection.getSnapshot(), 'B');
  assert.deepEqual(f.changes, ['B']);
});

test('successive promotions respect minimum hold time', () => {
  const f = fixture();
  f.selection.updateSpeakers(['B']); f.advance(600);
  f.selection.updateSpeakers(['C']); f.advance(1199);
  assert.equal(f.selection.getSnapshot(), 'B');
  f.advance(1); assert.equal(f.selection.getSnapshot(), 'C');
});

test('candidate must still be speaking when the hold timer expires', () => {
  const f = fixture();
  f.selection.updateSpeakers(['B']); f.advance(600);
  f.selection.updateSpeakers(['C']); f.advance(800);
  f.selection.updateSpeakers([]); f.advance(400);
  assert.equal(f.selection.getSnapshot(), 'B');
  assert.equal(f.pending, 0);
});

test('leaving spotlight falls back to last confirmed remaining speaker', () => {
  const f = fixture();
  f.selection.updateSpeakers(['C']); f.advance(600);
  f.selection.updateSpeakers(['B']); f.advance(1200);
  f.selection.updateSpeakers([]);
  f.selection.updateParticipants(['A', 'C']);
  assert.equal(f.selection.getSnapshot(), 'C');
  f.selection.updateParticipants(['A']); assert.equal(f.selection.getSnapshot(), 'A');
  f.selection.updateParticipants([]); assert.equal(f.selection.getSnapshot(), null);
});

test('departed and unknown speaker identities cannot be promoted by late timers', () => {
  const f = fixture();
  f.selection.updateSpeakers(['C', 'unknown']); f.advance(100);
  f.selection.updateParticipants(['A', 'B']); f.advance(1000);
  assert.equal(f.selection.getSnapshot(), 'A');
  assert.equal(f.pending, 0);
});

test('disconnect cancels pending promotion; reconnect starts a fresh confirmation', () => {
  const f = fixture();
  f.selection.updateSpeakers(['B']); f.advance(300);
  f.selection.setConnected(false); f.advance(1000);
  assert.equal(f.selection.getSnapshot(), 'A');
  f.selection.updateSpeakers(['C']); assert.equal(f.pending, 0);
  f.selection.setConnected(true); f.selection.updateSpeakers(['C']);
  f.advance(599); assert.equal(f.selection.getSnapshot(), 'A');
  f.advance(1); assert.equal(f.selection.getSnapshot(), 'C');
});

test('simultaneous speaking starts use first SDK speaker as a deterministic tie-break', () => {
  const f = fixture();
  f.selection.updateSpeakers(['B', 'C']); f.advance(600);
  assert.equal(f.selection.getSnapshot(), 'B');
  f.selection.updateSpeakers(['C', 'B']); f.advance(2000);
  assert.equal(f.selection.getSnapshot(), 'B');
});

test('history keeps updating independently of presentation mode', () => {
  const f = fixture();
  // No screen-share flag is passed: the UI decides which stage to display.
  f.selection.updateSpeakers(['B']); f.advance(600);
  f.selection.updateSpeakers(['C']); f.advance(1200);
  assert.equal(f.selection.getSnapshot(), 'C');
  f.selection.updateSpeakers([]); assert.equal(f.selection.getSnapshot(), 'C');
});
