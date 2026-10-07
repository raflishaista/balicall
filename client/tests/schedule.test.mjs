import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import {
  validateScheduleTime,
  slugify,
  generateRecommendedSlug,
  pad2,
  calculateEndTime,
  formatDateToInput,
  formatTimeToInput,
  DURATION_PRESETS,
} from '../src/scheduleValidation.ts';
import { useScheduleForm } from '../src/useScheduleForm.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

  // Same time at night is also rejected
  const equalNight = validateScheduleTime('2026-10-06', '23:30', '23:30', mockNow);
  assert.equal(equalNight.valid, false);
  assert.ok(equalNight.error.includes('lebih lambat'));
});

test('validateScheduleTime accepts overnight meetings spanning across midnight for evening/night shifts (SCHED-03)', () => {
  const mockNow = new Date(2026, 9, 6, 16, 0, 0).getTime();

  // 1 hour overnight meeting (23:30 to 00:30)
  const res1 = validateScheduleTime('2026-10-06', '23:30', '00:30', mockNow);
  assert.equal(res1.valid, true);
  assert.equal(res1.crossesMidnight, true);
  assert.equal(res1.error, null);
  assert.equal(res1.startDateTime.getDate(), 6);
  assert.equal(res1.endDateTime.getDate(), 7);
  assert.equal(res1.endDateTime.getTime() - res1.startDateTime.getTime(), 60 * 60 * 1000);

  // 4 hours shift meeting starting at 22:00 to 02:00
  const res2 = validateScheduleTime('2026-10-06', '22:00', '02:00', mockNow);
  assert.equal(res2.valid, true);
  assert.equal(res2.crossesMidnight, true);
  assert.equal(res2.endDateTime.getTime() - res2.startDateTime.getTime(), 4 * 60 * 60 * 1000);

  // 8 hours maximum shift starting at 17:00 to 01:00
  const res3 = validateScheduleTime('2026-10-06', '17:00', '01:00', mockNow);
  assert.equal(res3.valid, true);
  assert.equal(res3.crossesMidnight, true);
  assert.equal(res3.endDateTime.getTime() - res3.startDateTime.getTime(), 8 * 60 * 60 * 1000);
});

test('validateScheduleTime rejects daytime inverted times and overnight durations exceeding 8 hours (SCHED-03)', () => {
  const mockNow = new Date(2026, 9, 6, 8, 0, 0).getTime();

  // Daytime inverted (14:00 to 11:00) is rejected as user mistake, not overnight
  const resDay = validateScheduleTime('2026-10-06', '14:00', '11:00', mockNow);
  assert.equal(resDay.valid, false);
  assert.ok(resDay.error.includes('lebih lambat'));

  // Overnight exceeding 8 hours (e.g. 23:00 to 09:00 = 10 hours) is rejected
  const mockNight = new Date(2026, 9, 6, 21, 0, 0).getTime();
  const resTooLong = validateScheduleTime('2026-10-06', '23:00', '09:00', mockNight);
  assert.equal(resTooLong.valid, false);
  assert.ok(resTooLong.error.includes('lebih lambat'));
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
  // Midnight rollover
  assert.equal(calculateEndTime('23:30', 60), '00:30');
  assert.equal(calculateEndTime('23:00', 120), '01:00');
  assert.ok(DURATION_PRESETS.length >= 4);
});

test('formatDateToInput and formatTimeToInput format valid ISO input strings', () => {
  const sample = new Date(2026, 9, 6, 14, 5, 0); // Oct 6, 2026, 14:05
  assert.equal(formatDateToInput(sample), '2026-10-06');
  assert.equal(formatTimeToInput(sample), '14:05');
});

test('generateRecommendedSlug produces room names with day suffix from various date representations', () => {
  assert.equal(generateRecommendedSlug('Koordinasi Jaringan Fiber Q4', 6), 'koordinasi-jaringan-fiber-q4-06');
  assert.equal(generateRecommendedSlug('Koordinasi Jaringan Fiber Q4', '2026-10-06'), 'koordinasi-jaringan-fiber-q4-06');
  assert.equal(generateRecommendedSlug('  Rapat NOC & Transmisi -- Urgent!  ', new Date(2026, 9, 15)), 'rapat-noc-transmisi-urgent-15');
  assert.equal(generateRecommendedSlug('Briefing Pagi @Site-Bali', 2), 'briefing-pagi-site-bali-02');

  // Empty or non-slugifiable titles return empty string
  assert.equal(generateRecommendedSlug('', 6), '');
  assert.equal(generateRecommendedSlug('   ', 6), '');
  assert.equal(generateRecommendedSlug('!@#$%', 6), '');

  // Default date uses current day
  const todayDay = pad2(new Date().getDate());
  assert.equal(generateRecommendedSlug('Evaluasi Bulanan'), `evaluasi-bulanan-${todayDay}`);
});

function mountScheduleForm(initialProps = {}) {
  let formState;
  function Harness(props) {
    formState = useScheduleForm(props);
    return null;
  }
  let root;
  act(() => {
    root = create(React.createElement(Harness, initialProps));
  });
  return {
    get form() { return formState; },
    unmount: () => act(() => root.unmount()),
  };
}

