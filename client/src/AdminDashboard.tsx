import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CalendarDays, HardDrive, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { ApiError, apiRequest } from './api';
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
};
const actionLabels: Record<string, string> = {
  'admin.bootstrap': 'Tetapkan Super Admin pertama',
  'admin.grant': 'Beri akses Super Admin',
  'admin.revoke': 'Cabut akses Super Admin',
  'account.status.change': 'Ubah status akun',
  'account.invite': 'Buat undangan aktivasi',
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
  uploadedBytes: string;
}

function AdminOverview() {
  const [days, setDays] = useState('30');
  const { data, loading, error, reload } = useAdminData<OverviewData>(`/admin/overview?days=${days}`);
  const cards = data ? [
    { label: 'Total karyawan', value: numberFormat.format(data.totalEmployees), icon: Users },
    { label: 'Akun sudah diaktivasi', value: numberFormat.format(data.activatedAccounts), icon: ShieldCheck },
    { label: 'Rapat dalam periode', value: numberFormat.format(data.totalMeetings), icon: CalendarDays },
    { label: 'Ukuran file unggahan', value: formatUploadedBytes(data.uploadedBytes), icon: HardDrive },
  ] : [];
  return (
    <section className="admin-section" aria-labelledby="admin-overview-heading">
      <div className="admin-section-heading">
        <h2 id="admin-overview-heading">Overview</h2>
        <label className="admin-field">Periode rapat
          <select value={days} onChange={event => setDays(event.target.value)}>
            {[7, 30, 90].map(value => <option key={value} value={value}>{value} hari terakhir</option>)}
          </select>
        </label>
      </div>
      {loading || error ? <AdminLoadState error={error} reload={reload} /> :
        <dl className="admin-kpis">
          {cards.map(({ label, value, icon: Icon }) => (
            <div className="surface-card admin-kpi" key={label}>
              <Icon size={20} aria-hidden="true" />
              <div><dt>{label}</dt><dd>{value}</dd></div>
            </div>
          ))}
        </dl>}
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

function AdminSystem() {
  const { data, loading, error, reload } = useAdminData<{ services: MonitoredService[]; checkedAt: string }>('/admin/system');
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

export default function AdminDashboard({ section }: { section: AdminSection }) {
  const { data, loading, error, reload } = useAdminData<{ employeeId: string; permissions: string[] }>('/admin/access');
  return (
    <div className="dashboard-content admin-page">
      <h1>Admin Dashboard</h1>
      {loading || error ? <AdminLoadState error={error} reload={reload} /> : data && <>
        {section === 'overview' && <AdminOverview />}
        {section === 'employees' && <AdminEmployees currentEmployeeId={data.employeeId} />}
        {section === 'meetings' && <AdminMeetings />}
        {section === 'system' && <AdminSystem />}
        {section === 'audit' && <AdminAudit permissions={data.permissions} />}
      </>}
    </div>
  );
}
