import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { RoomEvent, ConnectionState } from 'livekit-client';
import { createTranscriptRealtime, decodeTranscriptNotice, TRANSCRIPT_TOPIC } from '../src/transcriptRealtime.ts';
import { createTranscriptDelivery } from '../src/transcriptDelivery.ts';

const entry = { id: 'saved-1', speakerId: 'a', speakerName: 'A', text: 'Saved text', timestamp: '2026-10-09T00:00:00Z' };
const payload = (id = entry.id, meetingId = 'meeting-a') => new TextEncoder().encode(JSON.stringify({ v: 1, meetingId, entryId: id, text: 'Forged text must never be displayed' }));
async function until(predicate) { const end = Date.now() + 2000; while (!predicate()) { if (Date.now() > end) throw new Error('Condition timed out'); await delay(5); } }
function fixture(t, overrides = {}) {
  const room = new EventEmitter(); room.state = ConnectionState.Connected;
  const sender = { identity: 'a' }; room.remoteParticipants = new Map([['a', sender]]);
  const sent = [], received = [], errors = []; let calls = 0;
  room.localParticipant = { publishData: async (...args) => { sent.push(args); } };
  const sync = createTranscriptRealtime(room, 'meeting-a', {
    fetchEntries: async () => { calls++; return [entry]; },
    onEntries: value => received.push(value), onError: value => errors.push(value),
    debounceMs: 1, reconciliationMs: 60000, ...overrides,
  });
  t.after(() => sync.dispose());
  return { room, sender, sync, sent, received, errors, get calls() { return calls; }, emit: (data = payload(), topic = TRANSCRIPT_TOPIC, participant = sender) => room.emit(RoomEvent.DataReceived, data, participant, undefined, topic) };
}

test('saved notices use reliable LiveKit topic and omit transcript text and tokens', async t => {
  const f = fixture(t); await f.sync.notifySaved(entry);
  assert.equal(f.sent.length, 1); assert.deepEqual(f.sent[0][1], { reliable: true, topic: TRANSCRIPT_TOPIC });
  assert.deepEqual(JSON.parse(new TextDecoder().decode(f.sent[0][0])), { v: 1, meetingId: 'meeting-a', entryId: entry.id });
});

test('peer notices trigger authenticated fetch, never inject payload text, and deduplicate', async t => {
  const f = fixture(t); await until(() => f.received.length === 1);
  f.emit(); await until(() => f.received.length === 2);
  assert.deepEqual(f.received[1], [entry]);
  for (let i = 0; i < 20; i++) f.emit();
  await delay(30); assert.equal(f.received.length, 2);
});

test('malformed, oversized, wrong-room/topic and unknown sender notices are ignored', async t => {
  const f = fixture(t); await until(() => f.received.length === 1);
  f.emit(new Uint8Array(1025)); f.emit(new TextEncoder().encode('{broken'));
  f.emit(payload('other', 'meeting-b')); f.emit(payload(), 'other-topic');
  f.emit(payload(), TRANSCRIPT_TOPIC, { identity: 'unknown' });
  f.room.emit(RoomEvent.DataReceived, payload(), undefined, undefined, TRANSCRIPT_TOPIC);
  await delay(30); assert.equal(f.received.length, 1);
  assert.equal(decodeTranscriptNotice(new Uint8Array([255]), 'meeting-a'), null);
  assert.equal(decodeTranscriptNotice(payload('', 'meeting-a'), 'meeting-a'), null);
});

test('a burst coalesces into one fetch and new notices during fetch cause one follow-up', async t => {
  let resolveFetch, calls = 0;
  const f = fixture(t, { fetchEntries: () => { calls++; return new Promise(resolve => { resolveFetch = resolve; }); } });
  await until(() => calls === 1);
  for (let i = 0; i < 20; i++) f.emit(payload('saved-' + i));
  resolveFetch([entry]); await until(() => calls === 2);
  resolveFetch([entry]); await until(() => f.received.length === 2);
  await delay(30); assert.equal(calls, 2);
});

test('connect and reconnect recover complete history without a peer notice', async t => {
  const f = fixture(t); await until(() => f.received.length === 1);
  f.room.state = ConnectionState.Reconnecting;
  f.emit(); await delay(10); assert.equal(f.received.length, 1);
  f.room.state = ConnectionState.Connected; f.room.emit(RoomEvent.Reconnected);
  await until(() => f.received.length === 2);
  f.room.emit(RoomEvent.Connected); await until(() => f.received.length === 3);
});

test('periodic reconciliation recovers missed notices and clears a fetch error', async t => {
  let calls = 0;
  const f = fixture(t, { reconciliationMs: 20, fetchEntries: async () => { if (++calls === 1) throw new Error('offline'); return [entry]; } });
  await until(() => f.errors.some(Boolean)); await until(() => f.received.length > 0);
  assert.equal(f.errors.at(-1), null);
});

test('publish failure does not throw or lose saved history and shows fallback status', async t => {
  const f = fixture(t); await until(() => f.received.length === 1);
  f.room.localParticipant.publishData = async () => { throw new Error('data channel offline'); };
  await f.sync.notifySaved(entry); assert.match(f.errors.at(-1), /Transkrip tersimpan/);
  f.room.emit(RoomEvent.Reconnected); await until(() => f.received.length === 2);
  assert.equal(f.errors.at(-1), null);
});

test('dispose aborts fetch, removes listeners, and ignores late completions', async t => {
  let signal, resolveFetch;
  const f = fixture(t, { fetchEntries: value => { signal = value; return new Promise(resolve => { resolveFetch = resolve; }); } });
  await until(() => signal); f.sync.dispose(); assert.equal(signal.aborted, true);
  resolveFetch([entry]); await delay(20); assert.equal(f.received.length, 0);
  assert.equal(f.room.listenerCount(RoomEvent.DataReceived), 0);
  assert.equal(f.room.listenerCount(RoomEvent.Reconnected), 0);
  await f.sync.notifySaved(entry); assert.equal(f.sent.length, 0);
});

test('late saves cannot update or broadcast into a newer meeting', async () => {
  const applied = [], published = [];
  const delivery = createTranscriptDelivery(value => applied.push(value));
  delivery.beginMeeting('old');
  delivery.register({ meetingId: 'old', notifySaved: async value => { published.push(value); } });
  delivery.saved({ meetingId: 'old', entry });
  delivery.beginMeeting('new');
  delivery.saved({ meetingId: 'old', entry: { ...entry, id: 'late' } });
  delivery.saved({ meetingId: 'new', entry: null });
  assert.equal(applied.length, 1); assert.equal(published.length, 1);
  delivery.saved({ meetingId: 'new', entry: { ...entry, id: 'new' } });
  assert.equal(applied.length, 2); assert.equal(published.length, 1);
});

test('old bridge cleanup cannot unregister a newer bridge; unmounted bridge keeps local saves', async () => {
  const applied = [], published = [];
  const delivery = createTranscriptDelivery(value => applied.push(value));
  delivery.beginMeeting('meeting-a');
  const oldCleanup = delivery.register({ meetingId: 'meeting-a', notifySaved: async () => { throw new Error('old'); } });
  const cleanup = delivery.register({ meetingId: 'meeting-a', notifySaved: async value => { published.push(value); } });
  oldCleanup(); delivery.saved({ meetingId: 'meeting-a', entry });
  assert.equal(published.length, 1);
  cleanup(); delivery.saved({ meetingId: 'meeting-a', entry: { ...entry, id: 'after-leave' } });
  assert.equal(applied.length, 2); assert.equal(published.length, 1);
});
