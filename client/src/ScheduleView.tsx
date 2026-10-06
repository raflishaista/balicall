import { useState, useMemo, useEffect } from 'react';
import {
  Calendar,
  Clock,
  Plus,
  ChevronLeft,
  Check,
  Copy,
  Trash2,
  AlertCircle,
  Users,
  Video,
  Info,
  Sparkles,
} from 'lucide-react';

import {
  pad2,
  formatDateToInput,
  formatTimeToInput,
  slugify,
  DURATION_PRESETS,
  calculateEndTime,
  validateScheduleTime,
} from './scheduleValidation';

export interface ScheduledMeeting {
  id: string;
  roomName: string;
  title: string;
  description?: string;
  hostId: string;
  hostName: string;
  department: string;
  scheduledStart: string;
  scheduledEnd: string;
  status: 'scheduled' | 'cancelled' | 'started';
  createdAt?: string;
}

interface ScheduleViewProps {
  schedules: ScheduledMeeting[];
  employeeId: string;
  employeeName: string;
  department: string;
  onBack: () => void;
  onCreateSchedule: (data: {
    title: string;
    roomName: string;
    description: string;
    hostId: string;
    hostName: string;
    department: string;
    scheduledStart: string;
    scheduledEnd: string;
  }) => Promise<void>;
  onCancelSchedule: (id: string) => Promise<void>;
  onJoinRoom: (roomName: string) => void;
}

