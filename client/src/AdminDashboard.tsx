import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CalendarDays, ChevronRight, Clock, Download, FileText, HardDrive, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { API_BASE, ApiError, apiRequest } from './api';
import { AdminEmployeeActions, type AdminEmployee } from './AdminEmployeeActions';
import type { AdminSection } from './navigation';
import './AdminDashboard.css';

interface AuditEntry {
  id: string;
  actorId: string | null;
  targetId: string;
  action: string;
  result: string;
  previousValue: string | null;
  newValue: string | null;
  reason: string | null;
  occurredAt: string;
}

interface AuditPage {
  entries: AuditEntry[];
  actions: string[];
  total: number;
  page: number;
  pageSize: number;
}

const initialAuditFilters = { from: '', to: '', action: '', page: '1' };

const permissionLabels: Record<string, string> = {
  'accounts:manage': 'Kelola akun dan akses',
  'meetings:read': 'Lihat metadata rapat',
  'system:read': 'Lihat status sistem',
  'audit:read': 'Baca audit admin',
  'recordings:read': 'Lihat metadata rekaman unggahan',
};
const actionLabels: Record<string, string> = {
  'admin.bootstrap': 'Tetapkan Super Admin pertama',
  'admin.grant': 'Beri akses Super Admin',
  'admin.revoke': 'Cabut akses Super Admin',
  'account.status.change': 'Ubah status akun',
  'account.invite': 'Buat undangan aktivasi',
  'account.request.approve': 'Setujui permintaan aktivasi',
  'account.request.decline': 'Tolak permintaan aktivasi',
};
const resultLabels: Record<string, string> = {
  succeeded: 'Berhasil',
  no_change: 'Tanpa perubahan',
  denied: 'Ditolak',
};
const valueLabels: Record<string, string> = {
  active: 'Aktif', inactive: 'Nonaktif', super_admin: 'Super Admin', none: 'Tanpa akses admin',
};
const reasonLabels: Record<string, string> = {
  last_super_admin: 'Super Admin aktif terakhir',
  bootstrap_complete: 'Super Admin pertama sudah ditetapkan',
  account_not_found: 'Akun tidak ditemukan',
  account_not_activated: 'Akun belum aktif atau belum diaktivasi',
  account_inactive: 'Akun nonaktif',
  account_already_activated: 'Akun sudah diaktivasi',
  employee_email_missing: 'Email karyawan belum tersedia atau tidak valid',
  login_email_conflict: 'Email login sudah dipakai akun lain',
  admin_access_revoked: 'Akses pelaku sudah dicabut',
  request_not_found: 'Permintaan aktivasi tidak ditemukan',
  request_already_reviewed: 'Permintaan aktivasi sudah diproses',
};
const adminDate = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
const adminCheckDate = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'medium' });
const adminWibDate = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' });
const numberFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
function useAdminData<T>(path: string, refreshIntervalMs?: number) {
  const [result, setResult] = useState<{ key: string; data: T | null; error: string | null } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh(value => value + 1), []);
  const key = `${path}:${refresh}`;

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<T>(path, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setResult({ key, data, error: null });
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      const error = failure instanceof ApiError && failure.status === 403
        ? 'Halaman ini memerlukan akses Super Admin.'
        : failure instanceof Error ? failure.message : 'Data admin gagal dimuat.';
      const accessDenied = failure instanceof ApiError && (failure.status === 401 || failure.status === 403);
      setResult(previous => ({ key, data: accessDenied ? null : previous?.data ?? null, error }));
    });
    return () => controller.abort();
  }, [key, path]);

  const loading = result?.key !== key;
  useEffect(() => {
    if (!refreshIntervalMs || loading) return;
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    const timer = window.setInterval(refreshVisible, refreshIntervalMs);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [loading, refreshIntervalMs, reload]);

  return {
    data: result?.data ?? null,
    error: loading ? null : result.error,
    loading,
    reload,
  };
}

function AdminLoadState({ error, reload }: { error: string | null; reload: () => void }) {
  if (!error) return <p role="status">Memuat data admin…</p>;
  return <div className="admin-load-error">
    <p className="admin-error" role="alert">{error}</p>
    <button type="button" className="button-secondary" onClick={reload}>Coba lagi</button>
  </div>;
}

