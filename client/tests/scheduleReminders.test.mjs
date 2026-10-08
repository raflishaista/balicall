import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueReminders, reminderKey, readDismissedReminders, dismissReminder, REMINDER_WINDOW_MS } from '../src/reminderState.ts';
import { DEFAULT_PREFERENCES, normalizePreferences, readPreferences, writePreferences } from '../src/preferences.ts';

const now = Date.parse('2026-10-08T10:00:00Z');
const meeting = (id, delta = 60000, status = 'scheduled') => ({ id, title: id, status, scheduledStart: new Date(now + delta).toISOString(), scheduledEnd: new Date(now + delta + 3600000).toISOString() });

test('only valid upcoming scheduled meetings within ten minutes are due, in start order', () => {
  const schedules = [meeting('later', REMINDER_WINDOW_MS), meeting('soon'), meeting('far', REMINDER_WINDOW_MS + 1), meeting('past', -1), meeting('cancelled', 1000, 'cancelled'), meeting('started', 1000, 'started'), { ...meeting('invalid'), scheduledStart: 'invalid' }, { ...meeting('bad-end'), scheduledEnd: new Date(now).toISOString() }];
  assert.deepEqual(dueReminders(schedules, now, new Set()).map(s => s.id), ['soon', 'later']);
  assert.equal(dueReminders([meeting('start', 0)], now, new Set()).length, 1);
});

test('dismissal survives refresh in this tab, rescheduling produces a new reminder, cancellation removes it', () => {
  let value;
  const storage = { getItem: () => value, setItem: (_key, next) => { value = next; } };
  const original = meeting('room');
  dismissReminder(storage, new Set(), original);
  const dismissed = readDismissedReminders(storage);
  assert.equal(dueReminders([original], now, dismissed).length, 0);
  const moved = meeting('room', 120000);
  assert.notEqual(reminderKey(original), reminderKey(moved));
  assert.equal(dueReminders([moved], now, dismissed).length, 1);
  assert.equal(dueReminders([{ ...moved, status: 'cancelled' }], now, dismissed).length, 0);
  assert.equal(dueReminders([moved], now + 120001, dismissed).length, 0);
});

test('dismissal storage handles corrupt/blocked data and is bounded to 200 keys', () => {
  for (const value of ['broken', '{}', 'null', '[1,null,{}]']) assert.equal(readDismissedReminders({ getItem: () => value }).size, 0);
  assert.equal(readDismissedReminders({ getItem() { throw Error('blocked'); } }).size, 0);
  const next = dismissReminder({ setItem() { throw Error('blocked'); } }, new Set(Array.from({ length: 200 }, (_, i) => String(i))), meeting('new'));
  assert.equal(next.size, 200); assert.equal(next.has('0'), false); assert.equal(next.has(reminderKey(meeting('new'))), true);
});

test('old preferences migrate with reminders enabled; disabled setting persists without account data', () => {
  assert.equal(normalizePreferences({ reduceMotion: true }).scheduleReminders, true);
  assert.equal(normalizePreferences({ scheduleReminders: 'false' }).scheduleReminders, true);
  let raw;
  const storage = { getItem: () => raw, setItem: (_key, next) => { raw = next; } };
  writePreferences(storage, { ...DEFAULT_PREFERENCES, scheduleReminders: false, token: 'DO-NOT-STORE' });
  assert.equal(readPreferences(storage).preferences.scheduleReminders, false);
  assert.equal(raw.includes('DO-NOT-STORE'), false);
});
