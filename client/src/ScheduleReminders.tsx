import { useState } from 'react';
import { Bell, X } from 'lucide-react';
import { useClock } from './useClock';
import { dismissReminder, dueReminders, readDismissedReminders } from './reminderState';
import type { ScheduledMeeting } from './ScheduleView';
import './ScheduleReminders.css';

export function ScheduleReminders({ schedules, enabled, available, failed, suppressed, onOpenSchedule, onRetry }: {
  schedules: ScheduledMeeting[]; enabled: boolean; available: boolean; failed: boolean; suppressed: boolean;
  onOpenSchedule: () => void; onRetry: () => void;
}) {
  const now = useClock();
  const [dismissed, setDismissed] = useState(() => {
    try { return readDismissedReminders(window.sessionStorage); } catch { return new Set<string>(); }
  });
  if (!enabled || suppressed) return null;
  if (!available) return failed ? <div className="schedule-reminders reminder-unavailable" role="status">
    <p>Pengingat belum diperbarui. Periksa kembali jadwal sebelum bergabung.</p>
    <button type="button" className="text-button" onClick={onRetry}>Perbarui jadwal</button>
  </div> : null;
  const due = dueReminders(schedules, now, dismissed);
  if (!due.length) return null;
  const dismiss = (meeting: ScheduledMeeting) => setDismissed(previous => {
    try { return dismissReminder(window.sessionStorage, previous, meeting); }
    catch { return dismissReminder({ setItem() {} }, previous, meeting); }
  });
  return <section className="schedule-reminders" aria-label="Pengingat jadwal">
    <div className="reminder-heading" role="status"><Bell size={17} aria-hidden="true" /><strong>{due.length} rapat segera dimulai</strong></div>
    <p className="reminder-note">Pengingat 10 menit sebelum rapat, selama aplikasi terbuka. Perubahan server diperiksa setiap 30 detik.</p>
    <ul>{due.slice(0, 3).map(meeting => <li key={meeting.id}>
      <div><strong>{meeting.title}</strong><span>{new Date(meeting.scheduledStart).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} · #{meeting.roomName}</span></div>
      <button type="button" className="icon-button" aria-label={`Tutup pengingat ${meeting.title}`} onClick={() => dismiss(meeting)}><X size={17} /></button>
    </li>)}</ul>
    <button type="button" className="text-button" onClick={onOpenSchedule}>Lihat jadwal{due.length > 3 ? ` (${due.length})` : ''}</button>
  </section>;
}