function formatUploadedBytes(bytes: string) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let value = Number(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${numberFormat.format(value)} ${units[unit]}`;
}

interface OverviewData {
  totalEmployees: number;
  activatedAccounts: number;
  totalMeetings: number;
  totalRecordings?: number;
  uploadedBytes: string;
  periodStart?: string;
  periodEnd?: string;
  dailyActivity?: DailyActivity[];
  recentActivity?: Array<{ id: string; kind: 'meeting_created' | 'recording_completed'; title: string | null; occurredAt: string }>;
}

interface DailyActivity {
  date: string;
  meetings: number;
  attendances: number;
  meetingsWithParticipants?: number;
}

const overviewDay = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'UTC' });
const overviewTick = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function overviewDateLabel(value: string | undefined, formatter: Intl.DateTimeFormat) {
  const timestamp = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? formatter.format(timestamp) : null;
}

const overviewSeries = [
  { key: 'meetings', color: 'meetings' },
  { key: 'attendances', color: 'attendances' },
] as const;

function OverviewActivityChart({ activity, meetingsLabel, weekly, periodEnd }: {
  activity: DailyActivity[];
  meetingsLabel: string;
  weekly: boolean;
  periodEnd?: string;
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [keyboardIndex, setKeyboardIndex] = useState(0);
  const interval = weekly ? 7 : 1;
  const points = activity.filter((_, index) => index % interval === 0).map((day, index) => {
    const days = activity.slice(index * interval, (index + 1) * interval);
    return {
      date: day.date,
      end: days[days.length - 1].date,
      meetings: days.reduce((total, item) => total + item.meetings, 0),
      attendances: days.reduce((total, item) => total + item.attendances, 0),
    };
  });
  const tickCount = Math.min(points.length, 5);
  const tickIndices = Array.from({ length: tickCount }, (_, index) =>
    Math.round(index * (points.length - 1) / Math.max(1, tickCount - 1)));
  const active = selectedIndex === null ? undefined : points[selectedIndex];
  const lastIndex = points.length - 1;
  const x = (index: number) => lastIndex === 0 ? 50 : index / lastIndex * 100;
  const labelFor = (point: (typeof points)[number]) => {
    const first = overviewDateLabel(point.date, overviewDay) ?? 'Tanggal belum tersedia';
    if (point.date === point.end) return first;
    return first + ' – ' + (overviewDateLabel(point.end, overviewDay) ?? '—');
  };
  const labels = { meetings: meetingsLabel, attendances: 'Kehadiran tercatat' };
  const partial = Boolean(periodEnd && points.at(-1)?.end === periodEnd.slice(0, 10));

  return (
    <section className="surface-card admin-section admin-trend" aria-labelledby="admin-activity-heading">
      <div className="admin-section-heading">
        <h3 id="admin-activity-heading">Tren penggunaan</h3>
        <span className="admin-check-time">{weekly ? 'Per minggu' : 'Per hari'}</span>
      </div>
      {points.length === 0 ? <p>Data tren belum tersedia.</p> : <>
        <div className={active ? 'admin-trend-readout is-selected' : 'admin-trend-readout'} aria-hidden="true">
          {active ? <>
            <strong>{labelFor(active)}</strong>
            <span>{meetingsLabel} <b>{numberFormat.format(active.meetings)}</b></span>
            <span>Kehadiran tercatat <b>{numberFormat.format(active.attendances)}</b></span>
          </> : <span>Pilih titik untuk melihat angkanya.</span>}
        </div>
        <span className="admin-trend-announcement" role="status" aria-atomic="true">
          {labelFor(points[keyboardIndex])}: {meetingsLabel} {numberFormat.format(points[keyboardIndex].meetings)}, Kehadiran tercatat {numberFormat.format(points[keyboardIndex].attendances)}
        </span>
        {overviewSeries.map(({ key, color }) => {
          const peak = Math.max(1, ...points.map(day => day[key]));
          const magnitude = 10 ** Math.floor(Math.log10(peak / 3));
          const step = Math.max(1, Math.ceil(peak / 3 / magnitude) * magnitude);
          const max = step * 3;
          const y = (value: number) => 100 - value / max * 100;
          const line = points.map((day, index) => x(index) + ',' + y(day[key])).join(' ');
          const area = x(0) + ',100 ' + line + ' ' + x(lastIndex) + ',100';
          return <div className={'admin-overview-series admin-overview-series--' + color} key={key}>
            <strong>{labels[key]}</strong>
            <div className="admin-overview-plot">
              <div className="admin-overview-scale" aria-hidden="true">
                {[max, step * 2, step, 0].map(value => <span key={value}>{numberFormat.format(value)}</span>)}
              </div>
              <div className="admin-trend-plot"
                tabIndex={key === 'meetings' ? 0 : undefined}
                role={key === 'meetings' ? 'group' : undefined}
                aria-label={key === 'meetings' ? 'Grafik tren. Gunakan panah kiri atau kanan untuk memilih tanggal.' : undefined}
                onFocus={key === 'meetings' ? () => setSelectedIndex(keyboardIndex) : undefined}
                onBlur={key === 'meetings' ? () => setSelectedIndex(null) : undefined}
                onKeyDown={key === 'meetings' ? event => {
                  let next = keyboardIndex;
                  switch (event.key) {
                    case 'ArrowLeft': next = Math.max(0, keyboardIndex - 1); break;
                    case 'ArrowRight': next = Math.min(lastIndex, keyboardIndex + 1); break;
                    case 'Home': next = 0; break;
                    case 'End': next = lastIndex; break;
                    default: return;
                  }
                  event.preventDefault();
                  setKeyboardIndex(next);
                  setSelectedIndex(next);
                } : undefined}
                onPointerMove={event => {
                  if (event.pointerType === 'touch') return;
                  const bounds = event.currentTarget.getBoundingClientRect();
                  setSelectedIndex(Math.max(0, Math.min(lastIndex, Math.round((event.clientX - bounds.left) / bounds.width * lastIndex))));
                }}
                onPointerDown={event => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const index = Math.max(0, Math.min(lastIndex, Math.round((event.clientX - bounds.left) / bounds.width * lastIndex)));
                  setKeyboardIndex(index);
                  setSelectedIndex(index);
                }}
                onPointerLeave={event => { if (event.pointerType !== 'touch') setSelectedIndex(event.currentTarget.matches(':focus-visible') ? keyboardIndex : null); }}>
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  <polygon className="admin-trend-area" points={area} />
                  <polyline className="admin-trend-line" points={line} vectorEffect="non-scaling-stroke" />
                </svg>
                <div aria-hidden="true">
                  {active && selectedIndex !== null && <span className="admin-trend-guide" style={{ left: x(selectedIndex) + '%' }} />}
                  {points.map((day, index) => (points.length <= 14 || index === selectedIndex) && <span
                    key={day.date} className={'admin-trend-dot' + (index === selectedIndex ? ' is-selected' : '')}
                    style={{ left: x(index) + '%', top: y(day[key]) + '%' }} />)}
                </div>
              </div>
              <div className="admin-overview-ticks" aria-hidden="true">
                {tickIndices.map(index => <span key={points[index].date} style={{ left: x(index) + '%' }}>
                  {overviewDateLabel(points[index].date, overviewTick) ?? '—'}
                </span>)}
              </div>
            </div>
          </div>;
        })}
        <div className="admin-trend-footer">
          <details>
            <summary><ChevronRight size={16} aria-hidden="true" /> Lihat data harian</summary>
            <div className="admin-table-scroll" tabIndex={0} role="region" aria-label="Tabel aktivitas harian">
              <table className="admin-table admin-overview-table">
                <thead><tr><th scope="col">Tanggal (WIB)</th><th scope="col">{meetingsLabel}</th><th scope="col">Kehadiran tercatat</th></tr></thead>
                <tbody>{activity.map(day => <tr key={day.date}>
                  <th scope="row">{overviewDateLabel(day.date, overviewDay) ?? '—'}</th>
                  <td>{numberFormat.format(day.meetings)}</td><td>{numberFormat.format(day.attendances)}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </details>
          {partial && <span className="admin-check-time">Hari ini · sementara</span>}
        </div>
      </>}
    </section>
  );
}


function AdminOverview() {
  const [days, setDays] = useState('30');
  const { data, loading, error, reload } = useAdminData<OverviewData>(`/admin/overview?days=${days}`);
  const periodStart = overviewDateLabel(data?.periodStart, overviewDay);
  const periodEnd = overviewDateLabel(data?.periodEnd, overviewDay);
  const daily = data?.dailyActivity;
  const hasAttendedCounts = Boolean(daily?.length && daily.every(day => Number.isFinite(day.meetingsWithParticipants)));
  const meetingsLabel = hasAttendedCounts ? 'Rapat dengan peserta' : 'Rapat tercatat';
  const activity = daily?.map(day => ({ ...day, meetings: hasAttendedCounts ? day.meetingsWithParticipants! : day.meetings }));
  const periodCards = data ? [
    { label: meetingsLabel, value: numberFormat.format(activity?.length ? activity.reduce((sum, day) => sum + day.meetings, 0) : data.totalMeetings), icon: CalendarDays },
    { label: 'Kehadiran tercatat', value: activity?.length ? numberFormat.format(activity.reduce((sum, day) => sum + day.attendances, 0)) : '—', icon: Users },
    { label: 'Rekaman diunggah', value: data.totalRecordings == null ? '—' : numberFormat.format(data.totalRecordings), icon: FileText,
      detail: data.uploadedBytes != null ? formatUploadedBytes(data.uploadedBytes) + (data.totalRecordings == null ? ' · seluruh waktu' : ' diunggah') : undefined },
  ] : [];
  return (
    <section className="admin-section admin-overview" aria-labelledby="admin-overview-heading">
      <div className="admin-section-heading">
        <h2 id="admin-overview-heading">Ringkasan penggunaan</h2>
        <label className="admin-field admin-overview-period">Periode aktivitas
          <select value={days} onChange={event => setDays(event.target.value)}>
            {[7, 30, 90].map(value => <option key={value} value={value}>{value} hari terakhir</option>)}
          </select>
        </label>
      </div>
      {loading || error ? <AdminLoadState error={error} reload={reload} /> : data && <>
        {periodStart && periodEnd ? <p className="admin-check-time">
          <time dateTime={data.periodStart}>{periodStart}</time>
          {' sampai '}
          <time dateTime={data.periodEnd}>{periodEnd}</time> WIB
        </p> : <p className="admin-monitor-notice" role="status">Rentang tanggal belum tersedia.</p>}
        <dl className="admin-kpis admin-overview-kpis" aria-label="Ringkasan periode aktivitas">
          {periodCards.map(({ label, value, detail, icon: Icon }) => (
            <div className="surface-card admin-kpi" key={label}>
              <Icon size={20} aria-hidden="true" />
              <div><dt>{label}</dt><dd>{value}{detail && <small>{detail}</small>}</dd></div>
            </div>
          ))}
        </dl>
        <div className="admin-overview-panels">
          <OverviewActivityChart key={days} activity={activity ?? []} meetingsLabel={meetingsLabel} weekly={days === '90'} periodEnd={data.periodEnd} />
          <section className="surface-card admin-section" aria-labelledby="admin-recent-activity-heading">
            <h2 id="admin-recent-activity-heading">Aktivitas terbaru</h2>
            {!Array.isArray(data.recentActivity) ? <p>Data aktivitas terbaru belum tersedia.</p> :
              data.recentActivity.length === 0 ? <p>Belum ada aktivitas pada periode ini.</p> :
              <ul className="admin-overview-events">{data.recentActivity.slice(0, 5).map(event => {
                const occurredAt = overviewDateLabel(event.occurredAt, adminWibDate);
                return <li key={`${event.kind}:${event.id}`}>
                  <a href={event.kind === 'meeting_created' ? '#/admin/meetings' : '#/admin/recordings'}>
                    <span className="admin-overview-event-text">
                      <strong>{event.kind === 'meeting_created' ? 'Rapat dibuat' : 'Rekaman selesai diproses'}</strong>
                      <span>{event.title || 'Tanpa judul'}</span>
                      {occurredAt ? <time dateTime={event.occurredAt}>{occurredAt} WIB</time> : <span>Waktu belum tercatat</span>}
                    </span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </a>
                </li>;
              })}</ul>}
          </section>
        </div>
        <section className="surface-card admin-section" aria-labelledby="admin-accounts-overview-heading">
          <div className="admin-section-heading">
            <h2 id="admin-accounts-overview-heading">Akun saat ini</h2>
            <a className="admin-overview-accounts-link" href="#/admin/employees">Buka Karyawan <ChevronRight size={16} aria-hidden="true" /></a>
          </div>
          <dl className="admin-kpis">
            <div className="admin-kpi"><Users size={20} aria-hidden="true" />
              <div><dt>Total karyawan</dt><dd>{numberFormat.format(data.totalEmployees)}</dd></div>
            </div>
            <div className="admin-kpi"><ShieldCheck size={20} aria-hidden="true" />
              <div><dt>Akun sudah diaktivasi</dt><dd>{numberFormat.format(data.activatedAccounts)}</dd></div>
            </div>
          </dl>
        </section>
      </>}
    </section>
  );
}

interface EmployeePage {
  employees: AdminEmployee[];
  departments: string[];
  statuses: string[];
  page: number;
  pageSize: number;
  total: number;
}

function AdminEmployees({ currentEmployeeId }: { currentEmployeeId: string }) {
  const [filters, setFilters] = useState({ q: '', department: '', status: '', page: '1' });
  const [selected, setSelected] = useState<AdminEmployee | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { data, loading, error, reload } = useAdminData<EmployeePage>(`/admin/employees?${new URLSearchParams(filters)}`);
  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setFilters({
      q: String(values.get('q') ?? '').trim(),
      department: String(values.get('department') ?? ''),
      status: String(values.get('status') ?? ''),
      page: '1',
    });
  };
  const goToPage = (page: number) => setFilters(previous => ({ ...previous, page: String(page) }));
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <section className="surface-card admin-section" aria-labelledby="admin-employees-heading">
      <h2 id="admin-employees-heading">Daftar karyawan</h2>
      {notice && <p className="admin-action-notice" role="status">{notice}</p>}
      <form className="admin-filters" onSubmit={applyFilters}>
        <label className="admin-field">Cari nama
          <input type="search" name="q" maxLength={100} placeholder="Nama karyawan" />
        </label>
        <label className="admin-field">Departemen
          <select name="department">
            <option value="">Semua departemen</option>
            {data?.departments.map(department => <option key={department}>{department}</option>)}
          </select>
        </label>
        <label className="admin-field">Status karyawan
          <select name="status">
            <option value="">Semua status</option>
            {data?.statuses.map(status => <option key={status} value={status}>{valueLabels[status] ?? status}</option>)}
          </select>
        </label>
        <button type="submit" className="button-primary">Terapkan</button>
      </form>
      {loading || error ? <AdminLoadState error={error} reload={reload} /> : data && (
        data.total === 0 ? <p role="status">Tidak ada karyawan yang cocok dengan filter.</p> : <>
          <div className="admin-table-scroll" tabIndex={0} role="region" aria-label="Tabel karyawan">
            <table className="admin-table" aria-label="Daftar karyawan">
              <thead><tr>
                <th scope="col">Nama</th><th scope="col">Departemen</th>
                <th scope="col">Status karyawan</th><th scope="col">Aktivasi akun</th>
                <th scope="col">Akses</th><th scope="col">Tindakan</th>
              </tr></thead>
              <tbody>{data.employees.map(employee => <tr key={employee.employeeId}>
                <td><strong>{employee.name}</strong><small>{employee.employeeId}</small></td>
                <td>{employee.department || '—'}</td>
                <td>{employee.status ? valueLabels[employee.status] ?? employee.status : 'Belum tercatat'}</td>
                <td>{employee.activated ? 'Sudah diaktivasi' : 'Belum diaktivasi'}</td>
                <td>{employee.isSuperAdmin ? 'Super Admin' : 'Karyawan'}</td>
                <td><button type="button" className="button-secondary" aria-label={`Kelola ${employee.name} (${employee.employeeId})`}
                  onClick={() => { setNotice(null); setSelected(employee); }}>Kelola</button></td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className="admin-pagination">
            <p role="status">{numberFormat.format(data.total)} karyawan · Halaman {data.page} dari {pages}</p>
            <div>
              <button type="button" className="button-secondary" disabled={data.page <= 1}
                onClick={() => goToPage(data.page - 1)}>Sebelumnya</button>
              <button type="button" className="button-secondary" disabled={data.page >= pages}
                onClick={() => goToPage(data.page + 1)}>Berikutnya</button>
            </div>
          </div>
        </>
      )}
      {selected && <AdminEmployeeActions employee={selected} onClose={() => setSelected(null)}
        onUpdated={(message, losesAdminAccess) => {
          if (losesAdminAccess && selected.employeeId === currentEmployeeId) {
            window.location.reload();
            return;
          }
          setSelected(null);
          setNotice(message);
          reload();
        }} />}
    </section>
  );
}

const meetingStatuses = {
  active: 'Berlangsung',
  empty: 'Kosong',
  unverified: 'Tidak dapat diverifikasi',
  waiting: 'Menunggu peserta',
  scheduled: 'Terjadwal',
  ended: 'Selesai',
  cancelled: 'Dibatalkan',
  expired: 'Jadwal berlalu',
};
type MeetingStatus = keyof typeof meetingStatuses;

interface MonitoredMeeting {
  id: string;
  title: string | null;
  hostName: string | null;
  status: MeetingStatus;
  scheduledStart: string | null;
  createdAt: string | null;
  startedAt: string | null;
  participantCount: number | null;
  durationSeconds: number | null;
}

function durationLabel(seconds: number | null) {
  if (seconds === null) return '—';
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) return '< 1 mnt';
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} jam ${minutes % 60} mnt` : `${minutes} mnt`;
}