test('useScheduleForm updates room slug incrementally as title is typed character by character', () => {
  const h = mountScheduleForm();
  const expectedDay = h.form.date.split('-')[2];

  // Typing character by character
  act(() => { h.form.handleTitleChange('K'); });
  assert.equal(h.form.roomSlug, `k-${expectedDay}`);

  act(() => { h.form.handleTitleChange('Ko'); });
  assert.equal(h.form.roomSlug, `ko-${expectedDay}`);

  act(() => { h.form.handleTitleChange('Koo'); });
  assert.equal(h.form.roomSlug, `koo-${expectedDay}`);

  act(() => { h.form.handleTitleChange('Koordinasi Jaringan'); });
  assert.equal(h.form.roomSlug, `koordinasi-jaringan-${expectedDay}`);

  // Backspacing title to empty clears room slug
  act(() => { h.form.handleTitleChange(''); });
  assert.equal(h.form.roomSlug, '');
});

test('useScheduleForm preserves manual room slug edits during subsequent title typing', () => {
  const h = mountScheduleForm();
  const expectedDay = h.form.date.split('-')[2];

  // Auto-generate initial slug
  act(() => { h.form.handleTitleChange('Koordinasi'); });
  assert.equal(h.form.roomSlug, `koordinasi-${expectedDay}`);

  // User manually edits room slug
  act(() => { h.form.handleRoomSlugChange('ruang-noc-khusus'); });
  assert.equal(h.form.roomSlug, 'ruang-noc-khusus');
  assert.equal(h.form.isSlugManual, true);

  // User types more into title
  act(() => { h.form.handleTitleChange('Koordinasi Jaringan Fiber Q4'); });
  // Custom slug is NOT overwritten
  assert.equal(h.form.roomSlug, 'ruang-noc-khusus');
});

test('useScheduleForm clearing manual room slug re-enables auto-generation on next title edit', () => {
  const h = mountScheduleForm();
  const expectedDay = h.form.date.split('-')[2];

  // Set title and then manual slug
  act(() => { h.form.handleTitleChange('Koordinasi'); });
  act(() => { h.form.handleRoomSlugChange('custom-slug'); });
  assert.equal(h.form.roomSlug, 'custom-slug');

  // User clears manual slug
  act(() => { h.form.handleRoomSlugChange(''); });
  assert.equal(h.form.roomSlug, '');
  assert.equal(h.form.isSlugManual, false);

  // User updates title; auto-slug resumes
  act(() => { h.form.handleTitleChange('Evaluasi Site Bali'); });
  assert.equal(h.form.roomSlug, `evaluasi-site-bali-${expectedDay}`);
});

test('useScheduleForm date change updates auto-slug suffix when not manually edited', () => {
  const h = mountScheduleForm();

  act(() => { h.form.handleTitleChange('Briefing'); });
  assert.ok(h.form.roomSlug.startsWith('briefing-'));

  // Change meeting date
  act(() => { h.form.handleDateChange('2026-10-25'); });
  assert.equal(h.form.roomSlug, 'briefing-25');

  // Now manually edit slug
  act(() => { h.form.handleRoomSlugChange('briefing-site-custom'); });
  assert.equal(h.form.isSlugManual, true);

  // Date change should NOT overwrite manually edited slug
  act(() => { h.form.handleDateChange('2026-10-30'); });
  assert.equal(h.form.roomSlug, 'briefing-site-custom');
});

test('useScheduleForm resetForm resets title, room slug, and manual slug flag', () => {
  const h = mountScheduleForm();
  const expectedDay = h.form.date.split('-')[2];

  // 1. Fill title, set manual slug, fill description
  act(() => {
    h.form.handleTitleChange('Rapat Fiber Optic');
    h.form.handleRoomSlugChange('ruang-fiber-utama');
    h.form.setDescription('Agenda evaluasi');
  });
  assert.equal(h.form.roomSlug, 'ruang-fiber-utama');
  assert.equal(h.form.isSlugManual, true);

  // 2. Reset form
  act(() => {
    h.form.resetForm();
  });

  assert.equal(h.form.title, '');
  assert.equal(h.form.roomSlug, '');
  assert.equal(h.form.description, '');
  assert.equal(h.form.isSlugManual, false);

  // 3. Next title typed after reset should auto-slug character by character
  act(() => { h.form.handleTitleChange('Agenda Baru'); });
  assert.equal(h.form.roomSlug, `agenda-baru-${expectedDay}`);
});

test('useScheduleForm duration preset correctly calculates end time across midnight and activates cross-midnight validation (SCHED-03)', () => {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const h = mountScheduleForm({ initialDate: tomorrow });

  act(() => {
    h.form.handleStartTimeChange('23:30');
  });
  act(() => {
    h.form.handleDurationPreset(60);
  });

  assert.equal(h.form.startTime, '23:30');
  assert.equal(h.form.endTime, '00:30');
  assert.equal(h.form.validation.valid, true);
  assert.equal(h.form.validation.crossesMidnight, true);
  assert.equal(h.form.validation.error, null);
  assert.ok(h.form.validation.startDateTime instanceof Date);
  assert.ok(h.form.validation.endDateTime instanceof Date);
  assert.equal(
    h.form.validation.endDateTime.getTime() - h.form.validation.startDateTime.getTime(),
    60 * 60 * 1000
  );
  assert.equal(h.form.validation.startDateTime.getDate(), tomorrow.getDate());
  const expectedEndDay = new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000).getDate();
  assert.equal(h.form.validation.endDateTime.getDate(), expectedEndDay);
});
