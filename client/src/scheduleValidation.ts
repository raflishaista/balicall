export interface ScheduleValidationResult {
  valid: boolean;
  error: string | null;
  startDateTime?: Date;
  endDateTime?: Date;
}

export function pad2(num: number): string {
  return String(num).padStart(2, '0');
}

export function formatDateToInput(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function formatTimeToInput(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const DURATION_PRESETS = [
  { label: '15 mnt', minutes: 15 },
  { label: '30 mnt', minutes: 30 },
  { label: '45 mnt', minutes: 45 },
  { label: '1 jam', minutes: 60 },
  { label: '1.5 jam', minutes: 90 },
  { label: '2 jam', minutes: 120 },
];

export function calculateEndTime(startTimeStr: string, durationMinutes: number): string {
  if (!startTimeStr) return '';
  const [hours, mins] = startTimeStr.split(':').map(Number);
  const d = new Date();
  d.setHours(hours, mins, 0, 0);
  const newEnd = new Date(d.getTime() + durationMinutes * 60000);
  return formatTimeToInput(newEnd);
}

/**
 * Validates date, start time, and end time.
 * Forbids past dates and past hours/minutes.
 */
export function validateScheduleTime(
  dateStr: string,
  startTimeStr: string,
  endTimeStr: string,
  currentEpoch: number = Date.now()
): ScheduleValidationResult {
  if (!dateStr) return { valid: false, error: 'Pilih tanggal rapat.' };
  if (!startTimeStr) return { valid: false, error: 'Pilih waktu mulai rapat.' };
  if (!endTimeStr) return { valid: false, error: 'Pilih waktu selesai rapat.' };

  const [sYear, sMonth, sDay] = dateStr.split('-').map(Number);
  const [sHours, sMins] = startTimeStr.split(':').map(Number);
  const [eHours, eMins] = endTimeStr.split(':').map(Number);

  const startDateTime = new Date(sYear, sMonth - 1, sDay, sHours, sMins, 0);
  const endDateTime = new Date(sYear, sMonth - 1, sDay, eHours, eMins, 0);

  // 1. Check if date is in the past
  const now = new Date(currentEpoch);
  const todayZero = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const selectedDateZero = new Date(sYear, sMonth - 1, sDay, 0, 0, 0);
  if (selectedDateZero < todayZero) {
    return {
      valid: false,
      error: 'Tanggal rapat tidak boleh di masa lalu. Harap pilih hari ini atau tanggal mendatang.',
    };
  }

  // 2. Check if start time is in the past (allow 30 seconds tolerance for clock differences)
  if (startDateTime.getTime() < currentEpoch - 30000) {
    return {
      valid: false,
      error: 'Jam mulai tidak boleh di masa lalu. Harap pilih jam yang akan datang.',
    };
  }

  // 3. Check if end time is after start time
  if (endDateTime.getTime() <= startDateTime.getTime()) {
    return {
      valid: false,
      error: 'Waktu selesai harus lebih lambat dari waktu mulai rapat.',
    };
  }

  return { valid: true, error: null, startDateTime, endDateTime };
}