export function ScheduleView({
  schedules,
  employeeId,
  employeeName,
  department,
  onBack,
  onCreateSchedule,
  onCancelSchedule,
  onJoinRoom,
}: ScheduleViewProps) {
  // Current time reference
  const now = new Date();
  // Round to next 15-minute slot for pleasant UX
  const defaultStart = new Date(now.getTime() + (15 - (now.getMinutes() % 15 || 15)) * 60000);
  if (defaultStart.getTime() <= now.getTime()) {
    defaultStart.setMinutes(defaultStart.getMinutes() + 15);
  }
  const defaultEnd = new Date(defaultStart.getTime() + 60 * 60000);

  const [date, setDate] = useState(formatDateToInput(defaultStart));
  const [startTime, setStartTime] = useState(formatTimeToInput(defaultStart));
  const [endTime, setEndTime] = useState(formatTimeToInput(defaultEnd));
  const [durationMinutes, setDurationMinutes] = useState(60);

  const [title, setTitle] = useState('');
  const [roomSlug, setRoomSlug] = useState('');
  const [description, setDescription] = useState('');
  const [activeHostId, setActiveHostId] = useState(employeeId || 'BT-10492');
  const [activeHostName, setActiveHostName] = useState(employeeName || 'Rafli Aditya');
  const [activeDept, setActiveDept] = useState(department || 'NOC & Core Network');

  const [filterTab, setFilterTab] = useState<'all' | 'today' | 'upcoming'>('all');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Sync with user's persona if it was updated from outside
  useEffect(() => {
    if (employeeId && !title) {
      setActiveHostId(employeeId);
      setActiveHostName(employeeName);
      setActiveDept(department);
    }
  }, [employeeId, employeeName, department, title]);

  // Minimum allowed date string: YYYY-MM-DD
  const todayDateStr = formatDateToInput(new Date());

  // Check if chosen date is today
  const isSelectedDateToday = date === todayDateStr;

  // Minimum allowed time for today: HH:MM
  const currentHourMinuteStr = formatTimeToInput(new Date());

  // Date and Time Validation Check
  const validation = useMemo(() => {
    return validateScheduleTime(date, startTime, endTime);
  }, [date, startTime, endTime]);

  // When start time or duration preset changes, automatically recalculate end time
  const handleDurationPreset = (minutes: number) => {
    setDurationMinutes(minutes);
    if (!startTime) return;
    setEndTime(calculateEndTime(startTime, minutes));
  };

  const handleStartTimeChange = (newStartTime: string) => {
    setStartTime(newStartTime);
    if (!newStartTime) return;
    setEndTime(calculateEndTime(newStartTime, durationMinutes));
  };

  // Auto-slugify title for roomName recommendation
  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle);
    if (!roomSlug || roomSlug === slugify(title)) {
      const slug = slugify(newTitle);
      setRoomSlug(slug ? `${slug}-${pad2(new Date().getDate())}` : '');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (!title.trim()) {
      setFormError('Judul rapat wajib diisi.');
      return;
    }

    if (!roomSlug.trim()) {
      setFormError('Nama ruang rapat wajib diisi.');
      return;
    }

    if (!validation.valid || !validation.startDateTime || !validation.endDateTime) {
      setFormError(validation.error || 'Periksa kembali tanggal dan waktu rapat.');
      return;
    }

    setIsSubmitting(true);
    try {
      await onCreateSchedule({
        title: title.trim(),
        roomName: slugify(roomSlug.trim()),
        description: description.trim(),
        hostId: activeHostId.trim(),
        hostName: activeHostName.trim(),
        department: activeDept.trim(),
        scheduledStart: validation.startDateTime.toISOString(),
        scheduledEnd: validation.endDateTime.toISOString(),
      });

      setFormSuccess(`Jadwal rapat "${title.trim()}" berhasil dibuat! Ruang: #${slugify(roomSlug.trim())}`);
      setTitle('');
      setRoomSlug('');
      setDescription('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal membuat jadwal rapat. Silakan coba lagi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyToClipboard = (sched: ScheduledMeeting) => {
    const text = `Rapat BaliCall: ${sched.title}\nRuang: #${sched.roomName}\nWaktu: ${new Date(sched.scheduledStart).toLocaleString('id-ID')}\nPenyelenggara: ${sched.hostName} (${sched.department})`;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(sched.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  // Filtered upcoming schedules
  const filteredSchedules = useMemo(() => {
    const today = new Date().toDateString();
    return schedules.filter(s => {
      if (filterTab === 'today') {
        return new Date(s.scheduledStart).toDateString() === today;
      }
      if (filterTab === 'upcoming') {
        return new Date(s.scheduledStart).getTime() > Date.now();
      }
      return true;
    });
  }, [schedules, filterTab]);

  return (
    <div className="schedule-page">
      <div className="schedule-header">
        <button className="back-link" onClick={onBack}>
          <ChevronLeft size={16} /> Kembali ke beranda
        </button>
        <div className="schedule-header-title">
          <span className="page-kicker">KALENDER RAPAT</span>
          <h1>Jadwal Rapat & Reservasi Ruang</h1>
          <p>Atur agenda pertemuan tim Bali Tower, tentukan rentang waktu, dan siapkan ruang kolaborasi.</p>
        </div>
      </div>

      <div className="schedule-grid">
        {/* Kolom Kiri: Form Buat Jadwal */}
        <section className="surface-card schedule-form-card">
          <header className="card-heading">
            <div>
              <span className="section-kicker">BUAT JADWAL BARU</span>
              <h2>Reservasi Ruang Rapat</h2>
            </div>
            <span className="assistant-symbol">
              <Calendar size={20} />
            </span>
          </header>

          <form onSubmit={handleSubmit} className="schedule-form">
            {formError && (
              <div className="form-error" role="alert">
                <AlertCircle size={16} />
                <span>{formError}</span>
              </div>
            )}

            {formSuccess && (
              <div className="form-success" role="status">
                <Check size={16} />
                <span>{formSuccess}</span>
              </div>
            )}

            <label className="form-field">
              Judul / Topik Pertemuan
              <input
                type="text"
                value={title}
                onChange={e => handleTitleChange(e.target.value)}
                placeholder="Contoh: Evaluasi Kinerja Fiber Q4"
                required
              />
            </label>

            <div className="form-grid">
              <label className="form-field">
                Tanggal Rapat
                <input
                  type="date"
                  value={date}
                  min={todayDateStr}
                  onChange={e => setDate(e.target.value)}
                  required
                />
              </label>

              <label className="form-field">
                Nama / Kode Ruang
                <input
                  type="text"
                  value={roomSlug}
                  onChange={e => setRoomSlug(e.target.value)}
                  placeholder="Contoh: evaluasi-fiber-q4"
                  required
                />
              </label>
            </div>

            {/* Time frame selector with validation */}
            <div className="time-frame-box">
              <span className="time-frame-label">
                <Clock size={14} /> Rentang Waktu Rapat
              </span>

              <div className="form-grid">
                <label className="form-field">
                  Waktu Mulai
                  <input
                    type="time"
                    value={startTime}
                    min={isSelectedDateToday ? currentHourMinuteStr : undefined}
                    onChange={e => handleStartTimeChange(e.target.value)}
                    required
                  />
                </label>

                <label className="form-field">
                  Waktu Selesai
                  <input
                    type="time"
                    value={endTime}
                    onChange={e => setEndTime(e.target.value)}
                    required
                  />
                </label>
              </div>

              {/* Durasi preset pills */}
              <div className="duration-preset-pills">
                <span className="preset-label">Durasi Cepat:</span>
                {DURATION_PRESETS.map(preset => (
                  <button
                    key={preset.minutes}
                    type="button"
                    className={`preset-pill ${durationMinutes === preset.minutes ? 'active' : ''}`}
                    onClick={() => handleDurationPreset(preset.minutes)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              {/* Dynamic validation warning */}
              {!validation.valid && (
                <div className="time-validation-alert" role="alert">
                  <AlertCircle size={15} />
                  <span>{validation.error}</span>
                </div>
              )}
            </div>

            {/* Host Information */}
            <div className="form-grid">
              <label className="form-field">
                NIK Penyelenggara
                <input
                  type="text"
                  value={activeHostId}
                  onChange={e => setActiveHostId(e.target.value)}
                  placeholder="BT-10492"
                  required
                />
              </label>

              <label className="form-field">
                Nama Penyelenggara
                <input
                  type="text"
                  value={activeHostName}
                  onChange={e => setActiveHostName(e.target.value)}
                  placeholder="Nama lengkap"
                  required
                />
              </label>
            </div>

            <label className="form-field">
              Departemen
              <select
                value={activeDept}
                onChange={e => setActiveDept(e.target.value)}
                required
              >
                <option>NOC & Core Network</option>
                <option>Field Transmission</option>
                <option>Fiber Infrastructure</option>
                <option>Project Management</option>
                <option>IT Operations</option>
                <option>Tower Maintenance</option>
                <option>Radio Frequency</option>
              </select>
            </label>

            <label className="form-field">
              Agenda / Catatan (Opsional)
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Rangkuman agenda pembahasan atau persiapan peserta..."
                rows={2}
              />
            </label>

            <button
              type="submit"
              className="button-primary full-width schedule-submit"
              disabled={isSubmitting || !validation.valid}
            >
              <Plus size={16} />
              {isSubmitting ? 'Menyimpan Jadwal...' : 'Jadwalkan Rapat Sekarang'}
            </button>
          </form>
        </section>

        {/* Kolom Kanan: Daftar Rapat Terjadwal */}
        <section className="surface-card schedule-list-card">
          <header className="card-heading">
            <div>
              <span className="section-kicker">AGENDA MENDATANG</span>
              <h2>Daftar Rapat Terjadwal ({filteredSchedules.length})</h2>
            </div>
            <div className="schedule-filter-tabs">
              <button
                type="button"
                className={`filter-tab ${filterTab === 'all' ? 'active' : ''}`}
                onClick={() => setFilterTab('all')}
              >
                Semua
              </button>
              <button
                type="button"
                className={`filter-tab ${filterTab === 'today' ? 'active' : ''}`}
                onClick={() => setFilterTab('today')}
              >
                Hari Ini
              </button>
              <button
                type="button"
                className={`filter-tab ${filterTab === 'upcoming' ? 'active' : ''}`}
                onClick={() => setFilterTab('upcoming')}
              >
                Mendatang
              </button>
            </div>
          </header>

          <div className="schedule-items-container">
            {filteredSchedules.length === 0 ? (
              <div className="empty-schedules">
                <div className="empty-meetings-icon">
                  <Calendar size={28} />
                </div>
                <h3>Belum ada jadwal rapat mendatang</h3>
                <p>
                  Gunakan formulir di sebelah kiri untuk menentukan waktu, reservasi ruang, dan menjadwalkan rapat tim.
                </p>
              </div>
            ) : (
              filteredSchedules.map(item => {
                const start = new Date(item.scheduledStart);
                const end = new Date(item.scheduledEnd);
                const isToday = start.toDateString() === new Date().toDateString();
                const isStartingSoon =
                  start.getTime() - Date.now() <= 15 * 60000 &&
                  end.getTime() >= Date.now();

                return (
                  <article key={item.id} className="schedule-card-item">
                    <div className="schedule-card-header">
                      <div className="schedule-time-badge">
                        <Calendar size={13} />
                        <span>
                          {isToday
                            ? 'Hari ini'
                            : start.toLocaleDateString('id-ID', {
                                weekday: 'short',
                                day: 'numeric',
                                month: 'short',
                              })}
                          {', '}
                          {start.toLocaleTimeString('id-ID', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {' - '}
                          {end.toLocaleTimeString('id-ID', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>

                      {isStartingSoon && (
                        <span className="starting-soon-badge">
                          <Sparkles size={12} /> Siap dimulai
                        </span>
                      )}
                    </div>

                    <div className="schedule-card-body">
                      <h3 className="schedule-item-title">{item.title}</h3>
                      <div className="schedule-room-tag">
                        <span>Ruang:</span>
                        <code>#{item.roomName}</code>
                      </div>

                      {item.description && (
                        <p className="schedule-item-desc">{item.description}</p>
                      )}

                      <div className="schedule-host-info">
                        <Users size={13} />
                        <span>
                          {item.hostName} ({item.hostId}) · {item.department}
                        </span>
                      </div>
                    </div>

                    <div className="schedule-card-actions">
                      <button
                        type="button"
                        className="button-primary compact-btn"
                        onClick={() => onJoinRoom(item.roomName)}
                        title="Masuk langsung ke ruang rapat ini"
                      >
                        <Video size={14} />
                        <span>Gabung Sekarang</span>
                      </button>

                      <button
                        type="button"
                        className="button-secondary compact-btn"
                        onClick={() => copyToClipboard(item)}
                        title="Salin rincian rapat"
                      >
                        {copiedId === item.id ? <Check size={14} /> : <Copy size={14} />}
                        <span>{copiedId === item.id ? 'Tersalin' : 'Salin Info'}</span>
                      </button>

                      <button
                        type="button"
                        className="icon-button cancel-schedule-btn"
                        onClick={() => onCancelSchedule(item.id)}
                        title="Batalkan jadwal ini"
                        aria-label="Batalkan jadwal"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>

          <div className="schedule-help-note">
            <Info size={16} />
            <div>
              <strong>Informasi Reservasi Ruang</strong>
              <p>
                Ruang rapat yang dijadwalkan dapat langsung diakses oleh peserta dengan memasukkan kode/nama ruang yang sama di lobi Sentra.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
