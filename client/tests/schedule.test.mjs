import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateScheduleTime,
  slugify,
  calculateEndTime,
  formatDateToInput,
  formatTimeToInput,
  DURATION_PRESETS,
} from '../src/scheduleValidation.ts';

test('validateScheduleTime rejects missing date or time inputs', () => {
  assert.equal(validateScheduleTime('', '14:00', '15:00').valid, false);
  assert.equal(validateScheduleTime('', '14:00', '15:00').error, 'Pilih tanggal rapat.');

  assert.equal(validateScheduleTime('2026-10-10', '', '15:00').valid, false);
  assert.equal(validateScheduleTime('2026-10-10', '', '15:00').error, 'Pilih waktu mulai rapat.');

  assert.equal(validateScheduleTime('2026-10-10', '14:00', '').valid, false);
  assert.equal(validateScheduleTime('2026-10-10', '14:00', '').error, 'Pilih waktu selesai rapat.');
});

test('validateScheduleTime strictly rejects past dates', () => {
  // Epoch reference: 2026-10-06 10:00:00
  const fixedNow = new Date('2026-10-06T10:00:00.000Z').getTime();

  // Try yesterday
  const yesterday = '2026-10-05';
  const res = validateScheduleTime(yesterday, '14:00', '15:00', fixedNow);
  assert.equal(res.valid, false);
  assert.ok(res.error.includes('masa lalu'), 'Must mention masa lalu');
});

test('validateScheduleTime strictly rejects past hours and minutes for today', () => {
  // Mock current time: 2026-10-06 at 14:30
  const mockNow = new Date(2026, 9, 6, 14, 30, 0).getTime();

  // Selected date is today, but 13:00 (1.5 hours in past)
  const pastHour = validateScheduleTime('2026-10-06', '13:00', '14:00', mockNow);
  assert.equal(pastHour.valid, false);
  assert.ok(pastHour.error.includes('Jam mulai tidak boleh di masa lalu'));

  // Selected date is today, but 14:15 (15 minutes in past)
  const pastMinute = validateScheduleTime('2026-10-06', '14:15', '15:00', mockNow);
  assert.equal(pastMinute.valid, false);
  assert.ok(pastMinute.error.includes('Jam mulai tidak boleh di masa lalu'));
});

test('validateScheduleTime rejects end time earlier than or equal to start time', () => {
  const mockNow = new Date(2026, 9, 6, 10, 0, 0).getTime();

  // End time earlier than start time
  const inverted = validateScheduleTime('2026-10-06', '15:00', '14:00', mockNow);
  assert.equal(inverted.valid, false);
  assert.ok(inverted.error.includes('lebih lambat'));

  // End time same as start time
  const equal = validateScheduleTime('2026-10-06', '15:00', '15:00', mockNow);
  assert.equal(equal.valid, false);
  assert.ok(equal.error.includes('lebih lambat'));
});

test('validateScheduleTime accepts future dates and future hours', () => {
  const mockNow = new Date(2026, 9, 6, 10, 0, 0).getTime();

  // Valid today future time
  const todayFuture = validateScheduleTime('2026-10-06', '14:00', '15:00', mockNow);
  assert.equal(todayFuture.valid, true);
  assert.equal(todayFuture.error, null);
  assert.ok(todayFuture.startDateTime instanceof Date);
  assert.ok(todayFuture.endDateTime instanceof Date);

  // Valid future day
  const tomorrow = validateScheduleTime('2026-10-07', '09:00', '10:30', mockNow);
  assert.equal(tomorrow.valid, true);
  assert.equal(tomorrow.error, null);
});

test('slugify generates URL-friendly room names from titles', () => {
  assert.equal(slugify('Koordinasi Jaringan Fiber Q4'), 'koordinasi-jaringan-fiber-q4');
  assert.equal(slugify('  Rapat NOC & Transmisi -- Urgent!  '), 'rapat-noc-transmisi-urgent');
  assert.equal(slugify('Briefing Pagi @Site-Bali'), 'briefing-pagi-site-bali');
});

test('calculateEndTime adds minutes according to duration presets', () => {
  assert.equal(calculateEndTime('09:00', 30), '09:30');
  assert.equal(calculateEndTime('09:45', 30), '10:15');
  assert.equal(calculateEndTime('14:30', 60), '15:30');
  assert.equal(calculateEndTime('14:30', 90), '16:00');
  assert.ok(DURATION_PRESETS.length >= 4);
});

test('formatDateToInput and formatTimeToInput format valid ISO input strings', () => {
  const sample = new Date(2026, 9, 6, 14, 5, 0); // Oct 6, 2026, 14:05
  assert.equal(formatDateToInput(sample), '2026-10-06');
  assert.equal(formatTimeToInput(sample), '14:05');
});
