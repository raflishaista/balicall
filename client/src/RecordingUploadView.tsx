import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, FileVideo, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react';
import { featureError } from './api';
import {
  MAX_UPLOAD_MB, deleteUpload, formatDuration, formatSize, getUpload, isActive, listUploads,
  resummarizeUpload, statusLabel, SttLabels, getOptions, uploadRecording, type RecordingUpload,
} from './recordingUploads';
import './SummaryHistory.css';
import './RecordingUpload.css';


const POLL_MS = 4000;
const date = (value: string) => new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });

function StatusBadge({ item }: { item: RecordingUpload }) {
  return (
    <span className={`rec-status rec-status-${item.status}`}>
      {isActive(item) && <Loader2 size={11} className="ui-spinner" />}
      {statusLabel(item)}
    </span>
  );
}

function RecordingDetail({ id, llmModels, onBack, onDeleted }: { id: string; llmModels: string[]; onBack: () => void; onDeleted: () => void }) {
  const [upload, setUpload] = useState<RecordingUpload | null>(null);
  const [retryModel, setRetryModel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setUpload((await getUpload(id)).upload); setError(null); }
    catch (e) { setError(featureError('Memuat rekaman', e)); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  const active = upload ? isActive(upload) : false;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [active, load]);

  const retry = async () => {
    setBusy(true);
    try { await resummarizeUpload(id, retryModel || upload?.llmModel || undefined); await load(); }
    catch (e) { setError(featureError('Meringkas ulang', e)); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm('Hapus rekaman ini beserta transkrip dan ringkasannya?')) return;
    setBusy(true);
    try { await deleteUpload(id); onDeleted(); }
    catch (e) { setError(featureError('Menghapus rekaman', e)); setBusy(false); }
  };

  const summary = upload?.summary;
  const transcript = upload?.transcript;

  return (
    <div className="summary-page">
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'center' }}>
        <button className="back-link" onClick={onBack} style={{ margin: 0 }}>
          <ChevronLeft size={16} /> Daftar rekaman
        </button>
      </div>

      {error && <div className="summary-note" role="alert"><AlertCircle size={16} />{error}</div>}
      {!upload && !error && <p><Loader2 className="ui-spinner" size={16} /> Memuat…</p>}

      {upload && (
        <section className="summary-card">
          <header className="summary-heading">
            <div>
              <p className="eyebrow">NOTULEN REKAMAN · {upload.provider || 'AI ASSISTANT'}</p>
              <h1>{summary?.title || upload.title}</h1>
              <p className="summary-meta">
                <StatusBadge item={upload} /> · {upload.originalFilename || 'rekaman.mp4'} · {formatSize(upload.fileSize)} ·
                durasi {formatDuration(upload.durationSeconds)} · diunggah {date(upload.createdAt)}
                {upload.llmModel ? ` · model ${upload.llmModel}` : ''}
                {upload.sttModel ? ` · STT ${SttLabels[upload.sttModel] || upload.sttModel}` : ''}
              </p>
            </div>
            <div className="summary-actions">
              {upload.status === 'failed' && transcript?.text && llmModels.length > 1 && (
                <select aria-label="Model ringkasan" value={retryModel || upload.llmModel || llmModels[0]}
                  onChange={e => setRetryModel(e.target.value)} disabled={busy}>
                  {llmModels.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
              )}
              {upload.status === 'failed' && transcript?.text && (
                <button className="button-primary" onClick={() => void retry()} disabled={busy}>
                  <RefreshCw size={14} /> Ringkas ulang
                </button>
              )}
              {!active && (
                <button className="button-secondary" onClick={() => void remove()} disabled={busy}>
                  <Trash2 size={14} /> Hapus
                </button>
              )}
            </div>
          </header>

          {active && (
            <div className="summary-processing-notice">
              <Loader2 className="ui-spinner" size={22} />
              <div>
                <strong>{statusLabel(upload)}…</strong>
                <p>Halaman ini diperbarui otomatis. Anda boleh meninggalkannya; proses berjalan di server.</p>
              </div>
            </div>
          )}

          {upload.status === 'failed' && (
            <div className="summary-error-notice">
              <AlertCircle size={22} />
              <div>
                <strong>Pemrosesan gagal</strong>
                <p>{upload.error || 'Terjadi kesalahan.'}{transcript?.text ? ' Transkrip sudah tersimpan; coba ringkas ulang.' : ' Unggah ulang rekaman.'}</p>
              </div>
            </div>
          )}

          {summary && (
            <div className="summary-panel">
              <section className="summary-section"><h2>Ringkasan</h2><p>{summary.executiveSummary || 'Belum ada ringkasan.'}</p></section>
              <section className="summary-section"><h2>Pokok pembahasan</h2>
                {summary.keyDiscussionPoints?.length ? <ul className="summary-list">{summary.keyDiscussionPoints.map((p, i) => <li key={i}>{p}</li>)}</ul> : <p>Belum ada pokok pembahasan.</p>}
              </section>
              <section className="summary-section"><h2>Keputusan</h2>
                {summary.decisions?.length ? <ol className="summary-list ordered">{summary.decisions.map((d, i) => <li key={i}>{d}</li>)}</ol> : <p>Belum ada keputusan yang tercatat.</p>}
              </section>
              <section className="summary-section"><h2>Tindak lanjut</h2>
                {summary.actionItems?.length ? (
                  <div className="action-table-wrap">
                    <table className="action-table">
                    <thead><tr><th style={{ width: '40px' }}>No</th><th>Tugas</th><th>PIC / Penanggung jawab</th><th>Prioritas</th><th>Tenggat / Syarat</th></tr></thead>
                    <tbody>{summary.actionItems.map((item, i) => (
                      <tr key={i}><td>{i + 1}</td><td>{item.task}</td><td>{item.assignee || 'Belum ditentukan'}</td>
                        <td><span className={`priority priority-${item.priority.toLowerCase()}`}>{item.priority}</span></td>
                        <td>{item.deadline || 'Belum ditentukan'}</td></tr>
                    ))}</tbody>
                    </table>
                  </div>
                ) : <p>Belum ada tindak lanjut yang tercatat.</p>}
              </section>
            </div>
          )}

          {transcript?.text && (
            <section className="summary-section" style={{ marginTop: '20px' }}>
              <div className="transcript-heading"><div><h2>Transkrip</h2></div></div>
              {transcript.segments?.length ? (
                <div className="recap-transcript-list">
                  {transcript.segments.map((seg, i) => (
                    <article className="recap-transcript-entry diarized" key={i}>
                      <div>
                        <div className="transcript-diarized-row">
                          <span className="transcript-diarized-speaker">{seg.speaker}</span>
                          <span className="segment-time-pill">{seg.start.toFixed(1)}s–{seg.end.toFixed(1)}s</span>
                        </div>
                        <p>{seg.text}</p>
                      </div>
                    </article>
                  ))}
                </div>
              ) : <p style={{ whiteSpace: 'pre-wrap' }}>{transcript.text}</p>}
            </section>
          )}
        </section>
      )}
    </div>
  );
}

