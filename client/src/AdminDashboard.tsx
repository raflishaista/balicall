import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Building2,
  Check,
  CheckCircle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Download,
  Eye,
  FileText,
  Filter,
  HardDrive,
  Info,
  Layers,
  MinusCircle,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Slash,
  ShieldCheck,
  Target,
  Users,
  User,
  Video,
  X,
  Zap,
} from 'lucide-react';
import { API_BASE, ApiError, apiRequest } from './api';
import { AdminEmployeeActions, type AdminEmployee } from './AdminEmployeeActions';
import type { AdminSection } from './navigation';
import type { ObserverSessionData } from './ObserverRoomView';
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
  actorName?: string;
  targetName?: string;
}

interface AuditPage {
  entries: AuditEntry[];
  actions: string[];
  total: number;
  page: number;
  pageSize: number;
  summary?: {
    total: number;
    succeeded: number;
    denied: number;
    noChange: number;
  };
  actors?: string[];
}

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
  'observer.session.start': 'Mulai pemantauan pribadi',
  'observer.session.end': 'Akhiri pemantauan pribadi',
  'observer.session.denied': 'Akses pemantauan ditolak',
  'observer.session.revoked': 'Sesi pemantauan dicabut',
  'observer.policy.violation': 'Pelanggaran izin pemantau',
};
const resultLabels: Record<string, string> = {
  succeeded: 'Berhasil',
  no_change: 'Tanpa perubahan',
  denied: 'Ditolak',
  failed: 'Gagal',
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
}

const overviewDay = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'UTC' });
const overviewTick = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function overviewDateLabel(value: string | undefined, formatter: Intl.DateTimeFormat) {
  const timestamp = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? formatter.format(timestamp) : null;
}