function CheckTime({ value, showSeconds = false }: { value: string; showSeconds?: boolean }) {
  const formatter = showSeconds ? adminCheckDate : adminDate;
  return <p className="admin-check-time">Pengecekan terakhir <time dateTime={value}>{formatter.format(new Date(value))}</time></p>;
}

const MEETING_REFRESH_SECONDS = 15;

function AdminMeetingMonitoring() {
  const [status, setStatus] = useState('');
  const { data, loading, error, reload } = useAdminData<{
    meetings: MonitoredMeeting[]; livekitStatus: string; checkedAt: string;
  }>('/admin/meetings', MEETING_REFRESH_SECONDS * 1000);
  const rows = data?.meetings.filter(meeting => !status || meeting.status === status) ?? [];
  return (
    <section className="surface-card admin-section" aria-labelledby="admin-meetings-heading">
      <div className="admin-section-heading">
        <h2 id="admin-meetings-heading">Monitoring rapat</h2>
        <button type="button" className="button-secondary" disabled={loading} onClick={reload}>
          <RefreshCw size={16} aria-hidden="true" /> Perbarui
        </button>
      </div>
      {!data ? <AdminLoadState error={error} reload={reload} /> : <>
        <CheckTime value={data.checkedAt} showSeconds />
        <p className="admin-check-time">Diperbarui otomatis setiap {MEETING_REFRESH_SECONDS} detik saat tab terlihat.</p>
        {error && <p className="admin-monitor-notice" role="status">Pembaruan gagal. Tabel menampilkan data dari pengecekan terakhir.</p>}
        {data.livekitStatus !== 'reachable' &&
          <p className="admin-monitor-notice" role="status">LiveKit belum merespons. Jumlah peserta yang sedang terhubung belum tersedia.</p>}
        <label className="admin-field admin-meeting-filter">Status rapat
          <select value={status} onChange={event => setStatus(event.target.value)}>
            <option value="">Semua status</option>
            {Object.entries(meetingStatuses).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
        {rows.length === 0 ? <p role="status">{status ? 'Tidak ada rapat dengan status ini.' : 'Belum ada rapat yang tercatat.'}</p> :
          <div className="admin-table-scroll" tabIndex={0} role="region" aria-label="Tabel monitoring rapat">
            <table className="admin-table" aria-label="Daftar rapat">
              <thead><tr>
                <th scope="col">Rapat</th><th scope="col">Jadwal atau mulai</th><th scope="col">Host</th>
                <th scope="col">Peserta</th><th scope="col">Durasi</th><th scope="col">Status</th>
              </tr></thead>
              <tbody>{rows.map(meeting => {
                const date = meeting.scheduledStart ?? meeting.startedAt ?? meeting.createdAt;
                const startedSeparately = meeting.scheduledStart && meeting.startedAt;
                return <tr key={meeting.id}>
                  <td><strong>{meeting.title ?? 'Judul belum tercatat'}</strong></td>
                  <td>{date ? <time dateTime={date}>{adminDate.format(new Date(date))}</time> : '—'}
                    {startedSeparately && <small>Mulai {adminDate.format(new Date(startedSeparately))}</small>}
                  </td>
                  <td>{meeting.hostName ?? 'Belum tercatat'}</td>
                  <td>{meeting.participantCount === null ? '—' :
                    `${numberFormat.format(meeting.participantCount)} ${meeting.status === 'ended' ? 'hadir' : 'terhubung'}`}</td>
                  <td>{durationLabel(meeting.durationSeconds)}</td>
                  <td>{meetingStatuses[meeting.status]}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>}
      </>}
    </section>
  );
}

interface MeetingHistorySummary {
  totalEndedMeetings: number;
  totalDurationSeconds: number;
  durationSamples: number;
  averageParticipants: number | null;
  participantSamples: number;
}

interface MeetingHistoryPage {
  meetings: Array<{
    id: string;
    title: string;
    status: MeetingStatus;
    createdAt: string | null;
    endedAt: string | null;
    startedAt: string | null;
    hostName: string | null;
    participantCount: number | null;
    durationSeconds: number | null;
  }>;
  total: number;
  page: number;
  pageSize: number;
  summary?: MeetingHistorySummary;
}

const initialMeetingHistoryFilters = { q: '', from: '', to: '', page: '1' };

function AdminMeetingHistory() {
  const [inputFilters, setInputFilters] = useState(initialMeetingHistoryFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialMeetingHistoryFilters);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const { data, loading, error, reload } = useAdminData<MeetingHistoryPage>(
    `/admin/meetings/history?${new URLSearchParams(appliedFilters)}`
  );

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAppliedFilters({ ...inputFilters, page: '1' });
  };

  const resetFilters = () => {
    setInputFilters(initialMeetingHistoryFilters);
    setAppliedFilters(initialMeetingHistoryFilters);
  };

  const goToPage = (page: number) => {
    setAppliedFilters(previous => ({ ...previous, page: String(page) }));
  };

  const exportCsv = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const query = new URLSearchParams({
        q: appliedFilters.q,
        from: appliedFilters.from,
        to: appliedFilters.to,
      });
      const response = await fetch(`${API_BASE}/admin/meetings/history/export?${query}`, {
        credentials: 'include',
      });
      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        throw new Error(errJson?.error || `Ekspor CSV gagal (HTTP ${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'riwayat-rapat.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setExportError(err instanceof Error ? err.message : 'Gagal mengekspor riwayat rapat ke CSV.');
    } finally {
      setExporting(false);
    }
  };

  const filtered = appliedFilters.q || appliedFilters.from || appliedFilters.to;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section className="surface-card admin-section" aria-labelledby="admin-history-heading">
      <div className="admin-section-heading">
        <h2 id="admin-history-heading">Riwayat rapat selesai</h2>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="button-secondary"
            disabled={loading || exporting || data?.total === 0}
            onClick={exportCsv}
          >
            <Download size={16} aria-hidden="true" /> {exporting ? 'Mengekspor...' : 'Ekspor CSV'}
          </button>
          <button type="button" className="button-secondary" disabled={loading} onClick={reload}>
            <RefreshCw size={16} aria-hidden="true" /> Perbarui
          </button>
        </div>
      </div>

      <div className="admin-directory-summary">
        <dl className="admin-kpis">
          <div className="admin-kpi">
            <CalendarDays size={20} aria-hidden="true" />
            <div>
              <dt>Total rapat selesai</dt>
              <dd>{numberFormat.format(data?.summary?.totalEndedMeetings ?? data?.total ?? 0)}</dd>
              <small className="admin-check-time">Seluruh hasil filter</small>
            </div>
          </div>
          <div className="admin-kpi">
            <Clock size={20} aria-hidden="true" />
            <div>
              <dt>Total durasi</dt>
              <dd>
                {data?.summary && data.summary.durationSamples > 0
                  ? durationLabel(data.summary.totalDurationSeconds)
                  : 'Belum tersedia'}
              </dd>
              <small className="admin-check-time">
                {data?.summary && data.summary.durationSamples > 0
                  ? `Dari ${numberFormat.format(data.summary.durationSamples)} rapat`
                  : '0 sampel valid'}
              </small>
            </div>
          </div>
          <div className="admin-kpi">
            <Users size={20} aria-hidden="true" />
            <div>
              <dt>Rata-rata peserta</dt>
              <dd>
                {data?.summary?.averageParticipants != null
                  ? `${numberFormat.format(data.summary.averageParticipants)} orang`
                  : 'Belum tersedia'}
              </dd>
              <small className="admin-check-time">
                {data?.summary && data.summary.participantSamples > 0
                  ? `Dari ${numberFormat.format(data.summary.participantSamples)} rapat`
                  : '0 sampel valid'}
              </small>
            </div>
          </div>
        </dl>
        <p className="admin-summary-scope">Angka ringkasan mengikuti filter yang diterapkan.</p>
      </div>

      {exportError && <p className="admin-monitor-notice" role="alert">{exportError}</p>}

      <form className="admin-filters" aria-label="Filter riwayat rapat" onSubmit={applyFilters} onReset={resetFilters}>
        <label className="admin-field">Judul rapat
          <input
            type="search"
            name="q"
            maxLength={100}
            placeholder="Cari judul rapat"
            value={inputFilters.q}
            onChange={e => setInputFilters(prev => ({ ...prev, q: e.target.value }))}
          />
        </label>
        <label className="admin-field">Tanggal awal (WIB)
          <input
            type="date"
            name="from"
            aria-describedby="admin-history-date-note"
            value={inputFilters.from}
            onChange={e => setInputFilters(prev => ({ ...prev, from: e.target.value }))}
          />
        </label>
        <label className="admin-field">Tanggal akhir (WIB)
          <input
            type="date"
            name="to"
            aria-describedby="admin-history-date-note"
            value={inputFilters.to}
            onChange={e => setInputFilters(prev => ({ ...prev, to: e.target.value }))}
          />
        </label>
        <button type="submit" className="button-primary">Terapkan</button>
        <button type="reset" className="button-secondary">Reset filter</button>
      </form>
      <p className="admin-check-time" id="admin-history-date-note">
        Filter memakai tanggal selesai. Jika waktu selesai belum tercatat, filter memakai tanggal pembuatan.
      </p>
      {loading || error ? <AdminLoadState error={error} reload={reload} /> : data && (
        data.total === 0 ? <p role="status">{filtered ? 'Tidak ada rapat yang cocok dengan filter.' : 'Belum ada rapat selesai yang tersimpan.'}</p> : <>
          <div className="admin-table-scroll" tabIndex={0} role="region" aria-label="Tabel riwayat rapat">
            <table className="admin-table" aria-label="Daftar rapat selesai">
              <thead><tr>
                <th scope="col">Rapat</th>
                <th scope="col">Waktu (WIB)</th>
                <th scope="col">Host</th>
                <th scope="col">Peserta</th>
                <th scope="col">Durasi</th>
                <th scope="col">Status</th>
              </tr></thead>
              <tbody>{data.meetings.map(meeting => <tr key={meeting.id}>
                <td><strong>{meeting.title}</strong></td>
                <td>
                  {meeting.endedAt ? <>Selesai <time dateTime={meeting.endedAt}>{adminWibDate.format(new Date(meeting.endedAt))}</time></>
                    : meeting.createdAt ? <>Dibuat <time dateTime={meeting.createdAt}>{adminWibDate.format(new Date(meeting.createdAt))}</time></>
                    : '—'}
                  {meeting.startedAt && <small>Mulai <time dateTime={meeting.startedAt}>{adminWibDate.format(new Date(meeting.startedAt))}</time></small>}
                </td>
                <td>{meeting.hostName ?? 'Belum tercatat'}</td>
                <td>{meeting.participantCount == null ? '—' : numberFormat.format(meeting.participantCount)}</td>
                <td>{durationLabel(meeting.durationSeconds)}</td>
                <td>{meetingStatuses[meeting.status] || 'Selesai'}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className="admin-pagination">
            <p role="status">{numberFormat.format(data.total)} rapat · Halaman {data.page} dari {pages}</p>
            <div>
              <button type="button" className="button-secondary" disabled={data.page <= 1}
                onClick={() => goToPage(data.page - 1)}>Sebelumnya</button>
              <button type="button" className="button-secondary" disabled={data.page >= pages}
                onClick={() => goToPage(data.page + 1)}>Berikutnya</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function AdminMeetings() {
  const [view, setView] = useState<'monitoring' | 'history'>('monitoring');
  return (
    <div className="admin-section">
      <div className="admin-meeting-views" role="group" aria-label="Tampilan rapat admin">
        <button type="button" aria-pressed={view === 'monitoring'}
          className={view === 'monitoring' ? 'button-primary' : 'button-secondary'}
          onClick={() => setView('monitoring')}>Monitoring</button>
        <button type="button" aria-pressed={view === 'history'}
          className={view === 'history' ? 'button-primary' : 'button-secondary'}
          onClick={() => setView('history')}>Riwayat rapat</button>
      </div>
      {view === 'monitoring' ? <AdminMeetingMonitoring /> : <AdminMeetingHistory />}
    </div>
  );
}

interface RecordingInventoryPage {
  recordings: Array<{
    id: string;
    title: string;
    fileSize: string | null;
    status: string;
    stage: string | null;
    createdAt: string | null;
  }>;
  total: number;
  totalUploads: number;
  uploadedBytes: string;
  page: number;
  pageSize: number;
}

const recordingStatuses = new Map([
  ['queued', 'Dalam antrean'],
  ['processing', 'Diproses'],
  ['done', 'Selesai'],
  ['failed', 'Gagal'],
]);
const recordingStages = new Map([
  ['transcribing', 'Transkripsi'],
  ['summarizing', 'Pembuatan ringkasan'],
]);
const initialRecordingFilters = { q: '', status: '', page: '1' };

function AdminRecordings() {
  const [filters, setFilters] = useState(initialRecordingFilters);
  const { data, loading, error, reload } = useAdminData<RecordingInventoryPage>(`/admin/recordings?${new URLSearchParams(filters)}`);
  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFilters({ q: String(form.get('q') ?? '').trim(), status: String(form.get('status') ?? ''), page: '1' });
  };
  const goToPage = (page: number) => setFilters(previous => ({ ...previous, page: String(page) }));
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section className="surface-card admin-section" aria-labelledby="admin-recordings-heading">
      <div className="admin-section-heading">
        <h2 id="admin-recordings-heading">Rekaman unggahan</h2>
        <button type="button" className="button-secondary" disabled={loading} onClick={reload}>
          <RefreshCw size={16} aria-hidden="true" /> Perbarui
        </button>
      </div>
      {data && !error && <dl className="admin-kpis">
        <div className="admin-kpi"><FileText size={20} aria-hidden="true" />
          <div><dt>Total unggahan</dt><dd>{numberFormat.format(data.totalUploads)}</dd></div>
        </div>
        <div className="admin-kpi"><HardDrive size={20} aria-hidden="true" />
          <div><dt>Ukuran file tercatat</dt><dd>{formatUploadedBytes(data.uploadedBytes)}</dd></div>
        </div>
      </dl>}
      <form className="admin-filters" aria-label="Filter rekaman unggahan" onSubmit={applyFilters}
        onReset={() => setFilters(initialRecordingFilters)}>
        <label className="admin-field">Judul rekaman
          <input type="search" name="q" maxLength={100} placeholder="Cari judul rekaman" />
        </label>
        <label className="admin-field">Status proses
          <select name="status">
            <option value="">Semua status</option>
            {Array.from(recordingStatuses, ([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <button type="submit" className="button-primary">Terapkan</button>
        <button type="reset" className="button-secondary">Reset filter</button>
      </form>
      {loading || error ? <AdminLoadState error={error} reload={reload} /> : data && (
        data.total === 0 ? <p role="status">{filters.q || filters.status ? 'Tidak ada rekaman yang cocok dengan filter.' : 'Belum ada rekaman unggahan.'}</p> : <>
          <div className="admin-table-scroll" tabIndex={0} role="region" aria-label="Tabel rekaman unggahan">
            <table className="admin-table" aria-label="Daftar rekaman unggahan">
              <thead><tr>
                <th scope="col">Judul</th><th scope="col">Diunggah (WIB)</th>
                <th scope="col">Ukuran</th><th scope="col">Status proses</th>
              </tr></thead>
              <tbody>{data.recordings.map(recording => {
                const stage = recording.status === 'processing' && recording.stage ? recordingStages.get(recording.stage) : null;
                return <tr key={recording.id}>
                  <td><strong>{recording.title}</strong></td>
                  <td>{recording.createdAt ? <time dateTime={recording.createdAt}>{adminWibDate.format(new Date(recording.createdAt))}</time> : '—'}</td>
                  <td>{recording.fileSize === null ? '—' : formatUploadedBytes(recording.fileSize)}</td>
                  <td>{recordingStatuses.get(recording.status) ?? 'Tidak diketahui'}{stage && <small>{stage}</small>}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <div className="admin-pagination">
            <p role="status">{numberFormat.format(data.total)} rekaman · Halaman {data.page} dari {pages}</p>
            <div>
              <button type="button" className="button-secondary" disabled={data.page <= 1}
                onClick={() => goToPage(data.page - 1)}>Sebelumnya</button>
              <button type="button" className="button-secondary" disabled={data.page >= pages}
                onClick={() => goToPage(data.page + 1)}>Berikutnya</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

const serviceGroups = {
  core: 'Layanan inti',
  transcription: 'Transkripsi',
  diarization: 'Pemisah pembicara',
};
const serviceStatuses = {
  ready: 'Siap',
  unavailable: 'Tidak tersedia',
  not_configured: 'Belum dikonfigurasi',
  unverified: 'Belum terverifikasi',
};
interface MonitoredService {
  id: string;
  label: string;
  group: keyof typeof serviceGroups;
  status: keyof typeof serviceStatuses;
}

interface RecordingQueueMetrics {
  queued: number;
  processing: number;
  failed: number;
  medianCompletionSeconds: number | null;
  completionSampleSize: number;
}

function RecordingQueue({ metrics }: { metrics: RecordingQueueMetrics | null }) {
  const median = metrics?.medianCompletionSeconds;
  const counts = metrics ? [
    { label: 'Menunggu', count: metrics.queued },
    { label: 'Sedang diproses', count: metrics.processing },
    { label: 'Gagal', count: metrics.failed },
  ] : [];
  return (
    <section className="surface-card admin-section" aria-labelledby="admin-recording-queue-heading">
      <h3 id="admin-recording-queue-heading">Antrean unggahan</h3>
      {metrics ? <>
        <p>Durasi dihitung sejak unggah hingga pemrosesan terakhir selesai, termasuk waktu antre dan percobaan ulang.</p>
        <dl className="admin-kpis">
          {counts.map(({ label, count }) => (
            <div className="admin-kpi" key={label}>
              <div><dt>{label}</dt><dd>{numberFormat.format(count)}</dd></div>
            </div>
          ))}
          <div className="admin-kpi">
            <div>
              <dt>Median waktu sampai selesai (7 hari)</dt>
              <dd>{median == null ? 'Belum ada data' : median < 60 ? `${numberFormat.format(median)} detik` : durationLabel(median)}</dd>
              <small>{numberFormat.format(metrics.completionSampleSize)} sampel</small>
            </div>
          </div>
        </dl>
      </> : <p role="status">Metrik antrean tidak tersedia. Coba perbarui.</p>}
    </section>
  );
}

function AdminSystem() {
  const { data, loading, error, reload } = useAdminData<{
    services: MonitoredService[];
    checkedAt: string;
    recordingQueue: RecordingQueueMetrics | null;
  }>('/admin/system');
  return (
    <section className="admin-section" aria-labelledby="admin-system-heading">
      <div className="admin-section-heading">
        <h2 id="admin-system-heading">Status layanan</h2>
        <button type="button" className="button-secondary" disabled={loading} onClick={reload}>
          <RefreshCw size={16} aria-hidden="true" /> Perbarui
        </button>
      </div>
      {loading || error ? <AdminLoadState error={error} reload={reload} /> : data && <>
        <CheckTime value={data.checkedAt} />
        <RecordingQueue metrics={data.recordingQueue} />
        <div className="admin-service-groups">
          {Object.entries(serviceGroups).map(([key, label]) => (
            <section className="surface-card" key={key} aria-label={label}>
              <h3>{label}</h3>
              <ul className="admin-service-list">
                {data.services.filter(service => service.group === key).map(service => <li key={service.id}>
                  <span>{service.label}</span>
                  <strong className={`admin-service-state admin-service-state--${service.status}`}>{serviceStatuses[service.status]}</strong>
                </li>)}
              </ul>
            </section>
          ))}
        </div>
      </>}
    </section>
  );
}

function AdminAudit({ permissions }: { permissions: string[] }) {
  const [filters, setFilters] = useState(initialAuditFilters);
  const { data, loading, error, reload } = useAdminData<AuditPage>(`/admin/audit?${new URLSearchParams(filters)}`);
  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setFilters({
      from: String(values.get('from') ?? ''),
      to: String(values.get('to') ?? ''),
      action: String(values.get('action') ?? ''),
      page: '1',
    });
  };
  const goToPage = (page: number) => setFilters(previous => ({ ...previous, page: String(page) }));
  const filtered = filters.from || filters.to || filters.action;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <div className="admin-section">
      <section className="surface-card" aria-labelledby="admin-access-heading">
        <h2 id="admin-access-heading">Akses Super Admin</h2>
        <ul className="admin-permissions">
          {permissions.map(permission => <li key={permission}>{permissionLabels[permission] ?? permission}</li>)}
        </ul>
      </section>
      <section className="surface-card admin-section" aria-labelledby="admin-audit-heading">
        <div className="admin-section-heading">
          <h2 id="admin-audit-heading">Audit admin</h2>
          <button type="button" className="button-secondary" disabled={loading} onClick={reload}>
            <RefreshCw size={16} aria-hidden="true" /> Perbarui
          </button>
        </div>
        <form className="admin-filters" aria-label="Filter audit admin" onSubmit={applyFilters}
          onReset={() => setFilters(initialAuditFilters)}>
          <label className="admin-field">Tanggal awal (WIB)
            <input type="date" name="from" />
          </label>
          <label className="admin-field">Tanggal akhir (WIB)
            <input type="date" name="to" />
          </label>
          <label className="admin-field">Jenis tindakan
            <select name="action">
              <option value="">Semua tindakan</option>
              {data?.actions.map(action => <option key={action} value={action}>{actionLabels[action] ?? action}</option>)}
            </select>
          </label>
          <button type="submit" className="button-primary">Terapkan</button>
          <button type="reset" className="button-secondary">Reset filter</button>
        </form>
        {loading || error ? <AdminLoadState error={error} reload={reload} /> : data && (
          data.total === 0 ? <p role="status">
            {filtered ? 'Tidak ada tindakan yang cocok dengan filter.' : 'Belum ada tindakan yang tercatat.'}
          </p> : <>
            <div className="admin-table-scroll" tabIndex={0} role="region" aria-label="Tabel audit admin">
              <table className="admin-table" aria-label="Riwayat tindakan admin">
                <thead><tr>
                  <th scope="col">Waktu (WIB)</th><th scope="col">Pelaku</th><th scope="col">Target</th>
                  <th scope="col">Tindakan</th><th scope="col">Hasil</th>
                </tr></thead>
                <tbody>{data.entries.map(entry => <tr key={entry.id}>
                  <td><time dateTime={entry.occurredAt}>{adminWibDate.format(new Date(entry.occurredAt))}</time></td>
                  <td>{entry.actorId ?? 'Skrip penetapan awal'}</td>
                  <td>{entry.targetId}</td>
                  <td>{actionLabels[entry.action] ?? entry.action}</td>
                  <td>
                    <strong>{resultLabels[entry.result] ?? entry.result}</strong>
                    {entry.result === 'succeeded' && entry.newValue && <small>
                      {entry.previousValue && <>{valueLabels[entry.previousValue] ?? entry.previousValue} → </>}
                      {valueLabels[entry.newValue] ?? entry.newValue}
                    </small>}
                    {entry.reason && <small>{reasonLabels[entry.reason] ?? entry.reason}</small>}
                  </td>
                </tr>)}</tbody>
              </table>
            </div>
            <div className="admin-pagination">
              <p role="status">{numberFormat.format(data.total)} entri audit · Halaman {data.page} dari {pages}</p>
              <div>
                <button type="button" className="button-secondary" disabled={data.page <= 1}
                  onClick={() => goToPage(data.page - 1)}>Sebelumnya</button>
                <button type="button" className="button-secondary" disabled={data.page >= pages}
                  onClick={() => goToPage(data.page + 1)}>Berikutnya</button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

interface AdminActivationRequest {
  id: number;
  name: string;
  email: string;
  createdAt: string;
}

function AdminActivationRequests() {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const path = search ? `/admin/activation-requests?${new URLSearchParams({ q: search })}` : '/admin/activation-requests';
  const { data, loading, error, reload } = useAdminData<{ requests: AdminActivationRequest[] }>(path);

  const applySearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSearch(query.trim());
  };

  const reviewRequest = async (request: AdminActivationRequest, approve: boolean) => {
    if (busyId !== null) return;
    setBusyId(request.id);
    setActionError(null);
    setNotice(null);
    try {
      await apiRequest(`/admin/activation-requests/${request.id}/${approve ? 'approve' : 'decline'}`, {
        method: 'POST',
      });
      setNotice(
        approve
          ? `Permintaan ${request.name} (${request.email}) diterima. Akun telah diaktifkan dan dapat digunakan untuk masuk.`
          : `Permintaan ${request.name} (${request.email}) ditolak dan dihapus dari daftar.`,
      );
      reload();
    } catch (failure: unknown) {
      setActionError(failure instanceof Error ? failure.message : 'Permintaan gagal diproses.');
    } finally {
      setBusyId(null);
    }
  };

  const normalizedQuery = query.trim().toLowerCase();
  const visibleRequests = (data?.requests ?? []).filter(request =>
    !normalizedQuery
    || request.name.toLowerCase().includes(normalizedQuery)
    || request.email.toLowerCase().includes(normalizedQuery),
  );

  return (
    <section className="surface-card admin-section" aria-labelledby="admin-requests-heading">
      <div className="admin-section-header">
        <div>
          <h2 id="admin-requests-heading">Permintaan aktivasi akun</h2>
          <p className="admin-check-time">Tinjau pengajuan akun baru. Akun yang diterima langsung aktif dan dapat digunakan untuk masuk.</p>
        </div>
        <button type="button" className="button-secondary" onClick={reload} disabled={loading || busyId !== null}>
          <RefreshCw size={16} aria-hidden="true" /> Muat ulang
        </button>
      </div>
      {notice && <p className="admin-action-notice" role="status">{notice}</p>}
      {actionError && <p className="admin-inline-error" role="alert">{actionError}</p>}
      <form className="admin-filters" onSubmit={applySearch}>
        <label className="admin-field">Cari nama atau email
          <input
            type="search"
            value={query}
            onChange={event => {
              const next = event.target.value;
              setQuery(next);
              if (!next.trim() && search) setSearch('');
            }}
            maxLength={100}
            placeholder="Cari nama atau email pemohon"
          />
        </label>
        <button type="submit" className="button-primary" disabled={loading}>Cari</button>
      </form>
      {loading || error ? <AdminLoadState error={error} reload={reload} /> : (
        visibleRequests.length === 0
          ? <p role="status">{normalizedQuery || search ? 'Tidak ada permintaan aktivasi yang cocok dengan pencarian.' : 'Belum ada permintaan aktivasi yang menunggu persetujuan.'}</p>
          : <div className="admin-request-cards" role="list" aria-label="Daftar permintaan aktivasi">
              {visibleRequests.map(request => (
                <article key={request.id} className="admin-request-card" role="listitem">
                  <div className="admin-request-card-body">
                    <h3>{request.name}</h3>
                    <p className="admin-request-email">{request.email}</p>
                    <small className="admin-request-meta">Diajukan {adminDate.format(new Date(request.createdAt))}</small>
                  </div>
                  <div className="admin-request-card-actions">
                    <button
                      type="button"
                      className="button-primary"
                      disabled={busyId !== null}
                      onClick={() => void reviewRequest(request, true)}
                    >
                      {busyId === request.id ? 'Memproses…' : 'Terima'}
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={busyId !== null}
                      onClick={() => void reviewRequest(request, false)}
                    >
                      Tolak
                    </button>
                  </div>
                </article>
              ))}
            </div>
      )}
    </section>
  );
}

export default function AdminDashboard({ section }: { section: AdminSection }) {
  const { data, loading, error, reload } = useAdminData<{ employeeId: string; permissions: string[] }>('/admin/access');
  return (
    <div className={section === 'overview' ? 'dashboard-content admin-page admin-page--overview' : 'dashboard-content admin-page'}>
      <h1>Admin Dashboard</h1>
      {loading || error ? <AdminLoadState error={error} reload={reload} /> : data && <>
        {section === 'overview' && <AdminOverview />}
        {section === 'employees' && <AdminEmployees currentEmployeeId={data.employeeId} />}
        {section === 'requests' && <AdminActivationRequests />}
        {section === 'meetings' && <AdminMeetings />}
        {section === 'recordings' && <AdminRecordings />}
        {section === 'system' && <AdminSystem />}
        {section === 'audit' && <AdminAudit permissions={data.permissions} />}
      </>}
    </div>
  );
}