export function RecordingUploadView({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<RecordingUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState<'id' | 'en'>('id');
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [llmModels, setLlmModels] = useState<string[]>([]);
  const [llmModel, setLlmModel] = useState('');
  const [sttModels, setSttModels] = useState<string[]>([]);
  const [sttModel, setSttModel] = useState('');

  useEffect(() => {
    getOptions().then(o => {
      setLlmModels(o.llm.models); setLlmModel(o.llm.default);
      setSttModels(o.stt.models); setSttModel(o.stt.default);
    }).catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    try { setItems((await listUploads()).uploads); setListError(null); }
    catch (e) { setListError(featureError('Memuat daftar rekaman', e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  const hasActive = items.some(isActive);
  useEffect(() => {
    if (!hasActive || selectedId) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [hasActive, selectedId, refresh]);

  const pickFile = (picked: File | null) => {
    setFormError(null);
    if (!picked) { setFile(null); return; }
    if (!/\.mp4$/i.test(picked.name)) { setFormError('Hanya file .mp4 yang didukung.'); setFile(null); return; }
    if (picked.size > MAX_UPLOAD_MB * 1024 * 1024) { setFormError(`Ukuran file melebihi ${MAX_UPLOAD_MB} MB.`); setFile(null); return; }
    setFile(picked);
    if (!title.trim()) setTitle(picked.name.replace(/\.mp4$/i, ''));
  };

  const submit = async () => {
    if (!file || uploading) return;
    setUploading(true); setFormError(null);
    try {
      const { upload } = await uploadRecording(file, title.trim(), language, llmModel, sttModel);
      setItems(prev => [upload, ...prev]);
      setFile(null); setTitle('');
      if (fileInput.current) fileInput.current.value = '';
    } catch (e) {
      setFormError(featureError('Mengunggah rekaman', e));
    } finally {
      setUploading(false);
    }
  };

  if (selectedId) {
    return <RecordingDetail id={selectedId} llmModels={llmModels} onBack={() => { setSelectedId(null); void refresh(); }}
      onDeleted={() => { setSelectedId(null); void refresh(); }} />;
  }

  return (
    <div className="history-page">
      <div className="history-header">
        <button type="button" className="back-link" onClick={onBack}>
          <ChevronLeft size={16} /><span>Kembali ke Notulen</span>
        </button>
        <div className="history-title-row">
          <div className="history-title-copy">
            <span className="page-kicker">REKAMAN TERUNGGAH</span>
            <h1>Unggah Rekaman Rapat</h1>
            <p>Unggah rekaman MP4. Sistem membuat transkrip, lalu AI menyusun ringkasan, keputusan, dan tindak lanjut.</p>
          </div>
          <div className="history-header-actions">
            <button type="button" className="button-secondary compact-btn" onClick={() => void refresh()}>
              <RefreshCw size={13} /><span>Perbarui</span>
            </button>
          </div>
        </div>
      </div>

      <section className="surface-card rec-form" aria-label="Unggah rekaman">
        <div className="rec-form-grid">
          <label className="rec-field rec-field-file">
            <span>File rekaman (.mp4, maks {MAX_UPLOAD_MB} MB)</span>
            <input ref={fileInput} type="file" accept=".mp4,video/mp4" disabled={uploading}
              onChange={e => pickFile(e.target.files?.[0] ?? null)} />
          </label>
          <label className="rec-field">
            <span>Judul</span>
            <input type="text" value={title} maxLength={255} disabled={uploading}
              onChange={e => setTitle(e.target.value)} placeholder="Contoh: Rapat mingguan NOC" />
          </label>
          <label className="rec-field">
            <span>Bahasa</span>
            <select value={language} disabled={uploading} onChange={e => setLanguage(e.target.value as 'id' | 'en')}>
              <option value="id">Indonesia</option>
              <option value="en">English</option>
            </select>
          </label>
          {llmModels.length > 1 && (
            <label className="rec-field">
              <span>Model ringkasan</span>
              <select value={llmModel} disabled={uploading} onChange={e => setLlmModel(e.target.value)}>
                {llmModels.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
          )}
          {sttModels.length > 1 && (
            <label className="rec-field">
              <span>Model transkripsi</span>
              <select value={sttModel} disabled={uploading} onChange={e => setSttModel(e.target.value)}>
                {sttModels.map(name => <option key={name} value={name}>{SttLabels[name] || name}</option>)}
              </select>
            </label>
          )}
        </div>
        {file && <p className="rec-file-info"><FileVideo size={14} /> {file.name} · {formatSize(file.size)}</p>}
        {formError && <div className="summary-note" role="alert"><AlertCircle size={16} />{formError}</div>}
        <button type="button" className="button-primary" disabled={!file || uploading} onClick={() => void submit()}>
          {uploading ? <><Loader2 size={14} className="ui-spinner" /> Mengunggah…</> : <><Upload size={14} /> Unggah & proses</>}
        </button>
        {uploading && <p className="rec-hint">Jangan tutup halaman ini sampai unggahan selesai. File besar membutuhkan waktu.</p>}
      </section>

      {listError && <div className="summary-note" role="alert"><AlertCircle size={16} />{listError}</div>}

      <section className="surface-card history-archive-card">
        <header className="card-heading"><div><h2>Daftar Rekaman ({items.length})</h2></div></header>
        {loading ? <p><Loader2 size={14} className="ui-spinner" /> Memuat…</p> : items.length === 0 ? (
          <div className="empty-meetings"><h3>Belum ada rekaman</h3><p>Unggah file MP4 pertama Anda di atas.</p></div>
        ) : (
          <div className="history-cards-grid">
            {items.map(item => (
              <article key={item.id} className="history-card-item" tabIndex={0} role="button"
                onClick={() => setSelectedId(item.id)}
                onKeyDown={e => { if (e.key === 'Enter') setSelectedId(item.id); }}>
                <div className="history-card-top">
                  <StatusBadge item={item} />
                  <span className="rec-date">{date(item.createdAt)}</span>
                </div>
                <div className="history-card-body">
                  <h3 className="schedule-item-title">{item.title}</h3>
                  <p className="history-item-desc">
                    {item.status === 'failed' ? (item.error || 'Gagal diproses.')
                      : `${item.originalFilename || 'rekaman.mp4'} · ${formatSize(item.fileSize)} · durasi ${formatDuration(item.durationSeconds)}`}
                  </p>
                </div>
                <div className="schedule-card-actions">
                  <button type="button" className="button-primary compact-btn"
                    onClick={e => { e.stopPropagation(); setSelectedId(item.id); }}>
                    <span>Buka</span><ChevronRight size={13} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}