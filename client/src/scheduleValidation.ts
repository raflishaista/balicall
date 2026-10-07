export interface ScheduleValidationResult {
  valid: boolean;
  error: string | null;
  startDateTime?: Date;
  endDateTime?: Date;
  crossesMidnight?: boolean;
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

/**
 * Generates recommended room slug from meeting title with day-of-month suffix.
 * Returns empty string if title has no slugifiable characters.
 */
export function generateRecommendedSlug(
  title: string,
  dateOrDay: Date | number | string = new Date()
): string {
  const baseSlug = slugify(title);
  if (!baseSlug) return '';

  let dayStr = '';
  if (typeof dateOrDay === 'number') {
    dayStr = pad2(dateOrDay);
  } else if (typeof dateOrDay === 'string') {
    const parts = dateOrDay.split('-');
    if (parts.length === 3 && parts[2]) {
      const parsedDay = Number(parts[2]);
      dayStr = isNaN(parsedDay) ? pad2(new Date().getDate()) : pad2(parsedDay);
    } else {
      const parsed = new Date(dateOrDay);
      dayStr = isNaN(parsed.getDate()) ? pad2(new Date().getDate()) : pad2(parsed.getDate());
    }
  } else if (dateOrDay instanceof Date && !isNaN(dateOrDay.getTime())) {
    dayStr = pad2(dateOrDay.getDate());
  } else {
    dayStr = pad2(new Date().getDate());
  }

  return `${baseSlug}-${dayStr}`;
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
  let endDateTime = new Date(sYear, sMonth - 1, sDay, eHours, eMins, 0);
  let crossesMidnight = false;

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

  // 3. Check if end time is after start time or qualifies as a cross-midnight meeting
  if (endDateTime.getTime() <= startDateTime.getTime()) {
    if (endDateTime.getTime() === startDateTime.getTime()) {
      return {
        valid: false,
        error: 'Waktu selesai harus lebih lambat dari waktu mulai rapat.',
      };
    }

    const nextDayEnd = new Date(endDateTime.getTime() + 24 * 60 * 60 * 1000);
    const durationMinutes = (nextDayEnd.getTime() - startDateTime.getTime()) / (60 * 1000);

    // Overnight meetings starting in the evening/night with a realistic duration (<= 8 hours)
    if (sHours >= 17 && durationMinutes <= 8 * 60) {
      endDateTime = nextDayEnd;
      crossesMidnight = true;
    } else {
      return {
        valid: false,
        error: 'Waktu selesai harus lebih lambat dari waktu mulai rapat.',
      };
    }
  }

  return { valid: true, error: null, startDateTime, endDateTime, crossesMidnight };
}
