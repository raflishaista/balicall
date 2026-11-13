import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, FileVideo, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react';
import { featureError } from './api';
import {
  MAX_UPLOAD_MB, deleteUpload, formatDuration, formatSize, getUpload, isActive, listUploads,
  resummarizeUpload, statusLabel, SttLabels, getOptions,DiarizerLabels, uploadRecording, type RecordingUpload,
} from './recordingUploads';
import './SummaryHistory.css';
import './RecordingUpload.css';


const POLL_MS = 4000;
const date = (value: string) => new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });

function formatTimestamp(seconds: number) {
  if (!Number.isFinite(seconds)) return '00:00';
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function normalizeSpeaker(speaker: string) {
  const match = speaker?.match(/^SPEAKER_(\d+)$/i);
  if (match) return `Pembicara ${parseInt(match[1], 10) + 1}`;
  return speaker || 'Pembicara';
}

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
                <StatusBadge item={upload} /> · {upload.originalFilename || 'Rekaman'} · {formatSize(upload.fileSize)} ·
                durasi {formatDuration(upload.durationSeconds)} · diunggah {date(upload.createdAt)}
                {upload.llmModel ? ` · model ${upload.llmModel}` : ''}
                {transcript?.sttModelUsed ? ` · STT ${SttLabels[transcript.sttModelUsed] || transcript.sttModelUsed}`
                  : transcript?.text ? ' · Model aktual tidak tercatat' : ''}
                {transcript?.diarizerUsed ? ` · ${DiarizerLabels[transcript.diarizerUsed] || transcript.diarizerUsed}` : ''}
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
              {transcript.diarizationStatus === 'unavailable' && (
                <p className="summary-note">Transkrip selesai tanpa label pembicara. Pemisah pembicara gagal menghasilkan label.</p>
              )}
              {transcript.segments?.length ? (
                <div className="recap-transcript-list">
                  {transcript.segments.map((seg, i) => {
                    const speaker = normalizeSpeaker(seg.speaker);
                    return (
                      <article className="recap-transcript-entry diarized" data-speaker={speaker} key={i}>
                        <time>{formatTimestamp(seg.start)}</time>
                        <div>
                          <div className="transcript-diarized-row">
                            <span className="transcript-diarized-speaker" data-speaker={speaker}>{speaker}</span>
                            <span className="segment-time-pill">{seg.start.toFixed(1)}s–{seg.end.toFixed(1)}s</span>
                          </div>
                          <p>{seg.text}</p>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : <p style={{ whiteSpace: 'pre-wrap' }}>{transcript.text}</p>}
            </section>
          )}
        </section>
      )}
    </div>
  );
}

