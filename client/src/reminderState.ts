import type { ScheduledMeeting } from './ScheduleView';

export const REMINDER_WINDOW_MS = 10 * 60_000;
export const DISMISSED_REMINDERS_KEY = 'balicall.dismissed-reminders.v1';
export const reminderKey = (meeting: ScheduledMeeting) => `${meeting.id}:${meeting.scheduledStart}`;

export function dueReminders(schedules: ScheduledMeeting[], now: number, dismissed: ReadonlySet<string>) {
  return schedules.filter(meeting => {
    const start = Date.parse(meeting.scheduledStart);
    const end = Date.parse(meeting.scheduledEnd);
    return meeting.status === 'scheduled' && Number.isFinite(start) && Number.isFinite(end)
      && end > start && start >= now && start - now <= REMINDER_WINDOW_MS
      && !dismissed.has(reminderKey(meeting));
  }).sort((a, b) => Date.parse(a.scheduledStart) - Date.parse(b.scheduledStart));
}

export function readDismissedReminders(storage: Pick<Storage, 'getItem'>): Set<string> {
  try {
    const values: unknown = JSON.parse(storage.getItem(DISMISSED_REMINDERS_KEY) || '[]');
    if (!Array.isArray(values)) return new Set();
    return new Set(values.filter((value): value is string => typeof value === 'string' && value.length <= 512).slice(-200));
  } catch { return new Set(); }
}

export function dismissReminder(storage: Pick<Storage, 'setItem'>, previous: ReadonlySet<string>, meeting: ScheduledMeeting) {
  const next = new Set([...previous, reminderKey(meeting)].slice(-200));
  try { storage.setItem(DISMISSED_REMINDERS_KEY, JSON.stringify([...next])); }
  catch { /* Keep dismissal in memory when this tab cannot write session storage. */ }
  return next;
}