function OverviewActivityChart({ activity }: { activity: DailyActivity[] }) {
  const series = [
    { key: 'meetings', label: 'Rapat per hari' },
    { key: 'attendances', label: 'Kehadiran peserta per hari' },
  ] as const;
  const tickIndices = [...new Set([0, Math.floor((activity.length - 1) / 2), activity.length - 1])];
  const empty = activity.every(day => day.meetings === 0 && day.attendances === 0);
  return (
    <section className="surface-card admin-section" aria-labelledby="admin-activity-heading">
      <h2 id="admin-activity-heading">Aktivitas rapat</h2>
      <p className="admin-check-time">Rapat dihitung pada hari pertama peserta bergabung, atau hari ruang dibuat jika belum ada kehadiran. Kehadiran dihitung per peserta dan rapat pada hari bergabung.</p>
      {empty ? <p>Belum ada rapat atau kehadiran pada periode ini.</p> : <>
        {series.map(({ key, label }) => {
          const peak = Math.max(1, ...activity.map(day => day[key]));
          return <div className="admin-overview-series" key={key} aria-hidden="true">
            <strong>{label}</strong>
            <div className="admin-overview-plot">
              <div className="admin-overview-scale">
                <span>{numberFormat.format(peak)}</span><span>0</span>
              </div>
              <div className={`admin-overview-bars admin-overview-bars--${key}`}>
                {activity.map(day => <span key={day.date}
                  title={`${overviewDateLabel(day.date, overviewDay) ?? 'Tanggal belum tersedia'} · ${numberFormat.format(day[key])}`}>
                  <i style={{ height: `${day[key] / peak * 100}%` }} />
                </span>)}
              </div>
              <div className="admin-overview-ticks">
                {tickIndices.map(index => <span key={activity[index].date}>{overviewDateLabel(activity[index].date, overviewTick) ?? '—'}</span>)}
              </div>
            </div>
          </div>;
        })}
        <details>
          <summary>Lihat data harian</summary>
          <div className="admin-table-scroll" tabIndex={0} role="region" aria-label="Tabel aktivitas harian">
            <table className="admin-table admin-overview-table">
              <thead><tr><th scope="col">Tanggal (WIB)</th><th scope="col">Rapat</th><th scope="col">Kehadiran peserta</th></tr></thead>
              <tbody>{activity.map(day => <tr key={day.date}>
                <th scope="row">{overviewDateLabel(day.date, overviewDay) ?? '—'}</th>
                <td>{numberFormat.format(day.meetings)}</td><td>{numberFormat.format(day.attendances)}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </details>
      </>}
    </section>
  );
}

function AdminOverview() {
  const [days, setDays] = useState('30');
  const { data, loading, error, reload } = useAdminData<OverviewData>(`/admin/overview?days=${days}`);
  const periodStart = overviewDateLabel(data?.periodStart, overviewDay);
  const periodEnd = overviewDateLabel(data?.periodEnd, overviewDay);
  const periodCards = data ? [
    { label: 'Rapat', value: numberFormat.format(data.totalMeetings), icon: CalendarDays },
    { label: 'Rekaman diunggah', value: data.totalRecordings == null ? '—' : numberFormat.format(data.totalRecordings), icon: FileText },
    { label: data.totalRecordings == null ? 'Ukuran unggahan seluruh waktu' : 'Ukuran file unggahan', value: formatUploadedBytes(data.uploadedBytes), icon: HardDrive },
  ] : [];
  return (
    <section className="admin-section" aria-labelledby="admin-overview-heading">
      <div className="admin-section-heading">
        <h2 id="admin-overview-heading">Overview</h2>
        <label className="admin-field">Periode aktivitas
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
        <dl className="admin-kpis" aria-label="Ringkasan periode aktivitas">
          {periodCards.map(({ label, value, icon: Icon }) => (
            <div className="surface-card admin-kpi" key={label}>
              <Icon size={20} aria-hidden="true" />
              <div><dt>{label}</dt><dd>{value}</dd></div>
            </div>
          ))}
        </dl>
        <div className="admin-overview-panels">
          {Array.isArray(data.dailyActivity) && <OverviewActivityChart activity={data.dailyActivity} />}
          <section className="surface-card admin-section" aria-labelledby="admin-recent-activity-heading">
            <h2 id="admin-recent-activity-heading">Aktivitas terbaru</h2>
            {!Array.isArray(data.recentActivity) ? <p>Data aktivitas terbaru belum tersedia.</p> :
              data.recentActivity.length === 0 ? <p>Belum ada aktivitas pada periode ini.</p> :
              <ul className="admin-overview-events">{data.recentActivity.map(event => {
                const occurredAt = overviewDateLabel(event.occurredAt, adminWibDate);
                return <li key={`${event.kind}:${event.id}`}>
                  <strong>{event.kind === 'meeting_created' ? 'Rapat dibuat' : 'Rekaman selesai diproses'}</strong>
                  <span>{event.title || 'Tanpa judul'}</span>
                  {occurredAt ? <time dateTime={event.occurredAt}>{occurredAt} WIB</time> : <span>Waktu belum tercatat</span>}
                </li>;
              })}</ul>}
          </section>
        </div>
        <section className="surface-card admin-section" aria-labelledby="admin-accounts-overview-heading">
          <h2 id="admin-accounts-overview-heading">Akun saat ini</h2>
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

interface EmployeeSummary {
  activeAccounts: number;
  superAdmins: number;
  totalDepartments: number;
}

interface EmployeePage {
  employees: AdminEmployee[];
  departments: string[];
  statuses: string[];
  summary?: EmployeeSummary;
  activeAccounts?: number;
  superAdmins?: number;
  totalDepartments?: number;
  page: number;
  pageSize: number;
  total: number;
}

const initialEmployeeFilters = { q: '', department: '', status: '', role: '' };

function AdminEmployees({ currentEmployeeId }: { currentEmployeeId: string }) {
  const [inputFilters, setInputFilters] = useState(initialEmployeeFilters);
  const [appliedFilters, setAppliedFilters] = useState({ ...initialEmployeeFilters, page: '1' });
  const [selected, setSelected] = useState<AdminEmployee | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { data, loading, error, reload } = useAdminData<EmployeePage>(`/admin/employees?${new URLSearchParams(appliedFilters)}`);
  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAppliedFilters({
      q: inputFilters.q.trim(),
      department: inputFilters.department,
      status: inputFilters.status,
      role: inputFilters.role,
      page: '1',
    });
  };
  const resetFilters = () => {
    setInputFilters(initialEmployeeFilters);
    setAppliedFilters({ ...initialEmployeeFilters, page: '1' });
  };
  const goToPage = (page: number) => setAppliedFilters(previous => ({ ...previous, page: String(page) }));
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <section className="surface-card admin-section" aria-labelledby="admin-employees-heading">
      <h2 id="admin-employees-heading">Daftar karyawan</h2>
      {notice && <p className="admin-action-notice" role="status">{notice}</p>}
      {data && (
        <div className="admin-directory-summary">
          <p className="admin-summary-scope">Angka kartu berlaku untuk seluruh direktori karyawan.</p>
          <dl className="admin-kpis" aria-label="Ringkasan direktori karyawan">
            <div className="admin-kpi">
              <Users size={20} aria-hidden="true" />
              <div>
                <dt>Akun aktif</dt>
                <dd>{numberFormat.format(data.summary?.activeAccounts ?? data.activeAccounts ?? 0)}</dd>
              </div>
            </div>
            <div className="admin-kpi">
              <ShieldCheck size={20} aria-hidden="true" />
              <div>
                <dt>Super Admin</dt>
                <dd>{numberFormat.format(data.summary?.superAdmins ?? data.superAdmins ?? 0)}</dd>
              </div>
            </div>
            <div className="admin-kpi">
              <Building2 size={20} aria-hidden="true" />
              <div>
                <dt>Departemen</dt>
                <dd>{numberFormat.format(data.summary?.totalDepartments ?? data.totalDepartments ?? 0)}</dd>
              </div>
            </div>
          </dl>
        </div>
      )}
      <form className="admin-filters" onSubmit={applyFilters} onReset={e => { e.preventDefault(); resetFilters(); }}>
        <label className="admin-field">Cari nama atau email
          <input
            type="search"
            name="q"
            maxLength={100}
            placeholder="Nama atau email"
            value={inputFilters.q}
            onChange={e => setInputFilters(prev => ({ ...prev, q: e.target.value }))}
          />
        </label>
        <label className="admin-field">Peran
          <select
            name="role"
            value={inputFilters.role}
            onChange={e => setInputFilters(prev => ({ ...prev, role: e.target.value }))}
          >
            <option value="">Semua peran</option>
            <option value="super_admin">Super Admin</option>
            <option value="employee">Karyawan</option>
          </select>
        </label>
        <label className="admin-field">Departemen
          <select
            name="department"
            value={inputFilters.department}
            onChange={e => setInputFilters(prev => ({ ...prev, department: e.target.value }))}
          >
            <option value="">Semua departemen</option>
            {data?.departments.map(department => <option key={department}>{department}</option>)}
          </select>
        </label>
        <label className="admin-field">Status karyawan
          <select
            name="status"
            value={inputFilters.status}
            onChange={e => setInputFilters(prev => ({ ...prev, status: e.target.value }))}
          >
            <option value="">Semua status</option>
            {data?.statuses.map(status => <option key={status} value={status}>{valueLabels[status] ?? status}</option>)}
          </select>
        </label>
        <button type="submit" className="button-primary">Terapkan</button>
        <button type="reset" className="button-secondary">Reset</button>
      </form>
      {loading || error ? <AdminLoadState error={error} reload={reload} /> : data && (
        data.total === 0 ? <p role="status">Tidak ada karyawan yang cocok dengan filter.</p> : <>
          <div className="admin-table-scroll" tabIndex={0} role="region" aria-label="Tabel karyawan">
            <table className="admin-table" aria-label="Daftar karyawan">
              <thead><tr>
                <th scope="col">Nama</th><th scope="col">Departemen</th>
                <th scope="col">Status karyawan</th><th scope="col">Aktivasi akun</th>
                <th scope="col">Akses</th><th scope="col">Login terakhir</th><th scope="col">Tindakan</th>
              </tr></thead>
              <tbody>{data.employees.map(employee => <tr key={employee.employeeId}>
                <td><strong>{employee.name}</strong><small>{employee.employeeId}</small></td>
                <td>{employee.department || '—'}</td>
                <td>{employee.status ? valueLabels[employee.status] ?? employee.status : 'Belum tercatat'}</td>
                <td>{employee.activated ? 'Sudah diaktivasi' : 'Belum diaktivasi'}</td>
                <td>{employee.isSuperAdmin ? 'Super Admin' : 'Karyawan'}</td>
                <td>
                  {employee.lastLoginAt
                    ? <time dateTime={employee.lastLoginAt}>{adminWibDate.format(new Date(employee.lastLoginAt))} WIB</time>
                    : 'Belum tercatat'}
                </td>
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

interface MeetingHistoryPage {
  meetings: Array<{
    id: string;
    title: string;
    createdAt: string | null;
    endedAt: string | null;
    startedAt: string | null;
    participantCount: number;
    durationSeconds: number | null;
  }>;
  total: number;
  page: number;
  pageSize: number;
}

const initialMeetingHistoryFilters = { q: '', from: '', to: '', page: '1' };

function AdminMeetingHistory() {
  const [filters, setFilters] = useState(initialMeetingHistoryFilters);
  const { data, loading, error, reload } = useAdminData<MeetingHistoryPage>(`/admin/meetings/history?${new URLSearchParams(filters)}`);
  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFilters({
      q: String(form.get('q') ?? '').trim(),
      from: String(form.get('from') ?? ''),
      to: String(form.get('to') ?? ''),
      page: '1',
    });
  };
  const goToPage = (page: number) => setFilters(previous => ({ ...previous, page: String(page) }));
  const filtered = filters.q || filters.from || filters.to;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section className="surface-card admin-section" aria-labelledby="admin-history-heading">
      <div className="admin-section-heading">
        <h2 id="admin-history-heading">Riwayat rapat selesai</h2>
        <button type="button" className="button-secondary" disabled={loading} onClick={reload}>
          <RefreshCw size={16} aria-hidden="true" /> Perbarui
        </button>
      </div>
      <form className="admin-filters" aria-label="Filter riwayat rapat" onSubmit={applyFilters}
        onReset={() => setFilters(initialMeetingHistoryFilters)}>
        <label className="admin-field">Judul rapat
          <input type="search" name="q" maxLength={100} placeholder="Cari judul rapat" />
        </label>
        <label className="admin-field">Tanggal awal (WIB)
          <input type="date" name="from" aria-describedby="admin-history-date-note" />
        </label>
        <label className="admin-field">Tanggal akhir (WIB)
          <input type="date" name="to" aria-describedby="admin-history-date-note" />
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
                <th scope="col">Rapat</th><th scope="col">Waktu (WIB)</th>
                <th scope="col">Peserta tercatat</th><th scope="col">Durasi</th>
              </tr></thead>
              <tbody>{data.meetings.map(meeting => <tr key={meeting.id}>
                <td><strong>{meeting.title}</strong></td>
                <td>
                  {meeting.endedAt ? <>Selesai <time dateTime={meeting.endedAt}>{adminWibDate.format(new Date(meeting.endedAt))}</time></>
                    : meeting.createdAt ? <>Dibuat <time dateTime={meeting.createdAt}>{adminWibDate.format(new Date(meeting.createdAt))}</time></>
                    : '—'}
                  {meeting.startedAt && <small>Mulai <time dateTime={meeting.startedAt}>{adminWibDate.format(new Date(meeting.startedAt))}</time></small>}
                </td>
                <td>{numberFormat.format(meeting.participantCount)}</td>
                <td>{durationLabel(meeting.durationSeconds)}</td>
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

interface LiveMeetingParticipant {
  employeeId: string;
  employeeName: string;
  department: string;
  joinedAt: string;
  isHost: boolean;
  isCoHost: boolean;
  isGuest: boolean;
  moderatorMuted?: boolean;
}

interface LiveMeetingDetails {
  meeting: {
    id: string;
    roomName: string;
    roomCode: string | null;
    hostId: string;
    hostName: string;
    status: string;
    createdAt: string;
    participantCount: number;
    isMonitored: boolean;
    activeObserverCount: number;
  };
  participants: LiveMeetingParticipant[];
  activeObserverSessions: Array<{
    observerId: string;
    adminUserId: string;
    accessReason: string;
    approvalStatus: string;
    sessionStatus: string;
    startedAt: string;
    expiresAt: string;
    adminName?: string;
  }>;
  observerHistory: Array<{
    observerId: string;
    adminUserId: string;
    accessReason: string;
    approvalStatus: string;
    sessionStatus: string;
    startedAt: string;
    endedAt: string | null;
    expiresAt: string;
    adminName?: string;
  }>;
  connectionHealth: string;
}

interface LiveMonitorMeetingItem {
  id: string;
  title: string;
  roomCode: string | null;
  hostId: string | null;
  hostName: string;
  participantCount: number;
  startedAt: string;
  durationSeconds: number;
  status: 'active';
  connectionHealth: string;
  isMonitored: boolean;
  activeObserverCount: number;
  observerSessions?: Array<{
    observerId: string;
    adminUserId: string;
    accessReason: string;
    startedAt: string;
    sessionStatus: string;
  }>;
}

interface LiveMonitorApiResponse {
  summary: {
    activeMeetings: number;
    totalParticipants: number;
    activeHosts: number;
    averageDurationSeconds: number;
    totalDurationSeconds: number;
    meetingStatus?: string;
    connectionHealth: string;
  };
  meetings: LiveMonitorMeetingItem[];
  checkedAt: string;
}

function LiveMonitorDialog({ titleId, onClose, wide = false, busy = false, children }: {
  titleId: string;
  onClose: () => void;
  wide?: boolean;
  busy?: boolean;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={`admin-dialog${wide ? ' admin-dialog--wide' : ''}`}
      aria-labelledby={titleId}
      onCancel={event => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      {children}
    </dialog>
  );
}

function LiveMeetingDetailsModal({ meetingId, onClose, onObserve }: {
  meetingId: string;
  onClose: () => void;
  onObserve: () => void;
}) {
  const { data, loading, error, reload } = useAdminData<LiveMeetingDetails>(`/admin/live-monitor/meetings/${encodeURIComponent(meetingId)}`);

  return (
    <LiveMonitorDialog titleId="live-details-heading" onClose={onClose} wide>
        <div className="admin-dialog-header">
          <h2 id="live-details-heading">Detail Rapat Aktif</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Tutup detail rapat">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {loading ? (
          <div className="admin-dialog-body"><p>Memuat detail rapat...</p></div>
        ) : error || !data ? (
          <div className="admin-dialog-body">
            <p className="admin-error-text" role="alert">{error || 'Gagal memuat detail rapat.'}</p>
            <button type="button" className="button-secondary" onClick={reload}>Coba lagi</button>
          </div>
        ) : (
          <div className="admin-dialog-body">
            <div className="admin-details-grid">
              <div>
                <span className="admin-details-label">Judul Rapat</span>
                <strong>{data.meeting.roomName || '—'}</strong>
              </div>
              <div>
                <span className="admin-details-label">Kode Rapat</span>
                <code>{data.meeting.roomCode ? `#${data.meeting.roomCode}` : '—'}</code>
              </div>
              <div>
                <span className="admin-details-label">Host</span>
                <span>{data.meeting.hostName || '—'}</span>
              </div>
              <div>
                <span className="admin-details-label">Status Kepatuhan</span>
                <span>{data.meeting.isMonitored ? 'Sedang dipantau' : 'Tidak dipantau'}</span>
              </div>
            </div>

            <h3 style={{ marginTop: '20px', marginBottom: '8px', fontSize: '0.95rem' }}>
              Peserta Terhubung ({data.participants.length})
            </h3>
            {data.participants.length === 0 ? (
              <p className="admin-empty-note">Belum ada peserta terhubung saat ini.</p>
            ) : (
              <div className="admin-table-scroll">
                <table className="admin-table" aria-label="Daftar peserta aktif">
                  <thead>
                    <tr>
                      <th scope="col">Nama</th>
                      <th scope="col">ID Karyawan</th>
                      <th scope="col">Departemen</th>
                      <th scope="col">Peran</th>
                      <th scope="col">Bergabung</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.participants.map(p => (
                      <tr key={p.employeeId}>
                        <td><strong>{p.employeeName}</strong></td>
                        <td><code>{p.employeeId}</code></td>
                        <td>{p.department || '—'}</td>
                        <td>
                          {p.isHost ? <span className="status-badge status-badge--active">Host</span>
                            : p.isCoHost ? <span className="status-badge status-badge--active">Co-Host</span>
                            : p.isGuest ? <span className="status-badge status-badge--inactive">Tamu</span>
                            : 'Peserta'}
                        </td>
                        <td><time dateTime={p.joinedAt}>{adminDate.format(new Date(p.joinedAt))}</time></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {data.activeObserverSessions.length > 0 && (
              <div style={{ marginTop: '20px' }}>
                <h3 style={{ marginBottom: '8px', fontSize: '0.95rem', color: '#60a5fa' }}>
                  Sesi Pemantau Aktif ({data.activeObserverSessions.length})
                </h3>
                <ul className="admin-observer-list">
                  {data.activeObserverSessions.map(s => (
                    <li key={s.observerId}>
                      Super Admin: <strong>{s.adminName || s.adminUserId}</strong> • Alasan: <em>"{s.accessReason}"</em>
                      <br /><small>Mulai: {adminDate.format(new Date(s.startedAt))} • Kedaluwarsa: {adminDate.format(new Date(s.expiresAt))}</small>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="admin-dialog-footer">
          <button type="button" className="button-secondary" onClick={onClose}>Tutup</button>
          <button type="button" className="button-primary" onClick={onObserve} disabled={!data || loading || Boolean(error)}>
            <Eye size={16} aria-hidden="true" /> Pantau rapat
          </button>
        </div>
    </LiveMonitorDialog>
  );
}

function RequestObserverModal({ meeting, onClose, onEnterObserverMode }: {
  meeting: LiveMonitorMeetingItem;
  onClose: () => void;
  onEnterObserverMode?: (session: ObserverSessionData) => void;
}) {
  const [accessReason, setAccessReason] = useState('');
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (accessReason.trim().length < 5) {
      setError('Alasan pemantauan wajib diisi minimal 5 karakter.');
      return;
    }
    if (!consentConfirmed) {
      setError('Konfirmasi kebijakan kepatuhan organisasi wajib dicentang.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await apiRequest<{
        success: boolean;
        observerId: string;
        meetingId: string;
        roomName: string;
        roomCode?: string;
        hostName?: string;
        token: string;
        url: string;
        expiresAt: string;
      }>('/admin/observer/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meetingId: meeting.id || meeting.roomCode || meeting.title,
          accessReason: accessReason.trim(),
        }),
      });

      if (response.success && onEnterObserverMode) {
        onEnterObserverMode({
          observerId: response.observerId,
          meetingId: response.meetingId,
          roomName: response.roomName || meeting.title,
          roomCode: response.roomCode || meeting.roomCode || undefined,
          hostName: response.hostName || meeting.hostName,
          token: response.token,
          serverUrl: response.url,
          expiresAt: response.expiresAt,
          accessReason: accessReason.trim(),
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal meminta akses pemantau.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <LiveMonitorDialog titleId="observer-request-heading" onClose={onClose} busy={submitting}>
        <form onSubmit={handleSubmit}>
          <div className="admin-dialog-header">
            <h2 id="observer-request-heading">Mulai pemantauan</h2>
            <button type="button" className="icon-button" onClick={onClose} disabled={submitting} aria-label="Tutup dialog">
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <div className="admin-dialog-body">
            <div className="admin-compliance-notice" role="note">
              <ShieldCheck size={18} aria-hidden="true" />
              <div>
                Mode pantau hanya untuk pengawasan kepatuhan dan investigasi resmi. Peserta akan melihat pemberitahuan saat pemantauan aktif.
              </div>
            </div>

            <div className="admin-form-group" style={{ marginTop: '16px' }}>
              <label htmlFor="observer-meeting-target">Rapat Target</label>
              <input
                id="observer-meeting-target"
                type="text"
                className="input-text"
                readOnly
                value={`${meeting.title} (${meeting.hostName})`}
              />
            </div>

            <div className="admin-form-group">
              <label htmlFor="observer-reason-input">
                Alasan Akses Pemantauan <span className="admin-required">*</span>
              </label>
              <textarea
                id="observer-reason-input"
                className="input-text"
                rows={3}
                placeholder="Contoh: Pemeriksaan kualitas audio"
                aria-describedby="observer-reason-hint"
                value={accessReason}
                onChange={e => setAccessReason(e.target.value)}
                required
              />
              <small id="observer-reason-hint" className="admin-field-hint">Minimal 5 karakter. Alasan dicatat di log audit.</small>
            </div>

            <div className="admin-checkbox-group">
              <label className="admin-checkbox-label">
                <input
                  type="checkbox"
                  checked={consentConfirmed}
                  onChange={e => setConsentConfirmed(e.target.checked)}
                />
                <span>Saya mengonfirmasi bahwa akses ini sesuai dengan kebijakan kepatuhan organisasi.</span>
              </label>
            </div>

            {error && (
              <p className="admin-error-text" role="alert" style={{ marginTop: '12px' }}>
                {error}
              </p>
            )}
          </div>

          <div className="admin-dialog-footer">
            <button type="button" className="button-secondary" onClick={onClose} disabled={submitting}>
              Batal
            </button>
            <button
              type="submit"
              className="button-primary"
              disabled={submitting || accessReason.trim().length < 5 || !consentConfirmed}
            >
              {submitting ? 'Memproses...' : 'Mulai Pemantauan'}
            </button>
          </div>
        </form>
    </LiveMonitorDialog>
  );
}

export function AdminLiveMeetingMonitor({ onEnterObserverMode }: {
  onEnterObserverMode?: (session: ObserverSessionData) => void;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [detailsMeetingId, setDetailsMeetingId] = useState<string | null>(null);
  const [requestMeeting, setRequestMeeting] = useState<LiveMonitorMeetingItem | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, loading, error, reload } = useAdminData<LiveMonitorApiResponse>('/admin/live-monitor', 10000);

  const handleEndObserverSession = async (observerId: string) => {
    setActionError(null);
    try {
      await apiRequest(`/admin/observer/sessions/${encodeURIComponent(observerId)}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Diakhiri dari dashboard Live Monitor' }),
      });
      setActionNotice('Sesi pemantauan berhasil diakhiri.');
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Gagal mengakhiri sesi pemantauan.');
    }
  };

  const filteredMeetings = useMemo(() => {
    if (!data?.meetings) return [];
    const term = searchTerm.trim().toLowerCase();
    if (!term) return data.meetings;
    const roomCodeTerm = term.replace(/^#/, '');
    return data.meetings.filter(m =>
      m.title.toLowerCase().includes(term) ||
      (roomCodeTerm && m.roomCode?.toLowerCase().includes(roomCodeTerm)) ||
      m.hostName.toLowerCase().includes(term)
    );
  }, [data?.meetings, searchTerm]);
  const livekitHealthy = data?.summary.connectionHealth === 'healthy';

  return (
    <section className="surface-card admin-section admin-live-monitor" aria-labelledby="live-monitor-heading">
      <div className="admin-section-heading">
        <div>
          <h2 id="live-monitor-heading">Live Monitor</h2>
          <p className="admin-section-sub">Pantau rapat aktif dan kelola sesi pemantauan.</p>
        </div>
      </div>

      {actionNotice && (
        <div className="admin-banner-notice" role="status">
          <CheckCircle2 size={16} aria-hidden="true" /> {actionNotice}
        </div>
      )}
      {actionError && (
        <div className="admin-error-text" role="alert" style={{ marginBottom: '16px' }}>
          {actionError}
        </div>
      )}

      {!data ? (
        <AdminLoadState error={error} reload={reload} />
      ) : (
        <>
          {error && (
            <p className="admin-error-text" role="alert">Gagal memperbarui data. Angka berikut berasal dari pengecekan terakhir.</p>
          )}
          {/* KPI Summary Cards */}
          {!livekitHealthy && (
            <p role="status">Jumlah rapat dan peserta belum bisa diverifikasi karena LiveKit tidak dapat dijangkau.</p>
          )}
          <div className="admin-overview-grid">
            <div className="admin-kpi-card">
              <span className="admin-kpi-label"><Video size={16} aria-hidden="true" /> Rapat aktif</span>
              <strong className="admin-kpi-value">{livekitHealthy ? numberFormat.format(data.summary.activeMeetings) : '—'}</strong>
            </div>
            <div className="admin-kpi-card">
              <span className="admin-kpi-label"><Users size={16} aria-hidden="true" /> Peserta terhubung</span>
              <strong className="admin-kpi-value">{livekitHealthy ? numberFormat.format(data.summary.totalParticipants) : '—'}</strong>
            </div>
            <div className="admin-kpi-card">
              <span className="admin-kpi-label"><User size={16} aria-hidden="true" /> Host aktif</span>
              <strong className="admin-kpi-value">{livekitHealthy ? numberFormat.format(data.summary.activeHosts) : '—'}</strong>
            </div>
            <div className="admin-kpi-card">
              <span className="admin-kpi-label"><Clock size={16} aria-hidden="true" /> Rata-rata durasi</span>
              <strong className="admin-kpi-value">{livekitHealthy && data.summary.activeMeetings > 0 ? durationLabel(data.summary.averageDurationSeconds) : '—'}</strong>
            </div>
          </div>

          {/* Search bar */}
          <div className="admin-live-toolbar">
            <div className="admin-live-search">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                className="input-text"
                placeholder="Cari nama rapat, kode, atau host"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                aria-label="Cari rapat aktif"
              />
            </div>
            <div className="admin-live-toolbar-actions">
              <span className={`admin-live-health ${livekitHealthy ? 'is-healthy' : ''}`}>
                <Radio size={15} aria-hidden="true" /> LiveKit {livekitHealthy ? 'sehat' : 'terkendala'}
              </span>
              <button type="button" className="button-secondary" disabled={loading} onClick={reload}>
                <RefreshCw size={16} aria-hidden="true" /> Perbarui
              </button>
            </div>
          </div>

          {/* Meetings Table */}
          {filteredMeetings.length === 0 ? (
            <p role="status" style={{ padding: '24px 0', textAlign: 'center', color: '#94a3b8' }}>
              {data.summary.connectionHealth !== 'healthy' ? 'Daftar rapat aktif belum tersedia.' : searchTerm ? 'Tidak ada rapat yang sesuai dengan pencarian.' : 'Tidak ada rapat yang sedang berlangsung saat ini.'}
            </p>
          ) : (
            <div className="admin-table-scroll" tabIndex={0} role="region" aria-label="Tabel rapat aktif">
              <table className="admin-table" aria-label="Daftar rapat langsung">
                <thead>
                  <tr>
                    <th scope="col">Nama rapat</th>
                    <th scope="col">Host</th>
                    <th scope="col">Peserta</th>
                    <th scope="col">Mulai</th>
                    <th scope="col">Durasi</th>
                    <th scope="col">Status</th>
                    <th scope="col">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMeetings.map((meeting: LiveMonitorMeetingItem) => (
                    <tr key={meeting.id}>
                      <td>
                        <div className="admin-live-meeting-name">
                          <strong>{meeting.title}</strong>
                          <div className="admin-live-meeting-meta">
                            {meeting.roomCode && <span className="admin-live-room-code">#{meeting.roomCode}</span>}
                            {meeting.isMonitored && <span className="admin-live-health is-healthy">Dipantau</span>}
                          </div>
                        </div>
                      </td>
                      <td>{meeting.hostName || '—'}</td>
                      <td>{meeting.participantCount} peserta</td>
                      <td><time dateTime={meeting.startedAt}>{adminDate.format(new Date(meeting.startedAt))}</time></td>
                      <td>{durationLabel(meeting.durationSeconds)}</td>
                      <td>
                        <span className="status-badge status-badge--active" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#34d399' }} /> Aktif
                        </span>
                      </td>
                      <td>
                        <div className="admin-live-actions">
                          <button
                            type="button"
                            className="button-secondary"
                            onClick={() => setDetailsMeetingId(meeting.id)}
                            title="Lihat detail peserta rapat"
                          >
                            <Eye size={14} aria-hidden="true" /> Detail
                          </button>
                          <button
                            type="button"
                            className="button-primary"
                            onClick={() => setRequestMeeting(meeting)}
                            title="Minta akses pemantau pribadi"
                          >
                            <ShieldCheck size={14} aria-hidden="true" /> Pantau
                          </button>
                          {meeting.observerSessions && meeting.observerSessions.length > 0 && (
                            <button
                              type="button"
                              className="button-secondary admin-live-end"
                              onClick={() => handleEndObserverSession(meeting.observerSessions![0].observerId)}
                              title="Akhiri sesi pengamatan ini"
                            >
                              Akhiri pemantauan
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {detailsMeetingId && (
        <LiveMeetingDetailsModal
          meetingId={detailsMeetingId}
          onClose={() => setDetailsMeetingId(null)}
          onObserve={() => {
            const m = data?.meetings.find(item => item.id === detailsMeetingId);
            setDetailsMeetingId(null);
            if (m) setRequestMeeting(m);
          }}
        />
      )}

      {requestMeeting && (
        <RequestObserverModal
          meeting={requestMeeting}
          onClose={() => setRequestMeeting(null)}
          onEnterObserverMode={onEnterObserverMode}
        />
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

// ============================================================================
// Service Health & Processing Monitor (Enterprise Layanan)
// ============================================================================

const serviceGroups = {
  core: 'Infrastruktur Inti',
  llm: 'Model Ringkasan (LLM)',
  transcription: 'Mesin Transkripsi (ASR)',
  diarization: 'Pemisah Pembicara (Diarization)',
} as const;

const serviceStatuses: Record<string, string> = {
  ready: 'Operasional',
  operational: 'Operasional',
  degraded: 'Performa Menurun',
  unavailable: 'Tidak Tersedia',
  not_configured: 'Belum Dikonfigurasi',
  disabled: 'Dinonaktifkan',
  unverified: 'Belum Terverifikasi',
  unknown: 'Tidak Diketahui',
};

const processingModeLabels: Record<string, string> = {
  streaming: 'WebSocket Streaming',
  chunk: 'HTTP Chunking',
  batch: 'Batch Worker Job',
  daemon: 'Internal Daemon',
};

const jobStatusLabels: Record<string, string> = {
  queued: 'Dalam Antrean',
  processing: 'Sedang Diproses',
  done: 'Selesai',
  failed: 'Gagal',
};

const jobStageLabels: Record<string, string> = {
  queued: 'Menunggu Giliran',
  transcribing: 'Transkripsi Audio',
  summarizing: 'Pembuatan Ringkasan AI',
};

interface MonitoredService {
  id: string;
  label: string;
  group: keyof typeof serviceGroups;
  subgroup?: 'infrastructure' | 'live' | 'post_meeting' | 'upload';
  processingMode?: 'streaming' | 'chunk' | 'batch' | 'daemon';
  status: keyof typeof serviceStatuses;
  configured?: boolean;
  version?: string | null;
  connectionState?: string | null;
  healthStatus?: string | null;
  lastChecked?: string | null;
  latencyMs?: number | null;
  provider?: string | null;
  model?: string | null;
  diagnostic?: string | null;
}

interface RecordingQueueMetrics {
  queued: number;
  processing: number;
  failed: number;
  medianCompletionSeconds: number | null;
  completionSampleSize: number;
}

interface RecordingQueueStats {
  completed7d: number;
  failed7d: number;
  totalCompleted: number;
  totalFailed: number;
  windowDays: number;
}

interface SystemData {
  api: string;
  livekit: string;
  databaseConnected: boolean;
  checkedAt: string;
  services: MonitoredService[];
  recordingQueue: RecordingQueueMetrics | null;
  queueStats?: RecordingQueueStats | null;
  summary?: {
    total: number;
    ready: number;
    unavailable: number;
    notConfigured: number;
    unverified: number;
  };
  latency?: {
    databaseMs?: number | null;
    livekitMs?: number | null;
  };
}

interface RetryHistoryEntry {
  id: string | number;
  actorId: string | null;
  actorName: string | null;
  action: string;
  result: string;
  reason: string | null;
  occurredAt: string;
}

interface ProcessingJob {
  id: string;
  title: string;
  originalFilename: string | null;
  ownerId: string | null;
  ownerName: string | null;
  fileSize: string | null;
  language: string;
  status: 'queued' | 'processing' | 'done' | 'failed';
  stage: string | null;
  sttModel: string | null;
  diarizer: string | null;
  llmModel: string | null;
  provider: string | null;
  error: string | null;
  errorCategory: {
    code: string;
    label: string;
    severity: 'error' | 'warning' | 'info';
  } | null;
  durationSeconds: number | null;
  createdAt: string;
  updatedAt: string | null;
  completedAt: string | null;
  hasTranscript: boolean;
  segmentCount?: number;
  hasSummary: boolean;
  retryCount?: number;
  retryHistory?: RetryHistoryEntry[];
  canRetry: boolean;
  retryReason: string;
}

interface ProcessingJobsPage {
  jobs: ProcessingJob[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function formatDurationDetail(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${numberFormat.format(seconds)} detik`;
  const mins = Math.floor(seconds / 60);
  const remSecs = Math.round(seconds % 60);
  return remSecs > 0 ? `${mins} mnt ${remSecs} dtk` : `${mins} mnt`;
}

function ServiceStatusPill({ status }: { status: keyof typeof serviceStatuses | string }) {
  const label = serviceStatuses[status] || status;
  const isReady = status === 'ready' || status === 'operational';
  const isDegraded = status === 'degraded';
  const isUnavailable = status === 'unavailable';
  const isNotConfigured = status === 'not_configured';
  const isDisabled = status === 'disabled';
  const isUnknown = status === 'unverified' || status === 'unknown';

  return (
    <span className={`admin-service-badge admin-service-badge--${status}`}>
      {isReady && <CheckCircle size={13} aria-hidden="true" className="admin-status-icon is-ready" />}
      {isDegraded && <AlertTriangle size={13} aria-hidden="true" className="admin-status-icon is-degraded" />}
      {isUnavailable && <AlertCircle size={13} aria-hidden="true" className="admin-status-icon is-unavailable" />}
      {isNotConfigured && <MinusCircle size={13} aria-hidden="true" className="admin-status-icon is-not-configured" />}
      {isDisabled && <Slash size={13} aria-hidden="true" className="admin-status-icon is-disabled" />}
      {isUnknown && <Info size={13} aria-hidden="true" className="admin-status-icon is-unverified" />}
      <span>{label}</span>
    </span>
  );
}

function FreshnessPill({ checkedAt, refreshing, hasError }: { checkedAt: string; refreshing: boolean; hasError?: boolean }) {
  const timestamp = Date.parse(checkedAt);
  const ageSeconds = Number.isFinite(timestamp) ? Math.max(0, Math.floor((Date.now() - timestamp) / 1000)) : 999;
  const isFresh = ageSeconds < 45 && !refreshing && !hasError;
  return (
    <div className="admin-freshness-indicator" role="status" aria-label="Status kesegaran data">
      <span className={`admin-freshness-dot ${refreshing ? 'is-checking' : hasError ? 'is-error' : isFresh ? 'is-fresh' : 'is-stale'}`} aria-hidden="true" />
      <span className="admin-freshness-label">
        {refreshing ? 'Memeriksa kesehatan...' : hasError ? 'Gagal Memperbarui' : isFresh ? 'Data Segar' : 'Data Kedaluwarsa'}
      </span>
      <span className="admin-check-time">
        (Pengecekan: <time dateTime={checkedAt}>{adminWibDate.format(new Date(checkedAt))} WIB</time>)
      </span>
    </div>
  );
}

function ErrorCategoryPill({ category }: { category: ProcessingJob['errorCategory'] }) {
  if (!category) return null;
  const severityClass = category.severity === 'error'
    ? 'admin-category-pill--error'
    : category.severity === 'warning'
      ? 'admin-category-pill--warning'
      : 'admin-category-pill--info';
  return (
    <span className={`admin-category-pill ${severityClass}`} title={category.label}>
      <AlertTriangle size={12} aria-hidden="true" />
      <span>{category.label}</span>
    </span>
  );
}

function CoreInfrastructureSection({ system }: { system: SystemData }) {
  const apiService = system.services.find(s => s.id === 'api');
  const livekitService = system.services.find(s => s.id === 'livekit');
  const dbService = system.services.find(s => s.id === 'database');

  const apiStatus = apiService?.status || (system.api === 'reachable' ? 'ready' : 'unavailable');
  const livekitStatus = livekitService?.status || (system.livekit === 'reachable' ? 'ready' : 'unavailable');
  const dbStatus = dbService?.status || (system.databaseConnected ? 'ready' : 'unavailable');

  return (
    <section className="surface-card admin-section" aria-labelledby="admin-core-heading">
      <div className="admin-section-heading">
        <div>
          <h3 id="admin-core-heading">Infrastruktur Inti</h3>
          <p className="admin-queue-definition">Fondasi gateway API, media SFU real-time, dan relasional basis data Sentra Workspace.</p>
        </div>
        <span className="admin-check-time">3 Layanan Inti Terpantau</span>
      </div>
      <div className="admin-infra-grid">
        <div className={`admin-infra-card ${apiStatus === 'unavailable' ? 'is-error' : ''}`}>
          <div className="admin-infra-header">
            <div className="admin-infra-title-wrap">
              <Server size={18} className="admin-infra-icon" aria-hidden="true" />
              <h4>API BaliCall</h4>
            </div>
            <ServiceStatusPill status={apiStatus} />
          </div>
          <p className="admin-infra-desc">Server Gateway REST & Webhook aplikasi Sentra Workspace.</p>
          <dl className="admin-infra-meta">
            <div><dt>Protokol</dt><dd>REST HTTP/JSON</dd></div>
            <div><dt>Status Uji</dt><dd>{apiService?.healthStatus || 'Responsif'}</dd></div>
            <div><dt>Koneksi</dt><dd>{apiService?.connectionState || 'Aktif (Internal)'}</dd></div>
            <div><dt>Latensi</dt><dd>{apiService?.latencyMs != null ? `${apiService.latencyMs} ms` : '—'}</dd></div>
            <div><dt>Versi</dt><dd>{apiService?.version || '—'}</dd></div>
            <div><dt>Terakhir Cek</dt><dd>{apiService?.lastChecked ? `${adminWibDate.format(new Date(apiService.lastChecked))} WIB` : `${adminWibDate.format(new Date(system.checkedAt))} WIB`}</dd></div>
          </dl>
          {apiService?.diagnostic && (
            <div className={`admin-infra-diagnostic ${apiStatus === 'unavailable' ? 'is-error' : ''}`}>
              <small>{apiService.diagnostic}</small>
            </div>
          )}
        </div>

        <div className={`admin-infra-card ${livekitStatus === 'unavailable' ? 'is-error' : ''}`}>
          <div className="admin-infra-header">
            <div className="admin-infra-title-wrap">
              <Radio size={18} className="admin-infra-icon" aria-hidden="true" />
              <h4>LiveKit SFU</h4>
            </div>
            <ServiceStatusPill status={livekitStatus} />
          </div>
          <p className="admin-infra-desc">Media SFU real-time untuk stream audio/video ruang rapat.</p>
          <dl className="admin-infra-meta">
            <div><dt>Protokol</dt><dd>WebRTC / WebSocket</dd></div>
            <div><dt>Status Uji</dt><dd>{livekitService?.healthStatus || (system.livekit === 'reachable' ? 'Probe SFU Berhasil' : 'Probe Gagal')}</dd></div>
            <div><dt>Koneksi</dt><dd>{livekitService?.connectionState || (system.livekit === 'reachable' ? 'Terhubung' : 'Terputus')}</dd></div>
            <div><dt>Latensi</dt><dd>{system.latency?.livekitMs != null ? `${system.latency.livekitMs} ms` : '—'}</dd></div>
            <div><dt>Versi</dt><dd>{livekitService?.version || 'LiveKit SFU'}</dd></div>
            <div><dt>Terakhir Cek</dt><dd>{livekitService?.lastChecked ? `${adminWibDate.format(new Date(livekitService.lastChecked))} WIB` : `${adminWibDate.format(new Date(system.checkedAt))} WIB`}</dd></div>
          </dl>
          {livekitService?.diagnostic && (
            <div className={`admin-infra-diagnostic ${livekitStatus === 'unavailable' ? 'is-error' : ''}`}>
              <small>{livekitService.diagnostic}</small>
            </div>
          )}
        </div>

        <div className={`admin-infra-card ${dbStatus === 'unavailable' ? 'is-error' : ''}`}>
          <div className="admin-infra-header">
            <div className="admin-infra-title-wrap">
              <HardDrive size={18} className="admin-infra-icon" aria-hidden="true" />
              <h4>PostgreSQL</h4>
            </div>
            <ServiceStatusPill status={dbStatus} />
          </div>
          <p className="admin-infra-desc">Penyimpanan relasional audit, akun, rapat, dan antrean.</p>
          <dl className="admin-infra-meta">
            <div><dt>Protokol</dt><dd>TCP Connection Pool</dd></div>
            <div><dt>Status Uji</dt><dd>{dbService?.healthStatus || (system.databaseConnected ? 'Query SELECT 1 OK' : 'Koneksi Terputus')}</dd></div>
            <div><dt>Koneksi</dt><dd>{dbService?.connectionState || (system.databaseConnected ? 'Koneksi Pool Stabil' : 'Koneksi Terputus')}</dd></div>
            <div><dt>Latensi</dt><dd>{system.latency?.databaseMs != null ? `${system.latency.databaseMs} ms` : '—'}</dd></div>
            <div><dt>Versi</dt><dd>{dbService?.version || 'PostgreSQL'}</dd></div>
            <div><dt>Terakhir Cek</dt><dd>{dbService?.lastChecked ? `${adminWibDate.format(new Date(dbService.lastChecked))} WIB` : `${adminWibDate.format(new Date(system.checkedAt))} WIB`}</dd></div>
          </dl>
          {dbService?.diagnostic && (
            <div className={`admin-infra-diagnostic ${dbStatus === 'unavailable' ? 'is-error' : ''}`}>
              <small>{dbService.diagnostic}</small>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function TranscriptionEnginesSection({ services }: { services: MonitoredService[] }) {
  const transcriptionServices = services.filter(s => s.group === 'transcription');
  const liveEngines = transcriptionServices.filter(s => s.subgroup === 'live');
  const postMeetingEngines = transcriptionServices.filter(s => s.subgroup === 'post_meeting');
  const uploadEngines = transcriptionServices.filter(s => s.subgroup === 'upload');

  const renderEngineList = (items: MonitoredService[], title: string, subtitle: string) => (
    <div className="admin-engine-subgroup">
      <div className="admin-engine-subgroup-header">
        <h4>{title}</h4>
        <small className="admin-check-time">{subtitle}</small>
      </div>
      <ul className="admin-service-list">
        {items.map(service => {
          const isOperational = service.status === 'ready' || service.status === 'operational';
          const isConfigured = service.configured ?? (service.status !== 'not_configured');
          return (
            <li key={service.id} className="admin-service-list-item">
              <div className="admin-service-info">
                <div className="admin-service-title-row">
                  <span className="admin-service-name">{service.label}</span>
                  <span className={`admin-config-tag ${isConfigured ? 'is-configured' : 'is-not-configured'}`}>
                    {isConfigured ? 'Terkonfigurasi' : 'Belum Dikonfigurasi'}
                  </span>
                  <span className={`admin-runtime-tag ${isOperational ? 'is-online' : isConfigured ? 'is-offline' : 'is-disabled'}`}>
                    {isOperational ? 'Worker Online' : isConfigured ? 'Worker Offline' : 'Non-aktif'}
                  </span>
                </div>
                <div className="admin-service-tags">
                  {service.processingMode && (
                    <span className="admin-mode-tag">{processingModeLabels[service.processingMode] || service.processingMode}</span>
                  )}
                  {service.diagnostic && (
                    <span className={`admin-diagnostic-text ${service.status === 'unavailable' ? 'is-error' : ''}`}>{service.diagnostic}</span>
                  )}
                  {service.lastChecked && (
                    <span className="admin-service-checked">Cek: {adminWibDate.format(new Date(service.lastChecked))} WIB</span>
                  )}
                </div>
              </div>
              <ServiceStatusPill status={service.status} />
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <section className="surface-card admin-section" aria-labelledby="admin-transcription-heading">
      <div className="admin-section-heading">
        <div>
          <h3 id="admin-transcription-heading">Mesin Transkripsi Suara (ASR)</h3>
          <p className="admin-queue-definition">Pemisahan status konfigurasi lingkungan dari kesiapan runtime worker untuk live, pasca-rapat, dan antrean.</p>
        </div>
        <span className="admin-check-time">Diorganisasikan Berdasarkan Alur Operasional</span>
      </div>
      <div className="admin-engine-groups-container">
        {renderEngineList(liveEngines, 'A. Transkripsi Rapat Langsung (Live)', 'Digunakan saat konferensi video berjalan (WhisperLiveKit, Qwen Live, SEA-ASR-ID Live, Ming Live)')}
        {renderEngineList(postMeetingEngines, 'B. Transkripsi Pasca-Rapat (Post-Meeting)', 'Pemrosesan potongan audio dan batch pipeline pasca-rapat selesai')}
        {renderEngineList(uploadEngines, 'C. Transkripsi Unggahan Rekaman (Upload)', 'Pemrosesan berkas rekaman dari antrean (Whisper, SEA-ASR-ID, Qwen, Qwen Q8)')}
      </div>
    </section>
  );
}

function SpeakerDiarizationSection({ services }: { services: MonitoredService[] }) {
  const diarizationServices = services.filter(s => s.group === 'diarization');
  const liveDiarization = diarizationServices.filter(s => s.subgroup === 'live');
  const uploadDiarization = diarizationServices.filter(s => s.subgroup === 'upload');
  const postMeetingDiarization = diarizationServices.filter(s => s.subgroup === 'post_meeting');

  const renderDiarizationList = (items: MonitoredService[], title: string, subtitle: string, defaultDependency = '') => (
    <div className="admin-engine-subgroup">
      <div className="admin-engine-subgroup-header">
        <h4>{title}</h4>
        <small className="admin-check-time">{subtitle}</small>
      </div>
      <ul className="admin-service-list">
        {items.map(service => {
          const isOperational = service.status === 'ready' || service.status === 'operational';
          const isConfigured = service.configured ?? (service.status !== 'not_configured');
          const depText = service.id === 'recording-pyannote'
            ? 'Dependensi: Worker Pyannote JSWOOK (:8004)'
            : service.id === 'recording-nemotron' || service.id === 'post-meeting-diarization'
              ? 'Dependensi: Model Nemotron-3'
              : defaultDependency;
          return (
            <li key={service.id} className="admin-service-list-item">
              <div className="admin-service-info">
                <div className="admin-service-title-row">
                  <span className="admin-service-name">{service.label}</span>
                  <span className={`admin-config-tag ${isConfigured ? 'is-configured' : 'is-not-configured'}`}>
                    {isConfigured ? 'Terkonfigurasi' : 'Belum Dikonfigurasi'}
                  </span>
                  <span className={`admin-runtime-tag ${isOperational ? 'is-online' : isConfigured ? 'is-offline' : 'is-disabled'}`}>
                    {isOperational ? 'Diarizer Siap' : isConfigured ? 'Diarizer Offline' : 'Non-aktif'}
                  </span>
                </div>
                <div className="admin-service-tags">
                  {service.processingMode && (
                    <span className="admin-mode-tag">{processingModeLabels[service.processingMode] || service.processingMode}</span>
                  )}
                  {depText && <span className="admin-dependency-tag">{depText}</span>}
                  {service.diagnostic && (
                    <span className={`admin-diagnostic-text ${service.status === 'unavailable' ? 'is-error' : ''}`}>{service.diagnostic}</span>
                  )}
                  {service.lastChecked && (
                    <span className="admin-service-checked">Cek: {adminWibDate.format(new Date(service.lastChecked))} WIB</span>
                  )}
                </div>
              </div>
              <ServiceStatusPill status={service.status} />
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <section className="surface-card admin-section" aria-labelledby="admin-diarization-heading">
      <div className="admin-section-heading">
        <div>
          <h3 id="admin-diarization-heading">Pemisah Pembicara (Speaker Diarization)</h3>
          <p className="admin-queue-definition">Diorganisasikan secara terpisah dari ASR untuk memastikan ketersediaan pelabelan pembicara dapat diverifikasi independen.</p>
        </div>
        <span className="admin-check-time">Diorganisasikan 3 Alur Kerja</span>
      </div>
      <div className="admin-engine-groups-container">
        {renderDiarizationList(liveDiarization, 'A. Pemisah Pembicara Langsung (Live)', 'Diarisasi real-time streaming saat konferensi video berjalan', 'Streaming Live')}
        {renderDiarizationList(uploadDiarization, 'B. Pemisah Pembicara Unggahan Rekaman (Upload)', 'Diarisasi batch berkas unggahan audio/video menggunakan Nemotron-3 dan Pyannote')}
        {renderDiarizationList(postMeetingDiarization, 'C. Pemisah Pembicara Pasca-Rapat (Post-Meeting)', 'Diarisasi batch rekaman pasca-rapat dengan pipeline Nemotron-3')}
      </div>
    </section>
  );
}

function SummaryModelSection({ services }: { services: MonitoredService[] }) {
  const model = services.find(service => service.id === 'summary-llm');
  if (!model) return null;
  const providerLabel = model.provider === 'office' ? 'Office' : model.provider === 'gemini' ? 'Google Gemini' : 'Demo';
  return (
    <section className="surface-card admin-section" aria-labelledby="admin-summary-model-heading">
      <div className="admin-section-heading">
        <div>
          <h3 id="admin-summary-model-heading">Model ringkasan rapat (LLM)</h3>
          <p className="admin-queue-definition">Menampilkan penyedia dan model yang dipakai untuk menyusun ringkasan. Konektivitas belum diuji oleh monitor ini.</p>
        </div>
        <ServiceStatusPill status={model.status} />
      </div>
      <dl className="admin-kpis">
        <div className="admin-kpi"><div><dt>Penyedia</dt><dd>{providerLabel}</dd></div></div>
        <div className="admin-kpi"><div><dt>Model</dt><dd><code>{model.model || 'Tidak dikonfigurasi'}</code></dd></div></div>
        <div className="admin-kpi"><div><dt>Status koneksi</dt><dd>{model.status === 'unverified' ? 'Belum diuji' : model.status === 'not_configured' ? 'Mode demo' : serviceStatuses[model.status]}</dd></div></div>
      </dl>
      {model.diagnostic && <p className="admin-check-time">{model.diagnostic}</p>}
    </section>
  );
}

function ProcessingOverviewCard({
  metrics,
  stats,
  checkedAt,
  refreshing = false,
  hasError = false,
  onNavigateToInvestigation,
}: {
  metrics: RecordingQueueMetrics | null;
  stats?: RecordingQueueStats | null;
  checkedAt?: string;
  refreshing?: boolean;
  hasError?: boolean;
  onNavigateToInvestigation: () => void;
}) {
  const median = metrics?.medianCompletionSeconds;
  const sampleSize = metrics?.completionSampleSize ?? 0;

  return (
    <section className="surface-card admin-section" aria-labelledby="admin-queue-summary-heading">
      <div className="admin-section-heading">
        <div>
          <h3 id="admin-queue-summary-heading">Antrean & Pemrosesan Berkas</h3>
          <p className="admin-queue-definition">
            Definisi: Durasi pemrosesan dihitung sejak berkas diunggah hingga hasil selesai dibuat, mencakup waktu antrean dan percobaan ulang jika ada.
          </p>
        </div>
        <button type="button" className="button-secondary" onClick={onNavigateToInvestigation}>
          <Search size={15} aria-hidden="true" /> Buka Investigasi Antrean
        </button>
      </div>

      <div className="admin-queue-freshness-bar">
        <span className={`admin-freshness-dot ${refreshing ? 'is-checking' : hasError ? 'is-error' : 'is-fresh'}`} aria-hidden="true" />
        <span className="admin-freshness-text">
          Status: <strong>{hasError ? 'Pemantauan Antrean Terganggu' : refreshing ? 'Memeriksa antrean...' : 'Pemantauan Antrean Aktif'}</strong>
        </span>
        {checkedAt && (
          <span className="admin-freshness-timestamp">
            Terakhir diperbarui: <time dateTime={checkedAt}>{adminWibDate.format(new Date(checkedAt))} WIB</time>
          </span>
        )}
      </div>

      <div className="admin-queue-metrics-container">
        <div className="admin-queue-metric-group">
          <h4 className="admin-queue-group-title">Status Antrean Saat Ini (Real-Time)</h4>
          <dl className="admin-kpis admin-queue-kpis">
            <div className="admin-kpi">
              <Clock size={20} aria-hidden="true" className="admin-kpi-icon" />
              <div>
                <dt>Menunggu</dt>
                <dd>{metrics?.queued != null ? numberFormat.format(metrics.queued) : 'Belum tersedia'}</dd>
                <small className="admin-check-time">Pekerjaan dalam antrean aktif saat ini</small>
              </div>
            </div>
            <div className="admin-kpi">
              <Zap size={20} aria-hidden="true" className="admin-kpi-icon" />
              <div>
                <dt>Sedang Diproses</dt>
                <dd>{metrics?.processing != null ? numberFormat.format(metrics.processing) : 'Belum tersedia'}</dd>
                <small className="admin-check-time">Sedang ditranskrip atau diringkas saat ini</small>
              </div>
            </div>
          </dl>
        </div>

        <div className="admin-queue-metric-group">
          <h4 className="admin-queue-group-title">Aktivitas 7 Hari Terakhir (Historis)</h4>
          <dl className="admin-kpis admin-queue-kpis">
            <div className="admin-kpi">
              <CheckCircle2 size={20} aria-hidden="true" className="admin-kpi-icon is-success" />
              <div>
                <dt>Selesai (7 Hari)</dt>
                <dd>{stats?.completed7d != null ? numberFormat.format(stats.completed7d) : 'Belum tersedia'}</dd>
                <small className="admin-check-time">Pekerjaan selesai sukses dalam 7 hari</small>
              </div>
            </div>
            <div className="admin-kpi">
              <AlertTriangle size={20} aria-hidden="true" className="admin-kpi-icon is-danger" />
              <div>
                <dt>Gagal (7 Hari)</dt>
                <dd>{stats?.failed7d != null ? numberFormat.format(stats.failed7d) : 'Belum tersedia'}</dd>
                <small className="admin-check-time">Pekerjaan terkendala dalam 7 hari</small>
              </div>
            </div>
            <div className="admin-kpi">
              <Activity size={20} aria-hidden="true" className="admin-kpi-icon" />
              <div>
                <dt>Median Waktu Selesai (7 Hari)</dt>
                <dd>
                  {median == null || sampleSize === 0
                    ? 'Belum cukup data'
                    : median < 60
                      ? `${numberFormat.format(median)} detik`
                      : durationLabel(median)}
                </dd>
                <small className="admin-check-time">
                  {numberFormat.format(sampleSize)} sampel valid (7 hari)
                </small>
              </div>
            </div>
          </dl>
          {stats?.totalCompleted != null && stats?.totalFailed != null && (
            <p className="admin-queue-historical-note">
              Riwayat kumulatif keseluruhan: <strong>{numberFormat.format(stats.totalCompleted)}</strong> selesai · <strong>{numberFormat.format(stats.totalFailed)}</strong> gagal sejak awal sistem.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function ProcessingLifecycleFlow({ job }: { job: ProcessingJob }) {
  const isDone = job.status === 'done';
  const isFailed = job.status === 'failed';
  const isQueued = job.status === 'queued';

  const hasTranscript = job.hasTranscript;
  const stage = job.stage;

  // Derive stage statuses
  const uploadState = 'completed';
  const queueState = isQueued ? 'current' : 'completed';

  let transcribingState: 'completed' | 'current' | 'failed' | 'pending' = 'pending';
  if (isQueued) {
    transcribingState = 'pending';
  } else if (stage === 'transcribing') {
    transcribingState = 'current';
  } else if (hasTranscript || isDone || stage === 'summarizing') {
    transcribingState = 'completed';
  } else if (isFailed && !hasTranscript) {
    transcribingState = 'failed';
  }

  const requestedDiarizer = job.diarizer && job.diarizer !== 'none';
  let diarizationState: 'completed' | 'current' | 'failed' | 'skipped' | 'pending' = requestedDiarizer ? 'pending' : 'skipped';
  if (requestedDiarizer) {
    if (transcribingState === 'completed') {
      diarizationState = 'completed';
    } else if (transcribingState === 'current') {
      diarizationState = 'current';
    } else if (transcribingState === 'failed') {
      diarizationState = 'failed';
    }
  }

  let summarizingState: 'completed' | 'current' | 'failed' | 'pending' = 'pending';
  if (isDone) {
    summarizingState = 'completed';
  } else if (stage === 'summarizing') {
    summarizingState = 'current';
  } else if (isFailed && hasTranscript) {
    summarizingState = 'failed';
  }

  const finalState = isDone ? 'completed' : isFailed ? 'failed' : 'pending';

  const steps = [
    { label: 'Unggahan Diterima', state: uploadState, desc: 'Berkas tersimpan di storage' },
    { label: 'Antrean', state: queueState, desc: isQueued ? 'Menunggu giliran eksekusi' : 'Teralokasi ke antrean' },
    { label: 'Transkripsi', state: transcribingState, desc: job.sttModel ? `Model ${job.sttModel}` : 'Mesin ASR' },
    { label: 'Diarisasi', state: diarizationState, desc: requestedDiarizer ? `Model ${job.diarizer}` : 'Tidak diminta' },
    { label: 'Ringkasan AI', state: summarizingState, desc: job.llmModel ? `LLM ${job.llmModel}` : 'Pembuatan ringkasan' },
    { label: 'Selesai', state: finalState, desc: isDone ? 'Hasil siap diunduh' : isFailed ? 'Proses terhenti' : 'Menunggu alur' },
  ];

  return (
    <div className="admin-lifecycle-flow" role="region" aria-label="Visualisasi Siklus Pemrosesan">
      <div className="admin-lifecycle-flow-header">
        <span className="admin-lifecycle-flow-title">Alur Eksekusi Pemrosesan</span>
        {job.retryCount != null && job.retryCount > 0 && (
          <span className="admin-retry-count-badge">
            <RotateCcw size={12} aria-hidden="true" /> {job.retryCount}x Percobaan Ulang
          </span>
        )}
      </div>
      <ol className="admin-lifecycle-steps">
        {steps.map((step, idx) => (
          <li key={step.label} className={`admin-lifecycle-step is-${step.state}`}>
            <div className="admin-lifecycle-step-marker" aria-hidden="true">
              {step.state === 'completed' && <Check size={14} />}
              {step.state === 'failed' && <X size={14} />}
              {step.state === 'current' && <span className="admin-lifecycle-pulse" />}
              {step.state === 'skipped' && <span className="admin-lifecycle-dash">—</span>}
              {step.state === 'pending' && <span className="admin-lifecycle-dot">{idx + 1}</span>}
            </div>
            <div className="admin-lifecycle-step-content">
              <strong>{step.label}</strong>
              <small>{step.desc}</small>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function JobDetailDrawer({
  jobId,
  onClose,
  onJobRetried,
}: {
  jobId: string;
  onClose: () => void;
  onJobRetried: () => void;
}) {
  const { data, loading, error, reload } = useAdminData<{ job: ProcessingJob }>(`/admin/system/jobs/${encodeURIComponent(jobId)}`);
  const [retrying, setRetrying] = useState(false);
  const [retryResult, setRetryResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [onClose]);

  const job = data?.job;

  const handleRetry = async () => {
    if (!job) return;
    setRetrying(true);
    setRetryResult(null);
    try {
      const res = await apiRequest<{ success: boolean; message: string }>(`/admin/system/jobs/${encodeURIComponent(job.id)}/retry`, {
        method: 'POST',
      });
      setRetryResult({ success: true, message: res.message || 'Pekerjaan berhasil dimasukkan kembali ke antrean.' });
      setShowConfirm(false);
      onJobRetried();
      reload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menjalankan percobaan ulang.';
      setRetryResult({ success: false, message: msg });
      setShowConfirm(false);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <>
      <div className="admin-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="admin-audit-drawer admin-job-drawer" aria-labelledby="admin-job-drawer-heading" role="dialog" aria-modal="true">
        <div className="admin-audit-drawer-header">
          <div className="admin-audit-drawer-title">
            <FileText size={18} aria-hidden="true" className="drawer-icon" />
            <h3 id="admin-job-drawer-heading">Detail Investigasi Pekerjaan</h3>
          </div>
          <button type="button" className="admin-drawer-close" onClick={onClose} aria-label="Tutup detail pekerjaan">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="admin-audit-drawer-body">
          {loading && <p role="status">Memuat data rincian pekerjaan…</p>}
          {error && (
            <div className="admin-load-error">
              <p className="admin-error" role="alert">{error}</p>
              <button type="button" className="button-secondary" onClick={reload}>Coba lagi</button>
            </div>
          )}

          {job && (
            <>
              <div className="admin-drawer-status-wrap">
                <span className={`admin-job-status-pill admin-job-status-pill--${job.status}`}>
                  {jobStatusLabels[job.status] || job.status}
                </span>
                {job.stage && (
                  <span className="admin-job-stage-pill">
                    {jobStageLabels[job.stage] || job.stage}
                  </span>
                )}
                {job.errorCategory && <ErrorCategoryPill category={job.errorCategory} />}
              </div>

              {retryResult && (
                <div className={`admin-feedback-banner ${retryResult.success ? 'is-success' : 'is-error'}`} role="alert">
                  {retryResult.success ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                  <span>{retryResult.message}</span>
                </div>
              )}

              <div className="admin-drawer-section">
                <h4>B. Riwayat & Visualisasi Alur Pemrosesan</h4>
                <ProcessingLifecycleFlow job={job} />
              </div>

              <div className="admin-drawer-section">
                <h4>A. Informasi Berkas & Unggahan</h4>
                <dl className="admin-drawer-list">
                  <div className="admin-drawer-row">
                    <dt>ID Pekerjaan</dt>
                    <dd className="admin-drawer-value-with-copy">
                      <code>{job.id}</code>
                      <CopyButton text={job.id} label="Salin ID" />
                    </dd>
                  </div>
                  <div className="admin-drawer-row">
                    <dt>Judul Rekaman</dt>
                    <dd><strong>{job.title}</strong></dd>
                  </div>
                  <div className="admin-drawer-row">
                    <dt>Nama Berkas Asli</dt>
                    <dd>{job.originalFilename || '—'}</dd>
                  </div>
                  <div className="admin-drawer-row">
                    <dt>Pengunggah</dt>
                    <dd>{job.ownerName ? `${job.ownerName} (${job.ownerId || '—'})` : job.ownerId || 'Anonim'}</dd>
                  </div>
                  <div className="admin-drawer-row">
                    <dt>Ukuran Berkas</dt>
                    <dd>{job.fileSize ? formatUploadedBytes(job.fileSize) : '—'}</dd>
                  </div>
                  <div className="admin-drawer-row">
                    <dt>Bahasa Audio</dt>
                    <dd>{job.language === 'id' ? 'Bahasa Indonesia (id)' : job.language === 'en' ? 'Bahasa Inggris (en)' : job.language}</dd>
                  </div>
                </dl>
              </div>

              <div className="admin-drawer-section">
                <h4>C. Status Terkini & Percobaan Ulang</h4>
                <dl className="admin-drawer-list">
                  <div className="admin-drawer-row">
                    <dt>Status Saat Ini</dt>
                    <dd>
                      <span className={`admin-job-status-pill admin-job-status-pill--${job.status}`}>
                        {jobStatusLabels[job.status] || job.status}
                      </span>
                    </dd>
                  </div>
                  <div className="admin-drawer-row">
                    <dt>Tahap Aktif</dt>
                    <dd>{job.stage ? (jobStageLabels[job.stage] || job.stage) : 'Tidak ada tahap aktif'}</dd>
                  </div>
                  <div className="admin-drawer-row">
                    <dt>Total Percobaan Ulang</dt>
                    <dd>
                      <strong>{numberFormat.format(job.retryCount ?? 0)}</strong> kali dari batas maksimum 5 kali
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="admin-drawer-section">
                <h4>D. Riwayat Percobaan Ulang (Retry History)</h4>
                {job.retryHistory && job.retryHistory.length > 0 ? (
                  <div className="admin-retry-history-table-wrap">
                    <table className="admin-retry-history-table">
                      <thead>
                        <tr>
                          <th scope="col">Waktu (WIB)</th>
                          <th scope="col">Pelaku</th>
                          <th scope="col">Hasil</th>
                          <th scope="col">Keterangan</th>
                        </tr>
                      </thead>
                      <tbody>
                        {job.retryHistory.map(entry => (
                          <tr key={entry.id}>
                            <td>
                              <time dateTime={entry.occurredAt}>
                                {adminWibDate.format(new Date(entry.occurredAt))}
                              </time>
                            </td>
                            <td>
                              <div>{entry.actorName || entry.actorId || 'Sistem'}</div>
                              {entry.id && <small className="admin-check-time">Ref: {entry.id}</small>}
                            </td>
                            <td>
                              <span className={`admin-retry-result-tag is-${entry.result}`}>
                                {entry.result === 'succeeded' ? 'Berhasil' : entry.result}
                              </span>
                            </td>
                            <td>{entry.reason || 'Percobaan ulang dipicu'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="admin-check-time">Belum pernah dilakukan percobaan ulang untuk pekerjaan ini.</p>
                )}
              </div>

              <div className="admin-drawer-section">
                <h4>F. Linimasa Waktu & Durasi Pemrosesan</h4>
                <dl className="admin-drawer-list">
                  <div className="admin-drawer-row">
                    <dt>Waktu Unggah</dt>
                    <dd>{job.createdAt ? <time dateTime={job.createdAt}>{adminWibDate.format(new Date(job.createdAt))} WIB</time> : '—'}</dd>
                  </div>
                  <div className="admin-drawer-row">
                    <dt>Terakhir Diperbarui</dt>
                    <dd>{job.updatedAt ? <time dateTime={job.updatedAt}>{adminWibDate.format(new Date(job.updatedAt))} WIB</time> : '—'}</dd>
                  </div>
                  <div className="admin-drawer-row">
                    <dt>Waktu Selesai</dt>
                    <dd>{job.completedAt ? <time dateTime={job.completedAt}>{adminWibDate.format(new Date(job.completedAt))} WIB</time> : 'Belum selesai'}</dd>
                  </div>
                  <div className="admin-drawer-row">
                    <dt>Durasi Pemrosesan</dt>
                    <dd>{formatDurationDetail(job.durationSeconds)}</dd>
                  </div>
                </dl>
              </div>

              <div className="admin-drawer-section">
                <h4>G. Konfigurasi Mesin & Layanan Terkait</h4>
                <dl className="admin-drawer-list">
                  <div className="admin-drawer-row">
                    <dt>Model STT</dt>
                    <dd><code>{job.sttModel || 'Standar (Default)'}</code></dd>
                  </div>
                  <div className="admin-drawer-row">
                    <dt>Model Diarizer</dt>
                    <dd><code>{job.diarizer || 'Tanpa pemisah pembicara'}</code></dd>
                  </div>
                  <div className="admin-drawer-row">
                    <dt>Model Ringkasan LLM</dt>
                    <dd><code>{job.llmModel || 'Standar (Default)'}</code></dd>
                  </div>
                  <div className="admin-drawer-row">
                    <dt>Status Transkrip</dt>
                    <dd>{job.hasTranscript ? `Tersimpan (${numberFormat.format(job.segmentCount ?? 0)} segmen pembicara)` : 'Belum tersimpan'}</dd>
                  </div>
                  <div className="admin-drawer-row">
                    <dt>Status Ringkasan</dt>
                    <dd>{job.hasSummary ? 'Ringkasan eksekutif tersedia' : 'Belum dibuat'}</dd>
                  </div>
                </dl>
              </div>

              {(job.status === 'failed' || job.errorCategory) && (
                <div className="admin-drawer-section admin-drawer-section--error">
                  <h4>E. Investigasi & Rincian Kendala</h4>
                  <div className="admin-error-investigation-box">
                    <div className="admin-error-header">
                      {job.errorCategory && <ErrorCategoryPill category={job.errorCategory} />}
                    </div>
                    <p className="admin-technical-error">
                      <strong>Pesan Kesalahan:</strong> {job.error || 'Terjadi kesalahan internal tanpa rincian pesan.'}
                    </p>
                    <div className="admin-troubleshooting-tips">
                      <strong>Panduan Tindakan Pemulihan:</strong>
                      {job.canRetry ? (
                        <p>Transkrip audio rekaman telah tersimpan dengan aman di basis data. Anda dapat langsung memicu pembuatan ulang ringkasan AI di bawah tanpa perlu mengunggah ulang berkas audio.</p>
                      ) : (job.retryCount ?? 0) >= 5 ? (
                        <p>Pekerjaan ini telah mencapai batas maksimum percobaan ulang (5 kali). Silakan lakukan unggah ulang berkas secara manual.</p>
                      ) : (
                        <p>File audio mentah telah dibersihkan demi kebijakan privasi dan kuota penyimpanan server. Pengguna perlu mengunggah kembali rekaman tersebut jika ingin diproses ulang.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="admin-drawer-section admin-drawer-actions">
                <h4>Aksi Operasional</h4>
                {job.canRetry ? (
                  showConfirm ? (
                    <div className="admin-retry-confirm-box">
                      <p><strong>Konfirmasi Percobaan Ulang:</strong> Apakah Anda yakin ingin memasukkan kembali pekerjaan ini ke dalam antrean pemrosesan?</p>
                      <div className="admin-retry-confirm-buttons">
                        <button type="button" className="button-primary" disabled={retrying} onClick={handleRetry}>
                          {retrying ? 'Memproses...' : 'Ya, Jalankan Percobaan Ulang'}
                        </button>
                        <button type="button" className="button-secondary" disabled={retrying} onClick={() => setShowConfirm(false)}>
                          Batal
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="button-primary admin-retry-btn" onClick={() => setShowConfirm(true)}>
                      <RotateCcw size={16} aria-hidden="true" /> Jalankan Percobaan Ulang (Retry)
                    </button>
                  )
                ) : (
                  <div className="admin-retry-disabled-note">
                    <Info size={16} aria-hidden="true" />
                    <span>{job.retryReason || 'Percobaan ulang tidak tersedia untuk pekerjaan ini.'}</span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

const initialJobFilters = {
  q: '',
  status: '',
  processingType: '',
  from: '',
  to: '',
  order: 'desc',
  page: '1',
};

function UploadProcessingHistory({ onSelectJob }: { onSelectJob: (id: string) => void }) {
  const [filters, setFilters] = useState(initialJobFilters);
  const queryParams = new URLSearchParams(filters);
  const { data, loading, error, reload } = useAdminData<ProcessingJobsPage>(`/admin/system/jobs?${queryParams.toString()}`, 15000);

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFilters({
      q: String(form.get('q') ?? '').trim(),
      status: String(form.get('status') ?? ''),
      processingType: String(form.get('processingType') ?? ''),
      from: String(form.get('from') ?? ''),
      to: String(form.get('to') ?? ''),
      order: String(form.get('order') ?? 'desc'),
      page: '1',
    });
  };

  const resetFilters = () => setFilters(initialJobFilters);
  const goToPage = (page: number) => setFilters(prev => ({ ...prev, page: String(page) }));
  const pages = data?.totalPages ?? 1;

  return (
    <section className="surface-card admin-section" aria-labelledby="admin-jobs-heading">
      <div className="admin-section-heading">
        <div>
          <h3 id="admin-jobs-heading">Riwayat & Investigasi Pemrosesan Antrean</h3>
          <span className="admin-check-time">Pencarian, pemfilteran, klasifikasi kegagalan, dan investigasi pekerjaan unggahan</span>
        </div>
        <button type="button" className="button-secondary" disabled={loading} onClick={reload}>
          <RefreshCw size={16} aria-hidden="true" /> Perbarui
        </button>
      </div>

      <form className="admin-filters admin-jobs-filter-form" onSubmit={applyFilters} onReset={resetFilters} aria-label="Filter Riwayat Pekerjaan">
        <label className="admin-field">
          Pencarian Berkas / ID
          <input type="search" name="q" maxLength={100} defaultValue={filters.q} placeholder="ID, nama file, judul, pemilik" />
        </label>
        <label className="admin-field">
          Status Pekerjaan
          <select name="status" defaultValue={filters.status}>
            <option value="">Semua Status</option>
            <option value="queued">Menunggu (Queued)</option>
            <option value="processing">Sedang Diproses (Processing)</option>
            <option value="done">Selesai (Done)</option>
            <option value="failed">Gagal (Failed)</option>
          </select>
        </label>
        <label className="admin-field">
          Mesin / Pipeline
          <select name="processingType" defaultValue={filters.processingType}>
            <option value="">Semua Mesin</option>
            <option value="whisper">Whisper</option>
            <option value="qwen">Qwen</option>
            <option value="sea">SEA-ASR-ID</option>
            <option value="nemotron">Nemotron Diarizer</option>
            <option value="pyannote">Pyannote Diarizer</option>
          </select>
        </label>
        <label className="admin-field">
          Dari Tanggal (WIB)
          <input type="date" name="from" defaultValue={filters.from} />
        </label>
        <label className="admin-field">
          Sampai Tanggal (WIB)
          <input type="date" name="to" defaultValue={filters.to} />
        </label>
        <label className="admin-field">
          Urutan Waktu
          <select name="order" defaultValue={filters.order}>
            <option value="desc">Terbaru Dahulu</option>
            <option value="asc">Terlama Dahulu</option>
          </select>
        </label>
        <div className="admin-filter-actions">
          <button type="submit" className="button-primary">Terapkan Filter</button>
          <button type="reset" className="button-secondary">Reset</button>
        </div>
      </form>

      {loading && !data && <p role="status">Memuat riwayat pekerjaan pemrosesan…</p>}
      {error && <AdminLoadState error={error} reload={reload} />}

      {data && !error && (
        <>
          <div className="admin-table-top-bar">
            <span className="admin-table-total-count" role="status">
              Total <strong>{numberFormat.format(data.total)}</strong> pekerjaan ditemukan
            </span>
          </div>

          {data.jobs.length === 0 ? (
            <p className="admin-empty-state" role="status">
              {filters.q || filters.status || filters.processingType || filters.from || filters.to
                ? 'Tidak ada pekerjaan pemrosesan yang cocok dengan filter yang diterapkan.'
                : 'Belum ada rekaman yang pernah diproses dalam sistem.'}
            </p>
          ) : (
            <div className="admin-table-scroll" tabIndex={0} role="region" aria-label="Tabel Riwayat Pekerjaan">
              <table className="admin-table admin-jobs-table">
                <thead>
                  <tr>
                    <th scope="col">ID Unggahan</th>
                    <th scope="col">Berkas & Judul</th>
                    <th scope="col">Pengunggah</th>
                    <th scope="col">Diunggah (WIB)</th>
                    <th scope="col">Selesai (WIB)</th>
                    <th scope="col">Durasi</th>
                    <th scope="col">Mesin / Diarizer</th>
                    <th scope="col">Percobaan</th>
                    <th scope="col">Status & Terakhir Eror</th>
                    <th scope="col">Analisis / Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {data.jobs.map(job => (
                    <tr key={job.id} className="admin-table-row">
                      <td>
                        <span className="admin-table-code" title={job.id}>{job.id.slice(0, 8)}…</span>
                      </td>
                      <td>
                        <div className="admin-job-title-wrap">
                          <strong>{job.title}</strong>
                          {job.originalFilename && <small className="admin-job-filename">{job.originalFilename}</small>}
                        </div>
                      </td>
                      <td>
                        <span className="admin-job-owner">{job.ownerName || job.ownerId || '—'}</span>
                      </td>
                      <td>
                        {job.createdAt ? (
                          <time dateTime={job.createdAt}>{adminWibDate.format(new Date(job.createdAt))}</time>
                        ) : '—'}
                      </td>
                      <td>
                        {job.completedAt ? (
                          <time dateTime={job.completedAt}>{adminWibDate.format(new Date(job.completedAt))}</time>
                        ) : (
                          <span className="admin-check-time">Belum selesai</span>
                        )}
                      </td>
                      <td>{formatDurationDetail(job.durationSeconds)}</td>
                      <td>
                        <div className="admin-pipeline-badge">
                          <span>{job.sttModel || 'Whisper'}</span>
                          {job.diarizer && job.diarizer !== 'none' && (
                            <small className="admin-diarizer-tag">+{job.diarizer}</small>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className={`admin-retry-badge ${(job.retryCount ?? 0) > 0 ? 'has-retries' : ''}`}>
                          {numberFormat.format(job.retryCount ?? 0)}x
                        </span>
                      </td>
                      <td>
                        <div className="admin-status-cell">
                          <span className={`admin-job-status-pill admin-job-status-pill--${job.status}`}>
                            {jobStatusLabels[job.status] || job.status}
                          </span>
                          {job.stage && (
                            <small className="admin-stage-tag">{jobStageLabels[job.stage] || job.stage}</small>
                          )}
                          {job.errorCategory && (
                            <div className="admin-row-error-preview" title={job.error || job.errorCategory.label}>
                              <ErrorCategoryPill category={job.errorCategory} />
                            </div>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="admin-row-actions">
                          <button
                            type="button"
                            className="button-secondary admin-btn-xs"
                            onClick={() => onSelectJob(job.id)}
                            aria-label={`Lihat detail pekerjaan ${job.title}`}
                          >
                            <Eye size={13} aria-hidden="true" /> Detail
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="admin-pagination">
            <p role="status">
              {numberFormat.format(data.total)} pekerjaan · Halaman {data.page} dari {pages}
            </p>
            <div>
              <button
                type="button"
                className="button-secondary"
                disabled={data.page <= 1}
                onClick={() => goToPage(data.page - 1)}
              >
                Sebelumnya
              </button>
              <button
                type="button"
                className="button-secondary"
                disabled={data.page >= pages}
                onClick={() => goToPage(data.page + 1)}
              >
                Berikutnya
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function AdminSystem() {
  const [activeTab, setActiveTab] = useState<'health' | 'jobs'>('health');
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const { data, loading, error, reload } = useAdminData<SystemData>('/admin/system', 30000);

  const totalServices = data?.services.length ?? 0;
  const operationalCount = data?.services.filter(s => s.status === 'ready' || s.status === 'operational').length ?? 0;
  const degradedCount = data?.services.filter(s => s.status === 'degraded').length ?? 0;
  const unavailableCount = data?.services.filter(s => s.status === 'unavailable').length ?? 0;
  const notConfiguredCount = data?.services.filter(s => s.status === 'not_configured').length ?? 0;

  return (
    <section className="admin-section admin-system-monitor" aria-labelledby="admin-system-heading">
      <div className="admin-section-heading admin-monitor-header">
        <div>
          <h2 id="admin-system-heading">Monitor Layanan & Antrean Pemrosesan</h2>
          <p className="admin-monitor-subtitle">
            Kesehatan real-time infrastruktur Sentra, mesin transkripsi AI, pemisah pembicara, dan antrean pemrosesan berkas.
          </p>
        </div>
        <div className="admin-monitor-header-actions">
          {data?.checkedAt && <FreshnessPill checkedAt={data.checkedAt} refreshing={loading} hasError={Boolean(error)} />}
          <button type="button" className="button-secondary" disabled={loading} onClick={reload}>
            <RefreshCw size={16} aria-hidden="true" className={loading ? 'admin-spin' : ''} /> Perbarui
          </button>
        </div>
      </div>

      {loading && !data && <AdminLoadState error={error} reload={reload} />}
      {error && !data && <AdminLoadState error={error} reload={reload} />}

      {error && data && (
        <div className="admin-stale-banner" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <strong>Gagal Memperbarui Data Pemantauan:</strong> {error}
            <p>Menampilkan data historis terakhir yang berhasil diambil pada {adminWibDate.format(new Date(data.checkedAt))} WIB. Silakan periksa koneksi jaringan atau gateway API.</p>
          </div>
        </div>
      )}

      {data && (
        <>
          <div className="admin-subnav" role="tablist" aria-label="Navigasi Monitor Layanan">
            <button
              type="button"
              role="tab"
              id="admin-tab-health"
              aria-controls="admin-panel-health"
              aria-selected={activeTab === 'health'}
              className={`admin-subnav-btn ${activeTab === 'health' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('health')}
            >
              <Server size={16} aria-hidden="true" />
              <span>Kesehatan Layanan</span>
              <span className="admin-subnav-badge is-ready">{operationalCount}/{totalServices} Siap</span>
            </button>
            <button
              type="button"
              role="tab"
              id="admin-tab-jobs"
              aria-controls="admin-panel-jobs"
              aria-selected={activeTab === 'jobs'}
              className={`admin-subnav-btn ${activeTab === 'jobs' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('jobs')}
            >
              <Layers size={16} aria-hidden="true" />
              <span>Antrean & Investigasi Pekerjaan</span>
              {data.recordingQueue && (
                <span className="admin-subnav-badge">
                  {data.recordingQueue.queued != null ? numberFormat.format(data.recordingQueue.queued) : '—'} antre · {data.recordingQueue.processing != null ? numberFormat.format(data.recordingQueue.processing) : '—'} proses
                </span>
              )}
            </button>
          </div>

          <div className="admin-monitor-kpi-summary">
            <dl className="admin-kpis admin-health-kpis">
              <div className="admin-kpi">
                <CheckCircle2 size={22} className="admin-kpi-icon is-success" aria-hidden="true" />
                <div>
                  <dt>Layanan Siap</dt>
                  <dd>{numberFormat.format(operationalCount)}</dd>
                  <small className="admin-check-time">Lulus uji kesehatan terbaru</small>
                </div>
              </div>
              <div className="admin-kpi">
                <AlertTriangle size={22} className="admin-kpi-icon is-warning" aria-hidden="true" />
                <div>
                  <dt>Performa Menurun</dt>
                  <dd>{numberFormat.format(degradedCount)}</dd>
                  <small className="admin-check-time">Respons lambat/fungsi parsial</small>
                </div>
              </div>
              <div className="admin-kpi">
                <AlertCircle size={22} className="admin-kpi-icon is-danger" aria-hidden="true" />
                <div>
                  <dt>Tidak Tersedia</dt>
                  <dd>{numberFormat.format(unavailableCount)}</dd>
                  <small className="admin-check-time">Worker atau endpoint offline</small>
                </div>
              </div>
              <div className="admin-kpi">
                <MinusCircle size={22} className="admin-kpi-icon is-muted" aria-hidden="true" />
                <div>
                  <dt>Belum Dikonfigurasi</dt>
                  <dd>{numberFormat.format(notConfiguredCount)}</dd>
                  <small className="admin-check-time">Integrasi opsional belum aktif</small>
                </div>
              </div>
              <div className="admin-kpi">
                <HardDrive size={22} className="admin-kpi-icon is-primary" aria-hidden="true" />
                <div>
                  <dt>Basis Data & SFU</dt>
                  <dd>{data.databaseConnected && data.livekit === 'reachable' ? 'Normal' : 'Terganggu'}</dd>
                  <small className="admin-check-time">
                    DB: {data.latency?.databaseMs != null ? `${data.latency.databaseMs}ms` : 'OK'} · SFU: {data.livekit === 'reachable' ? 'Terhubung' : 'Offline'}
                  </small>
                </div>
              </div>
            </dl>
          </div>

          {activeTab === 'health' ? (
            <div id="admin-panel-health" role="tabpanel" aria-labelledby="admin-tab-health" className="admin-tab-panel">
              <CoreInfrastructureSection system={data} />
              <SummaryModelSection services={data.services} />
              <ProcessingOverviewCard
                metrics={data.recordingQueue}
                stats={data.queueStats}
                checkedAt={data.checkedAt}
                refreshing={loading}
                hasError={Boolean(error)}
                onNavigateToInvestigation={() => setActiveTab('jobs')}
              />
              <TranscriptionEnginesSection services={data.services} />
              <SpeakerDiarizationSection services={data.services} />
            </div>
          ) : (
            <div id="admin-panel-jobs" role="tabpanel" aria-labelledby="admin-tab-jobs" className="admin-tab-panel">
              <ProcessingOverviewCard
                metrics={data.recordingQueue}
                stats={data.queueStats}
                checkedAt={data.checkedAt}
                refreshing={loading}
                hasError={Boolean(error)}
                onNavigateToInvestigation={() => {}}
              />
              <UploadProcessingHistory onSelectJob={id => setSelectedJobId(id)} />
            </div>
          )}

          {selectedJobId && (
            <JobDetailDrawer
              jobId={selectedJobId}
              onClose={() => setSelectedJobId(null)}
              onJobRetried={() => {
                reload();
              }}
            />
          )}
        </>
      )}
    </section>
  );
}

function getJakartaDateString(offsetDays = 0): string {
  const d = new Date();
  if (offsetDays !== 0) {
    d.setDate(d.getDate() - offsetDays);
  }
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d);
}

function fallbackCopyText(text: string, onSuccess: () => void) {
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'absolute';
    el.style.left = '-9999px';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    if (ok) onSuccess();
  } catch {
    // ignore
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!text) return;
    const onSuccess = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };
    if (navigator?.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(onSuccess).catch(() => {
        fallbackCopyText(text, onSuccess);
      });
    } else {
      fallbackCopyText(text, onSuccess);
    }
  };

  return (
    <button
      type="button"
      className="admin-audit-copy-btn"
      onClick={handleCopy}
      aria-label={`Salin ${label}`}
      title={copied ? 'Tersalin!' : `Salin ${label}`}
    >
      {copied ? <Check size={13} className="copy-icon--success" aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      {copied && <span className="copy-tooltip" role="status">Tersalin</span>}
    </button>
  );
}

function AuditStatusPill({ result }: { result: string }) {
  switch (result) {
    case 'succeeded':
      return (
        <span className="admin-status-pill admin-status-pill--success">
          <CheckCircle2 size={13} aria-hidden="true" /> {resultLabels.succeeded ?? 'Berhasil'}
        </span>
      );
    case 'denied':
      return (
        <span className="admin-status-pill admin-status-pill--denied">
          <X size={13} aria-hidden="true" /> {resultLabels.denied ?? 'Ditolak'}
        </span>
      );
    case 'failed':
      return (
        <span className="admin-status-pill admin-status-pill--failed">
          <AlertTriangle size={13} aria-hidden="true" /> {resultLabels.failed ?? 'Gagal'}
        </span>
      );
    case 'no_change':
      return (
        <span className="admin-status-pill admin-status-pill--neutral">
          <MinusCircle size={13} aria-hidden="true" /> {resultLabels.no_change ?? 'Tanpa Perubahan'}
        </span>
      );
    default:
      return (
        <span className="admin-status-pill admin-status-pill--neutral">
          <Info size={13} aria-hidden="true" /> {result}
        </span>
      );
  }
}

function AuditDetailDrawer({
  entry,
  onClose,
  onFilterActor,
  onFilterTarget,
}: {
  entry: AuditEntry;
  onClose: () => void;
  onFilterActor?: (actorId: string) => void;
  onFilterTarget?: (targetId: string) => void;
}) {
  const eventIdFormatted = `AUD-${entry.id}`;

  return (
    <>
      <div className="admin-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="admin-audit-drawer" aria-labelledby="admin-drawer-heading" role="dialog" aria-modal="true">
        <div className="admin-audit-drawer-header">
          <div className="admin-audit-drawer-title">
            <FileText size={18} aria-hidden="true" className="drawer-icon" />
            <h3 id="admin-drawer-heading">Detail Aktivitas Audit</h3>
          </div>
          <button
            type="button"
            className="admin-drawer-close"
            onClick={onClose}
            aria-label="Tutup detail audit"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="admin-audit-drawer-body">
          <div className="admin-drawer-status-wrap">
            <AuditStatusPill result={entry.result} />
          </div>

          <div className="admin-drawer-section">
            <h4>Informasi Aktivitas</h4>
            <dl className="admin-drawer-list">
              <div className="admin-drawer-row">
                <dt><Clock size={15} aria-hidden="true" /> Waktu</dt>
                <dd>
                  <time dateTime={entry.occurredAt}>
                    {adminWibDate.format(new Date(entry.occurredAt))} WIB
                  </time>
                </dd>
              </div>
              <div className="admin-drawer-row">
                <dt><User size={15} aria-hidden="true" /> Pelaku</dt>
                <dd className="admin-drawer-value-with-copy">
                  <span>
                    {entry.actorId ? (entry.actorName ? `${entry.actorId} (${entry.actorName})` : entry.actorId) : 'Sistem (Penetapan awal)'}
                  </span>
                  {entry.actorId && (
                    <div className="admin-drawer-action-icons">
                      <CopyButton text={entry.actorId} label="Pelaku" />
                      {onFilterActor && (
                        <button
                          type="button"
                          className="admin-audit-copy-btn"
                          onClick={() => onFilterActor(entry.actorId!)}
                          title={`Filter riwayat pelaku ${entry.actorId}`}
                          aria-label={`Filter riwayat pelaku ${entry.actorId}`}
                        >
                          <Filter size={13} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  )}
                </dd>
              </div>
              <div className="admin-drawer-row">
                <dt><Target size={15} aria-hidden="true" /> Target</dt>
                <dd className="admin-drawer-value-with-copy">
                  <span>
                    {entry.targetName ? `${entry.targetId} (${entry.targetName})` : entry.targetId}
                  </span>
                  <div className="admin-drawer-action-icons">
                    <CopyButton text={entry.targetId} label="Target" />
                    {onFilterTarget && (
                      <button
                        type="button"
                        className="admin-audit-copy-btn"
                        onClick={() => onFilterTarget(entry.targetId)}
                        title={`Cari riwayat target ${entry.targetId}`}
                        aria-label={`Cari riwayat target ${entry.targetId}`}
                      >
                        <Search size={13} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </dd>
              </div>
              <div className="admin-drawer-row">
                <dt><Zap size={15} aria-hidden="true" /> Tindakan</dt>
                <dd><strong>{actionLabels[entry.action] ?? entry.action}</strong></dd>
              </div>
              <div className="admin-drawer-row">
                <dt><CheckCircle2 size={15} aria-hidden="true" /> Hasil</dt>
                <dd><AuditStatusPill result={entry.result} /></dd>
              </div>
              {entry.reason && (
                <div className="admin-drawer-row">
                  <dt><Info size={15} aria-hidden="true" /> Keterangan</dt>
                  <dd className="admin-drawer-reason">{reasonLabels[entry.reason] ?? entry.reason}</dd>
                </div>
              )}
            </dl>
          </div>

          {(entry.previousValue || entry.newValue) && (
            <div className="admin-drawer-section">
              <h4>Perubahan Data</h4>
              <div className="admin-drawer-diff">
                <div className="admin-drawer-diff-col">
                  <span className="diff-label">Sebelum</span>
                  <div className="diff-value">
                    {valueLabels[entry.previousValue ?? ''] ?? entry.previousValue ?? '—'}
                  </div>
                </div>
                <div className="admin-drawer-diff-arrow" aria-hidden="true">→</div>
                <div className="admin-drawer-diff-col">
                  <span className="diff-label">Sesudah</span>
                  <div className="diff-value diff-value--new">
                    {valueLabels[entry.newValue ?? ''] ?? entry.newValue ?? '—'}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="admin-drawer-section">
            <h4>Informasi Teknis</h4>
            <dl className="admin-drawer-list">
              <div className="admin-drawer-row">
                <dt>Event ID</dt>
                <dd className="admin-drawer-value-with-copy">
                  <code className="admin-code-id">{eventIdFormatted}</code>
                  <CopyButton text={eventIdFormatted} label="Event ID" />
                </dd>
              </div>
              <div className="admin-drawer-row">
                <dt>IP Address</dt>
                <dd className="admin-drawer-unavailable">Tidak tercatat</dd>
              </div>
              <div className="admin-drawer-row">
                <dt>User Agent</dt>
                <dd className="admin-drawer-unavailable">Tidak tercatat</dd>
              </div>
              <div className="admin-drawer-row">
                <dt>Request ID</dt>
                <dd className="admin-drawer-unavailable">Tidak tercatat</dd>
              </div>
            </dl>
          </div>

          <div className="admin-drawer-integrity" role="note">
            <Info size={16} aria-hidden="true" className="integrity-icon" />
            <p>Log audit bersifat immutable dan tidak dapat diubah melalui antarmuka administrator.</p>
          </div>
        </div>
      </aside>
    </>
  );
}

function AdminAudit({ permissions }: { permissions: string[] }) {
  const [formValues, setFormValues] = useState({
    search: '',
    from: '',
    to: '',
    action: '',
    result: '',
    actorId: '',
    quickRange: null as '7d' | '30d' | '90d' | 'custom' | null,
  });

  const [appliedFilters, setAppliedFilters] = useState({
    search: '',
    from: '',
    to: '',
    action: '',
    result: '',
    actorId: '',
    order: 'desc' as 'asc' | 'desc',
    page: 1,
    pageSize: 25,
  });

  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedEntry) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedEntry(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedEntry]);

  const query = new URLSearchParams();
  if (appliedFilters.from) query.set('from', appliedFilters.from);
  if (appliedFilters.to) query.set('to', appliedFilters.to);
  if (appliedFilters.action) query.set('action', appliedFilters.action);
  if (appliedFilters.search) query.set('q', appliedFilters.search);
  if (appliedFilters.result) query.set('result', appliedFilters.result);
  if (appliedFilters.actorId) query.set('actorId', appliedFilters.actorId);
  if (appliedFilters.order && appliedFilters.order !== 'desc') query.set('order', appliedFilters.order);
  if (appliedFilters.pageSize !== 50) query.set('pageSize', String(appliedFilters.pageSize));
  if (appliedFilters.page > 1) query.set('page', String(appliedFilters.page));

  const endpoint = `/admin/audit${query.toString() ? '?' + query.toString() : ''}`;
  const { data, loading, error, reload } = useAdminData<AuditPage>(endpoint);

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAppliedFilters(prev => ({
      ...prev,
      search: formValues.search,
      from: formValues.from,
      to: formValues.to,
      action: formValues.action,
      result: formValues.result,
      actorId: formValues.actorId,
      page: 1,
    }));
  };

  const handleReset = () => {
    setFormValues({
      search: '',
      from: '',
      to: '',
      action: '',
      result: '',
      actorId: '',
      quickRange: null,
    });
    setAppliedFilters({
      search: '',
      from: '',
      to: '',
      action: '',
      result: '',
      actorId: '',
      order: 'desc',
      page: 1,
      pageSize: appliedFilters.pageSize,
    });
    setSelectedEntry(null);
  };

  const handleFilterActor = (actorId: string) => {
    setFormValues(prev => ({ ...prev, actorId }));
    setAppliedFilters(prev => ({ ...prev, actorId, page: 1 }));
  };

  const handleFilterTarget = (targetId: string) => {
    setFormValues(prev => ({ ...prev, search: targetId }));
    setAppliedFilters(prev => ({ ...prev, search: targetId, page: 1 }));
  };

  const toggleSortOrder = () => {
    setAppliedFilters(prev => ({
      ...prev,
      order: prev.order === 'desc' ? 'asc' : 'desc',
      page: 1,
    }));
  };

  const handleQuickDate = (range: '7d' | '30d' | '90d' | 'custom') => {
    if (range === 'custom') {
      setFormValues(prev => ({ ...prev, quickRange: 'custom' }));
      return;
    }
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
    setFormValues(prev => ({
      ...prev,
      from: getJakartaDateString(days),
      to: getJakartaDateString(0),
      quickRange: range,
    }));
  };

  const goToPage = (page: number) => {
    setAppliedFilters(prev => ({ ...prev, page }));
  };

  const handlePageSizeChange = (newPageSize: number) => {
    setAppliedFilters(prev => ({ ...prev, pageSize: newPageSize, page: 1 }));
  };

  const exportCsv = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const exportParams = new URLSearchParams();
      if (appliedFilters.from) exportParams.set('from', appliedFilters.from);
      if (appliedFilters.to) exportParams.set('to', appliedFilters.to);
      if (appliedFilters.action) exportParams.set('action', appliedFilters.action);
      if (appliedFilters.search) exportParams.set('q', appliedFilters.search);
      if (appliedFilters.result) exportParams.set('result', appliedFilters.result);
      if (appliedFilters.actorId) exportParams.set('actorId', appliedFilters.actorId);
      if (appliedFilters.order && appliedFilters.order !== 'desc') exportParams.set('order', appliedFilters.order);

      const response = await fetch(`${API_BASE}/admin/audit/export?${exportParams.toString()}`, {
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
      a.download = `audit-admin-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setExportError(err instanceof Error ? err.message : 'Gagal mengekspor data audit ke CSV.');
    } finally {
      setExporting(false);
    }
  };

  const filtered = Boolean(
    appliedFilters.search ||
    appliedFilters.from ||
    appliedFilters.to ||
    appliedFilters.action ||
    appliedFilters.result ||
    appliedFilters.actorId
  );

  const pages = data ? Math.max(1, Math.ceil(data.total / (data.pageSize || appliedFilters.pageSize))) : 1;
  const currentLimit = data?.pageSize || appliedFilters.pageSize;
  const startRecord = data?.total ? (data.page - 1) * currentLimit + 1 : 0;
  const endRecord = data?.total ? Math.min(data.total, data.page * currentLimit) : 0;

  const summaryTotal = data?.summary?.total ?? data?.total ?? 0;
  const summarySucceeded = data?.summary?.succeeded ?? (data?.entries.filter(e => e.result === 'succeeded').length || 0);
  const summaryDenied = data?.summary?.denied ?? (data?.entries.filter(e => e.result === 'denied' || e.result === 'failed').length || 0);
  const summaryNoChange = data?.summary?.noChange ?? (data?.entries.filter(e => e.result === 'no_change').length || 0);

  const standardActions = [
    'admin.bootstrap',
    'admin.grant',
    'admin.revoke',
    'account.status.change',
    'account.invite',
    'account.request.approve',
    'account.request.decline',
  ];
  const allActions = Array.from(new Set([...standardActions, ...(data?.actions || [])]));

  return (
    <div className="admin-audit-center">
      <header className="admin-audit-header">
        <div className="admin-audit-title-area">
          <div className="admin-audit-breadcrumb" aria-label="Breadcrumb">
            <span>Admin</span> <ChevronRight size={14} aria-hidden="true" /> <span>Audit</span>
          </div>
          <div className="admin-audit-title-row">
            <div className="admin-audit-icon-wrap" aria-hidden="true">
              <ShieldCheck size={26} />
            </div>
            <div>
              <h2>Admin Audit Center</h2>
              <p className="admin-audit-subtitle">
                Monitoring dan investigasi aktivitas administrator pada sistem Bali Tower.
              </p>
            </div>
          </div>
        </div>
        <div className="admin-audit-header-actions">
          <button
            type="button"
            className="button-secondary admin-export-btn"
            disabled={loading || exporting || (data?.total === 0)}
            onClick={exportCsv}
            aria-label="Export CSV data audit"
          >
            <Download size={16} aria-hidden="true" />
            <span>{exporting ? 'Mengekspor...' : 'Export CSV'}</span>
          </button>
          <button
            type="button"
            className="button-secondary admin-refresh-btn"
            disabled={loading}
            onClick={reload}
            aria-label="Perbarui data audit"
          >
            <RefreshCw size={16} aria-hidden="true" className={loading ? 'spin' : ''} />
          </button>
        </div>
      </header>

      {permissions.length > 0 && (
        <div className="admin-audit-access-bar" aria-label="Akses Super Admin">
          <ShieldCheck size={14} aria-hidden="true" />
          <span>Izin aktif: {permissions.map(p => permissionLabels[p] ?? p).join(', ')}</span>
        </div>
      )}

      <section className="admin-audit-cards" aria-label="Ringkasan Aktivitas Audit">
        <div className="admin-audit-card admin-audit-card--total">
          <div className="admin-audit-card-icon" aria-hidden="true">
            <Activity size={22} />
          </div>
          <div className="admin-audit-card-content">
            <span className="admin-audit-card-title">Total Aktivitas</span>
            <strong className="admin-audit-card-value">{numberFormat.format(summaryTotal)}</strong>
            <span className="admin-audit-card-label">Dalam periode terpilih</span>
          </div>
        </div>

        <div className="admin-audit-card admin-audit-card--success">
          <div className="admin-audit-card-icon" aria-hidden="true">
            <CheckCircle2 size={22} />
          </div>
          <div className="admin-audit-card-content">
            <span className="admin-audit-card-title">Berhasil</span>
            <strong className="admin-audit-card-value">{numberFormat.format(summarySucceeded)}</strong>
            <span className="admin-audit-card-label">Transaksi sukses</span>
          </div>
        </div>

        <div className="admin-audit-card admin-audit-card--denied">
          <div className="admin-audit-card-icon" aria-hidden="true">
            <AlertTriangle size={22} />
          </div>
          <div className="admin-audit-card-content">
            <span className="admin-audit-card-title">Ditolak / Gagal</span>
            <strong className="admin-audit-card-value">{numberFormat.format(summaryDenied)}</strong>
            <span className="admin-audit-card-label">Perlu ditinjau</span>
          </div>
        </div>

        <div className="admin-audit-card admin-audit-card--neutral">
          <div className="admin-audit-card-icon" aria-hidden="true">
            <MinusCircle size={22} />
          </div>
          <div className="admin-audit-card-content">
            <span className="admin-audit-card-title">Tanpa Perubahan</span>
            <strong className="admin-audit-card-value">{numberFormat.format(summaryNoChange)}</strong>
            <span className="admin-audit-card-label">Tidak mengubah data</span>
          </div>
        </div>
      </section>

      <section className="surface-card admin-audit-filter-card" aria-labelledby="admin-filter-heading">
        <div className="admin-audit-filter-header">
          <Filter size={18} aria-hidden="true" className="filter-header-icon" />
          <div>
            <h3 id="admin-filter-heading">Filter & Pencarian</h3>
            <p className="filter-header-sub">Cari dan filter aktivitas audit dengan lebih spesifik</p>
          </div>
        </div>

        <form className="admin-audit-filter-form" onSubmit={applyFilters} onReset={handleReset}>
          <div className="admin-audit-filter-grid">
            <label className="admin-field admin-field--search">
              <span className="admin-field-label">Pencarian</span>
              <div className="admin-input-with-icon">
                <Search size={16} aria-hidden="true" className="input-icon" />
                <input
                  type="text"
                  name="q"
                  placeholder="Cari ID, nama, atau kata kunci..."
                  value={formValues.search}
                  onChange={e => setFormValues(prev => ({ ...prev, search: e.target.value }))}
                />
              </div>
            </label>

            <label className="admin-field">
              <span className="admin-field-label">Tanggal Awal (WIB)</span>
              <input
                type="date"
                name="from"
                value={formValues.from}
                onChange={e => setFormValues(prev => ({ ...prev, from: e.target.value, quickRange: 'custom' }))}
              />
            </label>

            <label className="admin-field">
              <span className="admin-field-label">Tanggal Akhir (WIB)</span>
              <input
                type="date"
                name="to"
                value={formValues.to}
                onChange={e => setFormValues(prev => ({ ...prev, to: e.target.value, quickRange: 'custom' }))}
              />
            </label>

            <label className="admin-field">
              <span className="admin-field-label">Jenis Tindakan</span>
              <select
                name="action"
                value={formValues.action}
                onChange={e => setFormValues(prev => ({ ...prev, action: e.target.value }))}
              >
                <option value="">Semua Tindakan</option>
                {allActions.map(action => (
                  <option key={action} value={action}>
                    {actionLabels[action] ?? action}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-field">
              <span className="admin-field-label">Status Hasil</span>
              <select
                name="result"
                value={formValues.result}
                onChange={e => setFormValues(prev => ({ ...prev, result: e.target.value }))}
              >
                <option value="">Semua Status</option>
                <option value="succeeded">Berhasil</option>
                <option value="denied">Ditolak</option>
                <option value="failed">Gagal</option>
                <option value="no_change">Tanpa Perubahan</option>
              </select>
            </label>

            <label className="admin-field">
              <span className="admin-field-label">Pelaku</span>
              <select
                name="actorId"
                value={formValues.actorId}
                onChange={e => setFormValues(prev => ({ ...prev, actorId: e.target.value }))}
              >
                <option value="">Semua Pelaku</option>
                <option value="system">Sistem (Penetapan awal)</option>
                {data?.actors?.map(actor => (
                  <option key={actor} value={actor}>{actor}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="admin-audit-filter-footer">
            <div className="admin-quick-dates" role="group" aria-label="Rentang tanggal cepat">
              <button
                type="button"
                className={`admin-quick-date-btn ${formValues.quickRange === '7d' ? 'active' : ''}`}
                onClick={() => handleQuickDate('7d')}
              >
                7 Hari
              </button>
              <button
                type="button"
                className={`admin-quick-date-btn ${formValues.quickRange === '30d' ? 'active' : ''}`}
                onClick={() => handleQuickDate('30d')}
              >
                30 Hari
              </button>
              <button
                type="button"
                className={`admin-quick-date-btn ${formValues.quickRange === '90d' ? 'active' : ''}`}
                onClick={() => handleQuickDate('90d')}
              >
                90 Hari
              </button>
              <button
                type="button"
                className={`admin-quick-date-btn ${formValues.quickRange === 'custom' ? 'active' : ''}`}
                onClick={() => handleQuickDate('custom')}
              >
                Custom
              </button>
            </div>

            <div className="admin-filter-actions">
              <button
                type="button"
                className="button-secondary admin-btn-reset"
                onClick={handleReset}
              >
                <RotateCcw size={15} aria-hidden="true" />
                <span>Reset Filter</span>
              </button>
              <button
                type="submit"
                className="button-primary admin-btn-apply"
              >
                <Search size={15} aria-hidden="true" />
                <span>Terapkan Filter</span>
              </button>
            </div>
          </div>
        </form>
      </section>

      {exportError && (
        <div className="admin-monitor-notice admin-monitor-notice--error" role="alert">
          {exportError}
        </div>
      )}

      {loading || error ? (
        <AdminLoadState error={error} reload={reload} />
      ) : data && (
        <div className={`admin-audit-workspace ${selectedEntry ? 'has-drawer' : ''}`}>
          <div className="admin-audit-table-container">
            <section className="surface-card admin-audit-table-card" aria-label="Tabel Riwayat Aktivitas Audit">
              <div className="admin-table-top-bar">
                <span className="admin-table-total-count">
                  <strong>{numberFormat.format(data.total)}</strong> entri ditemukan
                </span>
                <div className="admin-table-top-actions">
                  <label className="admin-pagesize-label">
                    <span>Tampilkan:</span>
                    <select
                      value={appliedFilters.pageSize}
                      onChange={e => handlePageSizeChange(Number(e.target.value))}
                      aria-label="Pilih jumlah data per halaman"
                    >
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                  </label>
                  <div className="admin-mini-pagination" aria-label="Navigasi cepat halaman">
                    <button
                      type="button"
                      className="admin-mini-page-btn"
                      disabled={data.page <= 1}
                      onClick={() => goToPage(data.page - 1)}
                      aria-label="Halaman sebelumnya"
                    >
                      <ChevronLeft size={15} aria-hidden="true" />
                    </button>
                    <span className="admin-mini-page-num" aria-current="page">{data.page}</span>
                    <button
                      type="button"
                      className="admin-mini-page-btn"
                      disabled={data.page >= pages}
                      onClick={() => goToPage(data.page + 1)}
                      aria-label="Halaman berikutnya"
                    >
                      <ChevronRight size={15} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>

              {data.total === 0 ? (
                <div className="admin-empty-state" role="status">
                  <Info size={32} aria-hidden="true" className="admin-empty-icon" />
                  <h4>{filtered ? 'Tidak ada aktivitas yang cocok dengan filter' : 'Belum ada aktivitas audit yang tercatat'}</h4>
                  <p>{filtered ? 'Coba sesuaikan kata kunci pencarian, rentang tanggal, atau reset filter.' : 'Semua tindakan administrator akan tercatat di sini secara otomatis.'}</p>
                  {filtered && (
                    <button type="button" className="button-secondary" onClick={handleReset}>
                      Reset Filter
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="admin-table-scroll" tabIndex={0} role="region" aria-label="Tabel audit admin">
                    <table className="admin-table admin-audit-table" aria-label="Riwayat tindakan admin">
                      <thead>
                        <tr>
                          <th
                            scope="col"
                            className="col-waktu th-sortable"
                            onClick={toggleSortOrder}
                            title="Klik untuk mengubah urutan waktu"
                            tabIndex={0}
                            role="button"
                            aria-label={`Urutan waktu ${appliedFilters.order === 'desc' ? 'terbaru' : 'terlama'}. Klik untuk membalik urutan.`}
                            onKeyDown={e => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                toggleSortOrder();
                              }
                            }}
                          >
                            <div className="th-sort-inner">
                              <Clock size={14} aria-hidden="true" />
                              <span>Waktu (WIB)</span>
                              <span className="th-sort-badge" aria-hidden="true">
                                {appliedFilters.order === 'asc' ? '↑' : '↓'}
                              </span>
                            </div>
                          </th>
                          <th scope="col" className="col-pelaku"><User size={14} aria-hidden="true" /> Pelaku</th>
                          <th scope="col" className="col-target"><Target size={14} aria-hidden="true" /> Target</th>
                          <th scope="col" className="col-tindakan"><Zap size={14} aria-hidden="true" /> Tindakan</th>
                          <th scope="col" className="col-hasil"><CheckCircle2 size={14} aria-hidden="true" /> Hasil</th>
                          <th scope="col" className="col-aksi">Aksi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.entries.map(entry => {
                          const isSelected = selectedEntry?.id === entry.id;
                          return (
                            <tr
                              key={entry.id}
                              className={`admin-table-row ${isSelected ? 'is-selected' : ''}`}
                              onClick={() => setSelectedEntry(entry)}
                              tabIndex={0}
                              role="button"
                              aria-pressed={isSelected}
                              onKeyDown={e => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setSelectedEntry(entry);
                                }
                              }}
                            >
                              <td className="col-waktu">
                                <time dateTime={entry.occurredAt}>
                                  {adminWibDate.format(new Date(entry.occurredAt))}
                                </time>
                              </td>
                              <td className="col-pelaku">
                                {entry.actorId ? (
                                  <button
                                    type="button"
                                    className="admin-badge-id admin-badge-id--actor admin-badge-id--clickable"
                                    onClick={e => {
                                      e.stopPropagation();
                                      handleFilterActor(entry.actorId!);
                                    }}
                                    title={`Filter riwayat pelaku ${entry.actorId}${entry.actorName ? ` (${entry.actorName})` : ''}`}
                                    aria-label={`Filter riwayat pelaku ${entry.actorId}`}
                                  >
                                    {entry.actorId}
                                  </button>
                                ) : (
                                  <span className="admin-badge-id admin-badge-id--actor">
                                    Skrip penetapan awal
                                  </span>
                                )}
                              </td>
                              <td className="col-target">
                                <button
                                  type="button"
                                  className="admin-badge-id admin-badge-id--target admin-badge-id--clickable"
                                  onClick={e => {
                                    e.stopPropagation();
                                    handleFilterTarget(entry.targetId);
                                  }}
                                  title={`Cari riwayat target ${entry.targetId}${entry.targetName ? ` (${entry.targetName})` : ''}`}
                                  aria-label={`Cari riwayat target ${entry.targetId}`}
                                >
                                  {entry.targetId}
                                </button>
                              </td>
                              <td className="col-tindakan">
                                <span className="admin-action-name">
                                  {actionLabels[entry.action] ?? entry.action}
                                </span>
                              </td>
                              <td className="col-hasil">
                                <AuditStatusPill result={entry.result} />
                              </td>
                              <td className="col-aksi" onClick={e => e.stopPropagation()}>
                                <button
                                  type="button"
                                  className={`admin-row-action-btn ${isSelected ? 'active' : ''}`}
                                  onClick={() => setSelectedEntry(entry)}
                                  aria-label={`Lihat detail aktivitas ${entry.id}`}
                                  title="Lihat detail aktivitas"
                                >
                                  <Eye size={16} aria-hidden="true" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="admin-table-bottom-bar">
                    <div className="admin-table-summary-info">
                      <Info size={15} aria-hidden="true" />
                      <span>
                        Menampilkan <strong>{startRecord}–{endRecord}</strong> dari <strong>{numberFormat.format(data.total)}</strong> data
                      </span>
                    </div>
                    <div className="admin-pagination-controls">
                      <button
                        type="button"
                        className="admin-page-nav-btn"
                        disabled={data.page <= 1}
                        onClick={() => goToPage(data.page - 1)}
                        aria-label="Halaman sebelumnya"
                      >
                        <ChevronLeft size={16} aria-hidden="true" />
                      </button>
                      {Array.from({ length: Math.min(5, pages) }, (_, idx) => {
                        let pageNum = idx + 1;
                        if (pages > 5 && data.page > 3) {
                          pageNum = Math.min(pages - 4 + idx, data.page - 2 + idx);
                        }
                        return (
                          <button
                            key={pageNum}
                            type="button"
                            className={`admin-page-num-btn ${data.page === pageNum ? 'active' : ''}`}
                            onClick={() => goToPage(pageNum)}
                            aria-current={data.page === pageNum ? 'page' : undefined}
                          >
                            {pageNum}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        className="admin-page-nav-btn"
                        disabled={data.page >= pages}
                        onClick={() => goToPage(data.page + 1)}
                        aria-label="Halaman berikutnya"
                      >
                        <ChevronRight size={16} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </section>
          </div>

          {selectedEntry && (
            <AuditDetailDrawer
              entry={selectedEntry}
              onClose={() => setSelectedEntry(null)}
              onFilterActor={handleFilterActor}
              onFilterTarget={handleFilterTarget}
            />
          )}
        </div>
      )}
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

export default function AdminDashboard({ section, onEnterObserverMode }: {
  section: AdminSection;
  onEnterObserverMode?: (session: ObserverSessionData) => void;
}) {
  const { data, loading, error, reload } = useAdminData<{ employeeId: string; permissions: string[] }>('/admin/access');
  return (
    <div className="dashboard-content admin-page">
      <h1>Admin Dashboard</h1>
      {loading || error ? <AdminLoadState error={error} reload={reload} /> : data && <>
        {section === 'overview' && <AdminOverview />}
        {section === 'employees' && <AdminEmployees currentEmployeeId={data.employeeId} />}
        {section === 'requests' && <AdminActivationRequests />}
        {section === 'meetings' && <AdminMeetings />}
        {section === 'live-monitor' && <AdminLiveMeetingMonitor onEnterObserverMode={onEnterObserverMode} />}
        {section === 'recordings' && <AdminRecordings />}
        {section === 'system' && <AdminSystem />}
        {section === 'audit' && <AdminAudit permissions={data.permissions} />}
      </>}
    </div>
  );
}
