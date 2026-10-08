import { useState, useMemo } from 'react';
import {
  FileText,
  Search,
  Clock,
  Check,
  Copy,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Users,
  Building2,
  RefreshCw,
  Database,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ListChecks,
  MessageSquare,
  ShieldCheck,
  Globe,
  X,
  AlertCircle,
} from 'lucide-react';
import './SummaryHistory.css';
import type { SummaryRecord, InProgressRecord } from './summaryHistory';

export interface SummaryHistoryViewProps {
  summaryHistory: SummaryRecord[];
  inProgressList: InProgressRecord[];
  employeeId: string;
  employeeName: string;
  department: string;
  onSelectSummary: (record: SummaryRecord) => void;
  onSelectInProgress: (record: InProgressRecord) => void;
  onBackToHome: () => void;
  onRefreshData?: () => void;
  isLoadingDb?: boolean;
  notice?: string | null;
}

export function SummaryHistoryView({
  summaryHistory,
  inProgressList,
  employeeId,
  employeeName,
  department,
  onSelectSummary,
  onSelectInProgress,
  onBackToHome,
  onRefreshData,
  isLoadingDb = false,
  notice,
}: SummaryHistoryViewProps) {
  const [scope, setScope] = useState<'my' | 'all'>('my');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDept, setSelectedDept] = useState<string>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const cleanEmployeeId = (employeeId || '').trim().toLowerCase();
  const cleanEmployeeName = (employeeName || '').trim().toLowerCase();
  const cleanDepartment = (department || '').trim().toLowerCase();

  const handleCopySummary = (record: SummaryRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    const md = `
# Notulen BaliTower Sentra: ${record.summary.title}
**Ruang:** #${record.roomName} | **Tanggal:** ${new Date(record.savedAt).toLocaleDateString('id-ID')}
**Ringkasan:** ${record.summary.executiveSummary}
    `.trim();

    navigator.clipboard.writeText(md).then(() => {
      setCopiedId(record.meetingId);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const departments = useMemo(() => {
    const set = new Set<string>();
    summaryHistory.forEach(s => {
      if (s.department) set.add(s.department);
    });
    return Array.from(set);
  }, [summaryHistory]);

  const filteredHistory = useMemo(() => {
    return summaryHistory.filter(record => {
      // 1. Scope filter
      if (scope === 'my' && (cleanEmployeeId || cleanEmployeeName || cleanDepartment)) {
        const matchHostId = record.hostId && record.hostId.toLowerCase() === cleanEmployeeId;
        const matchHostName = record.hostName && cleanEmployeeName && record.hostName.toLowerCase().includes(cleanEmployeeName);
        const matchDept = record.department && cleanDepartment && record.department.toLowerCase() === cleanDepartment;
        const matchAttendee = record.summary.attendanceSummary?.some(att => {
          const lower = att.toLowerCase();
          return (cleanEmployeeName && lower.includes(cleanEmployeeName)) ||
                 (cleanEmployeeId && lower.includes(cleanEmployeeId)) ||
                 (cleanDepartment && lower.includes(cleanDepartment));
        });

        // If no credentials or persona set yet, show all so it does not block testing
        const hasIdentity = cleanEmployeeId || cleanEmployeeName || cleanDepartment;
        if (hasIdentity && !matchHostId && !matchHostName && !matchDept && !matchAttendee) {
          return false;
        }
      }

      // 2. Department filter
      if (selectedDept !== 'all' && record.department && record.department !== selectedDept) {
        return false;
      }

      // 3. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchTitle = record.summary.title?.toLowerCase().includes(q);
        const matchRoom = record.roomName?.toLowerCase().includes(q);
        const matchExec = record.summary.executiveSummary?.toLowerCase().includes(q);
        const matchPoints = record.summary.keyDiscussionPoints?.some(p => p.toLowerCase().includes(q));
        const matchDecisions = record.summary.decisions?.some(d => d.toLowerCase().includes(q));
        const matchActions = record.summary.actionItems?.some(a => a.task.toLowerCase().includes(q) || a.assignee.toLowerCase().includes(q));

        if (!matchTitle && !matchRoom && !matchExec && !matchPoints && !matchDecisions && !matchActions) {
          return false;
        }
      }

      return true;
    });
  }, [summaryHistory, scope, selectedDept, searchQuery, cleanEmployeeId, cleanEmployeeName, cleanDepartment]);

  return (
    <div className="history-page">
      {/* Header matching ScheduleView and HomeDashboard */}
      <div className="history-header">
        <button type="button" className="back-link" onClick={onBackToHome}>
          <ChevronLeft size={16} />
          <span>Kembali ke Beranda</span>
        </button>

        <div className="history-title-row">
          <div className="history-title-copy">
            <span className="page-kicker">ARSIP NOTULEN BALITOWER</span>
            <h1>Notulen & Riwayat Rapat</h1>
            <p>
              Akses seluruh ringkasan AI, poin keputusan, daftar tindak lanjut, dan transkrip percakapan rapat tim.
            </p>
          </div>

          {onRefreshData && (
            <div className="history-header-actions">
              <button
                type="button"
                className="button-secondary compact-btn"
                onClick={onRefreshData}
                disabled={isLoadingDb}
                title="Perbarui daftar notulen dari database"
              >
                <RefreshCw size={13} className={isLoadingDb ? 'ui-spinner' : ''} />
                <span>{isLoadingDb ? 'Memperbarui...' : 'Sinkronkan'}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {notice && (
        <div className="history-notice-banner" role="status">
          <AlertCircle size={15} />
          <span>{notice}</span>
        </div>
      )}

      {/* Toolbar Surface Card (Segmented Switch, Search, Callout, Dept Filter) */}
      <section className="surface-card history-toolbar-card" aria-label="Pengaturan cakupan dan pencarian">
        <div className="history-toolbar-main">
          {/* Segmented Switch matching .schedule-filter-tabs and .lobby-switch */}
          <div className="history-scope-switch" role="group" aria-label="Pilih cakupan notulen">
            <button
              type="button"
              className={`history-scope-btn ${scope === 'my' ? 'active' : ''}`}
              onClick={() => setScope('my')}
            >
              <Building2 size={15} />
              <span>Notulen Saya & Divisi</span>
            </button>
            <button
              type="button"
              className={`history-scope-btn ${scope === 'all' ? 'active' : ''}`}
              onClick={() => setScope('all')}
            >
              <Users size={15} />
              <span>Semua Notulen Perusahaan (Universal Demo)</span>
            </button>
          </div>

          {/* Search bar matching .workspace-search */}
          <div className="history-search-wrap">
            <Search size={15} />
            <input
              type="text"
              placeholder="Cari judul, ruang (#room), atau penanggung jawab..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              aria-label="Cari arsip notulen"
            />
            {searchQuery && (
              <button
                type="button"
                className="history-search-clear"
                onClick={() => setSearchQuery('')}
                title="Hapus pencarian"
                aria-label="Hapus pencarian"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Callout box matching .schedule-help-note */}
        <div className="history-scope-callout">
          {scope === 'my' ? <ShieldCheck size={16} /> : <Globe size={16} />}
          <div>
            {scope === 'my' ? (
              <span>
                <strong>Cakupan Terproteksi:</strong> Menampilkan rapat yang Anda hadiri atau relevan dengan divisi Anda{' '}
                <code>{department || 'NOC & Core Network'}</code>.
              </span>
            ) : (
              <span>
                <strong>Mode Demo Universal:</strong> Menampilkan seluruh arsip notulen perusahaan lintas divisi untuk kemudahan evaluasi tanpa memerlukan kredensial seluruh akun karyawan.
              </span>
            )}
          </div>
        </div>

        {/* Department Filter Chips */}
        {departments.length > 1 && (
          <div className="history-dept-chips">
            <span className="history-dept-label">Filter Divisi:</span>
            <button
              type="button"
              className={`filter-tab ${selectedDept === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedDept('all')}
            >
              Semua Divisi ({summaryHistory.length})
            </button>
            {departments.map(dept => (
              <button
                key={dept}
                type="button"
                className={`filter-tab ${selectedDept === dept ? 'active' : ''}`}
                onClick={() => setSelectedDept(dept)}
              >
                {dept}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* In-Progress Section (when AI is compiling summaries) */}
      {inProgressList.length > 0 && (
        <section className="surface-card history-in-progress-card" aria-label="Notulen yang sedang diproses">
          <header className="card-heading">
            <div>
              <div className="ai-processing-pill">
                <Loader2 size={12} className="ui-spinner" />
                <span>SEDANG DIPROSES AI ({inProgressList.length})</span>
              </div>
              <h2 style={{ marginTop: '8px' }}>Notulen Dalam Proses Penyusunan</h2>
              <p className="card-subtext">Panggilan telah diakhiri. AI sedang menganalisis rekaman transkrip menjadi notulen eksekutif.</p>
            </div>
          </header>

          <div className="history-in-progress-grid">
            {inProgressList.map(item => (
              <article
                key={item.meetingId}
                className="in-progress-card-item"
                onClick={() => onSelectInProgress(item)}
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter') onSelectInProgress(item); }}
              >
                <div className="in-progress-card-top">
                  <span className="schedule-room-tag">
                    <code>#{item.roomName}</code>
                  </span>
                  <span className="live-processing-badge">
                    <Loader2 size={11} className="ui-spinner" />
                    <span>Menyusun Ringkasan...</span>
                  </span>
                </div>

                <div className="history-card-body">
                  <h3 className="schedule-item-title" style={{ margin: '4px 0 6px' }}>Ruang Rapat #{item.roomName}</h3>
                  <div className="schedule-host-info">
                    <Clock size={12} />
                    <span>Selesai pada {new Date(item.startedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB</span>
                  </div>
                  <div className="schedule-host-info" style={{ marginTop: '4px' }}>
                    <MessageSquare size={12} />
                    <span>{item.transcripts.length} ucapan terekam</span>
                  </div>
                </div>

                <div className="schedule-card-actions">
                  <button
                    type="button"
                    className="button-primary compact-btn full-width"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectInProgress(item);
                    }}
                  >
                    <span>Pantau Proses & Buka Notulen</span>
                    <ArrowRight size={13} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Completed History Section */}
      <section className="surface-card history-archive-card">
        <header className="card-heading">
          <div>
            <span className="section-kicker">ARSIP RESMI TERVERIFIKASI</span>
            <h2>Daftar Notulen Rapat ({filteredHistory.length})</h2>
          </div>
          <span className="subtle-tag">
            {scope === 'my' ? 'Notulen Terpilih' : 'Semua Notulen'}
          </span>
        </header>

        {filteredHistory.length === 0 ? (
          <div className="empty-meetings">
            <span className="empty-meetings-icon">
              <FileText size={26} />
            </span>
            <h3>{searchQuery ? 'Notulen tidak ditemukan' : 'Belum ada notulen rapat di kategori ini'}</h3>
            <p>
              {searchQuery
                ? 'Tidak ada notulen yang cocok dengan kata kunci pencarian Anda. Coba kata kunci lain atau bersihkan pencarian.'
                : scope === 'my'
                ? 'Belum ada notulen yang tercatat untuk divisi Anda. Coba aktifkan mode "Semua Notulen Perusahaan (Universal Demo)" untuk memeriksa seluruh arsip.'
                : 'Belum ada riwayat notulen rapat yang tersimpan.'}
            </p>
            {scope === 'my' && !searchQuery && (
              <button
                type="button"
                className="text-action"
                onClick={() => setScope('all')}
              >
                Tampilkan Semua Notulen Perusahaan <ArrowRight size={13} />
              </button>
            )}
          </div>
        ) : (
          <div className="history-cards-grid">
            {filteredHistory.map(record => {
              const decisionsCount = record.summary.decisions?.length || 0;
              const actionsCount = record.summary.actionItems?.length || 0;
              const transcriptsCount = record.transcripts?.length || record.summary.transcriptCount || 0;
              const isCopied = copiedId === record.meetingId;

              return (
                <article
                  key={record.meetingId}
                  className="history-card-item"
                  onClick={() => onSelectSummary(record)}
                  tabIndex={0}
                  role="button"
                  onKeyDown={e => { if (e.key === 'Enter') onSelectSummary(record); }}
                >
                  <div className="history-card-top">
                    <div className="history-meta-left">
                      <span className="schedule-room-tag">
                        <code>#{record.roomName}</code>
                      </span>
                      {record.summary.dbSummaryId && (
                        <span className="db-sync-pill" title="Tersimpan di Database PostgreSQL">
                          <Database size={11} />
                          <span>DB #{record.summary.dbSummaryId}</span>
                        </span>
                      )}
                    </div>
                    <div className="schedule-time-badge">
                      <Calendar size={12} />
                      <span>
                        {new Date(record.savedAt).toLocaleDateString('id-ID', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                  </div>

                  <div className="history-card-body">
                    <h3 className="schedule-item-title">{record.summary.title || `Rapat #${record.roomName}`}</h3>
                    <p className="history-item-desc">
                      {record.summary.executiveSummary || 'Ringkasan belum tersedia.'}
                    </p>

                    <div className="history-badges-row">
                      <span className="history-metric-chip" title={`${decisionsCount} Keputusan`}>
                        <CheckCircle2 size={12} />
                        <strong>{decisionsCount}</strong> Keputusan
                      </span>
                      <span className="history-metric-chip" title={`${actionsCount} Tindak Lanjut`}>
                        <ListChecks size={12} />
                        <strong>{actionsCount}</strong> Tindak Lanjut
                      </span>
                      <span className="history-metric-chip" title={`${transcriptsCount} Ucapan`}>
                        <MessageSquare size={12} />
                        <strong>{transcriptsCount}</strong> Ucapan
                      </span>
                      {record.department && (
                        <span className="history-metric-chip dept-chip">
                          <Building2 size={12} />
                          <span>{record.department}</span>
                        </span>
                      )}
                    </div>

                    {record.hostName && (
                      <div className="schedule-host-info">
                        <Users size={12} />
                        <span>
                          {record.hostName} {record.hostId ? `(${record.hostId})` : ''}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="schedule-card-actions">
                    <button
                      type="button"
                      className="button-secondary compact-btn"
                      onClick={e => handleCopySummary(record, e)}
                      title="Salin notulen dalam format Markdown"
                    >
                      {isCopied ? <Check size={13} /> : <Copy size={13} />}
                      <span>{isCopied ? 'Tersalin' : 'Salin Notulen'}</span>
                    </button>
                    <button
                      type="button"
                      className="button-primary compact-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectSummary(record);
                      }}
                      title="Buka detail lengkap notulen rapat"
                    >
                      <span>Buka Notulen</span>
                      <ChevronRight size={13} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