export function RecordingUploadView({ onBack, recordingId: propRecordingId, onRecordingChange }: {
  onBack: () => void;
  recordingId?: string | null;
  onRecordingChange?: (id: string | null) => void;
}) {
  const [items, setItems] = useState<RecordingUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(propRecordingId || null);
  const selectedId = propRecordingId !== undefined ? propRecordingId : localSelectedId;
  const setSelectedId = (id: string | null) => {
    setLocalSelectedId(id);
    onRecordingChange?.(id);
  };

  const [file, setFile] = useState<File | null>(null);
  const [manualTitle, setManualTitle] = useState<string | null>(null);
  const title = manualTitle ?? file?.name.replace(/\.mp[34]$/i, '') ?? '';
  const [language, setLanguage] = useState<'id' | 'en'>('id');
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragDepth = useRef(0);
  const [llmModels, setLlmModels] = useState<string[]>([]);
  const [llmModel, setLlmModel] = useState('');
  const [sttModels, setSttModels] = useState<string[]>([]);
  const [sttModel, setSttModel] = useState('');
  const [diarizersByModel, setDiarizersByModel] = useState<Record<string, string[]>>({});
  const [diarizer, setDiarizer] = useState('');
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const isSea = sttModel === 'sea';
  const uploadLanguage = isSea ? 'id' : language;
  const compatibleDiarizers = diarizersByModel[sttModel] || [];
  const uploadDiarizer = compatibleDiarizers.includes(diarizer) ? diarizer : compatibleDiarizers[0] || '';

  const refreshOptions = useCallback(async () => {
    setLoadingOptions(true);
    setOptionsError(null);
    try {
      const o = await getOptions();
      setLlmModels(o.llm.models); setLlmModel(current => o.llm.models.includes(current) ? current : o.llm.default);
      const byModel = o.diarizer.byModel ?? {};
      const models = o.stt.models.filter(model => byModel[model]?.length);
      setSttModels(models); setSttModel(current => models.includes(current) ? current : o.stt.default);
      setDiarizersByModel(byModel);
      setDiarizer(current => current || o.diarizer.default);
      if (!models.length) setOptionsError('Belum ada model transkripsi yang siap. Coba perbarui.');
    } catch (error) {
      setSttModels([]); setSttModel(''); setDiarizersByModel({});
      setOptionsError(featureError('Memuat pilihan model', error));
    } finally { setLoadingOptions(false); }
  }, []);
  useEffect(() => { void refreshOptions(); }, [refreshOptions]);

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

  const pickFiles = (files: FileList | null) => {
    if (uploading || !files?.length) return;
    setFormError(null);
    if (files.length !== 1) {
      setFormError('Pilih satu file rekaman MP3 atau MP4.');
      setFile(null);
      return;
    }
    const picked = files[0];
    if (!/\.mp[34]$/i.test(picked.name)) { setFormError('Hanya file MP3 dan MP4 yang didukung.'); setFile(null); return; }
    if (picked.size > MAX_UPLOAD_MB * 1024 * 1024) { setFormError(`Ukuran file melebihi ${MAX_UPLOAD_MB} MB.`); setFile(null); return; }
    setFile(picked);
    if (manualTitle !== null && !manualTitle.trim()) setManualTitle(null);
  };

  const submit = async () => {
    if (!file || uploading || loadingOptions || !sttModel || !uploadDiarizer) return;
    setUploading(true); setFormError(null);
    try {
      const { upload } = await uploadRecording(
        file, title.trim(), uploadLanguage, llmModel, sttModel,
        uploadDiarizer,
      );
      setItems(prev => [upload, ...prev]);
      setFile(null); setManualTitle(null);
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
            <p>Unggah rekaman MP3 atau MP4. Sistem membuat transkrip, lalu AI menyusun ringkasan, keputusan, dan tindak lanjut.</p>
          </div>
          <div className="history-header-actions">
            <button type="button" className="button-secondary compact-btn" onClick={() => { void refresh(); void refreshOptions(); }}>
              <RefreshCw size={13} /><span>Perbarui</span>
            </button>
          </div>
        </div>
      </div>

      <section className="surface-card rec-form" aria-label="Unggah rekaman">
        <div className="rec-form-grid">
          <div className="rec-field rec-field-file"
            onDragEnter={event => {
              if (!event.dataTransfer.types.includes('Files')) return;
              event.preventDefault();
              if (uploading) return;
              dragDepth.current += 1;
              setIsDraggingFile(true);
            }}
            onDragOver={event => {
              if (!event.dataTransfer.types.includes('Files')) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = uploading ? 'none' : 'copy';
            }}
            onDragLeave={() => {
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (dragDepth.current === 0) setIsDraggingFile(false);
            }}
            onDrop={event => {
              event.preventDefault();
              dragDepth.current = 0;
              setIsDraggingFile(false);
              pickFiles(event.dataTransfer.files);
            }}
          >
            <span>File rekaman</span>
            <input ref={fileInput} type="file" accept=".mp3,.mp4,audio/mpeg,audio/mp4,video/mp4" disabled={uploading} hidden
              onChange={event => {
                pickFiles(event.currentTarget.files);
                event.currentTarget.value = '';
              }} />
            <button type="button" className={`rec-drop-zone${isDraggingFile ? ' is-dragging' : ''}`}
              aria-label={file ? 'Ganti file rekaman' : 'Pilih file rekaman'}
              aria-describedby="recording-file-limit"
              disabled={uploading} onClick={() => fileInput.current?.click()}>
              <Upload size={20} aria-hidden="true" />
              <strong>{isDraggingFile ? 'Lepas file di sini' : file ? 'Seret file baru ke sini atau klik untuk mengganti' : 'Seret file ke sini atau klik untuk memilih'}</strong>
              <span id="recording-file-limit">MP3 atau MP4 · Maksimal {MAX_UPLOAD_MB} MB</span>
            </button>
            <div aria-live="polite">
              {file && <p className="rec-file-info"><FileVideo size={14} aria-hidden="true" /> <span>{file.name} · {formatSize(file.size)}</span></p>}
            </div>
          </div>
          <label className="rec-field">
            <span>Judul</span>
            <input type="text" value={title} maxLength={255} disabled={uploading}
              onChange={e => setManualTitle(e.target.value)} placeholder="Contoh: Rapat mingguan NOC" />
          </label>
          <label className="rec-field">
            <span>Bahasa</span>
            <select value={uploadLanguage} disabled={uploading || isSea} onChange={e => setLanguage(e.target.value as 'id' | 'en')}>
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
          {sttModels.length > 0 && (
            <label className="rec-field">
              <span>Model transkripsi</span>
              <select value={sttModel} disabled={uploading} onChange={e => setSttModel(e.target.value)}>
                {sttModels.map(name => <option key={name} value={name}>{SttLabels[name] || name}</option>)}
              </select>
            </label>
          )}
          {compatibleDiarizers.length > 0 && (
            <label className="rec-field">
              <span>Pemisah pembicara</span>
              <select value={uploadDiarizer}
                disabled={uploading || compatibleDiarizers.length === 1}
                onChange={e => setDiarizer(e.target.value)}>
                {compatibleDiarizers.map(name => <option key={name} value={name}>{DiarizerLabels[name] || name}</option>)}
              </select>
            </label>
          )}
        </div>
        {formError && <div className="summary-note" role="alert"><AlertCircle size={16} />{formError}</div>}
        {optionsError && <div className="summary-note" role="alert"><AlertCircle size={16} />{optionsError}</div>}
        <button type="button" className="button-primary" disabled={!file || uploading || loadingOptions || !sttModel || !uploadDiarizer} onClick={() => void submit()}>
          {uploading ? <><Loader2 size={14} className="ui-spinner" /> Mengunggah…</> : <><Upload size={14} /> Unggah & proses</>}
        </button>
        {uploading && <p className="rec-hint">Jangan tutup halaman ini sampai unggahan selesai. File besar membutuhkan waktu.</p>}
      </section>

      {listError && <div className="summary-note" role="alert"><AlertCircle size={16} />{listError}</div>}

      <section className="surface-card history-archive-card">
        <header className="card-heading"><div><h2>Daftar Rekaman ({items.length})</h2></div></header>
        {loading ? <p><Loader2 size={14} className="ui-spinner" /> Memuat…</p> : items.length === 0 ? (
          <div className="empty-meetings"><h3>Belum ada rekaman</h3><p>Unggah file MP3 atau MP4 pertama Anda di atas.</p></div>
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
                      : `${item.originalFilename || 'Rekaman'} · ${formatSize(item.fileSize)} · durasi ${formatDuration(item.durationSeconds)}`}
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
