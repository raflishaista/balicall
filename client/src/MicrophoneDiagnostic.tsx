import { useEffect, useState } from 'react';
import { Volume2 } from 'lucide-react';

export function MicrophoneDiagnostic({ stream, pending, error, blocked, onStart, onStop }: {
  stream: MediaStream | null; pending: boolean; error: string | null; blocked: boolean;
  onStart: () => void; onStop: () => void;
}) {
  const [volume, setVolume] = useState(0);
  const [meterError, setMeterError] = useState<string | null>(null);
  useEffect(() => {
    if (!stream) return;
    let context: AudioContext | undefined, frame = 0, disposed = false;
    try {
      context = new AudioContext();
      const source = context.createMediaStreamSource(stream), analyser = context.createAnalyser();
      analyser.fftSize = 256; source.connect(analyser);
      const samples = new Uint8Array(analyser.frequencyBinCount);
      let last = 0;
      const measure = (time: number) => {
        if (time - last > 80) {
          analyser.getByteFrequencyData(samples);
          const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
          setVolume(Math.min(100, Math.round(average / 128 * 100))); last = time;
        }
        frame = requestAnimationFrame(measure);
      };
      frame = requestAnimationFrame(measure);
      void context.resume().catch(() => { if (!disposed) setMeterError('Indikator suara belum aktif. Hentikan lalu uji kembali.'); });
    } catch { queueMicrotask(() => { if (!disposed) setMeterError('Indikator suara belum tersedia di browser ini.'); }); }
    return () => { disposed = true; cancelAnimationFrame(frame); if (context) void context.close().catch(() => {}); };
  }, [stream]);
  return <div className="microphone-check">
    <div className="microphone-check-heading"><span><Volume2 size={17} />Periksa mikrofon</span><button type="button" disabled={blocked} onClick={stream || pending ? onStop : onStart}>{pending ? 'Batalkan uji' : stream ? 'Hentikan uji' : 'Uji suara'}</button></div>
    {(error || (stream && meterError)) && <p className="microphone-error" role="alert">{error || meterError}</p>}
    <div className="microphone-volume" role="meter" aria-label="Level mikrofon" aria-valuemin={0} aria-valuemax={100} aria-valuenow={stream ? volume : 0}><span style={{ width: (stream ? volume : 0) + '%' }} /></div>
    <div className={`diagnostic-wave ${stream && volume > 5 ? 'voice-active' : ''}`} aria-hidden="true">{[7, 12, 19, 10, 23, 15, 20, 9, 17, 12, 22, 8, 16, 11].map((height, index) => <i key={index} style={{ height: stream && volume > 5 ? Math.max(3, Math.round(height * Math.min(1, volume / 30))) : 3, animationDelay: index * .05 + 's' }} />)}</div>
    <p>{pending ? 'Menunggu izin mikrofon dari browser…' : stream ? volume > 10 ? 'Suaramu terdeteksi. Mikrofon siap digunakan.' : 'Coba berbicara dan perhatikan indikator suara.' : 'Uji input suara sebelum bergabung ke rapat.'}</p>
    {stream && <small>{stream.getAudioTracks()[0]?.label || 'Mikrofon pilihan'} · {volume}%</small>}
  </div>;
}
