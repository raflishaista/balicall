import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Play, Pause, Volume2, VolumeX, RotateCcw } from 'lucide-react';
import './SyncedAudioPlayer.css';

export interface SyncedAudioPlayerRef {
  seekTo: (seconds: number, autoPlay?: boolean) => void;
  play: () => void;
  pause: () => void;
  currentTime: number;
}

export interface SyncedAudioPlayerProps {
  src: string;
  duration?: number | null;
  onTimeUpdate?: (currentTime: number) => void;
  autoScroll?: boolean;
  onToggleAutoScroll?: (enabled: boolean) => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export const SyncedAudioPlayer = forwardRef<SyncedAudioPlayerRef, SyncedAudioPlayerProps>(function SyncedAudioPlayer(
  { src, duration: expectedDuration, onTimeUpdate, autoScroll, onToggleAutoScroll },
  ref,
) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(expectedDuration || 0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    seekTo: (seconds: number, autoPlay = true) => {
      if (audioRef.current) {
        audioRef.current.currentTime = Math.max(0, seconds);
        setCurrentTime(audioRef.current.currentTime);
        if (autoPlay) {
          void audioRef.current.play().catch(() => {});
        }
      }
    },
    play: () => {
      void audioRef.current?.play().catch(() => {});
    },
    pause: () => {
      audioRef.current?.pause();
    },
    get currentTime() {
      return audioRef.current?.currentTime || 0;
    },
  }));

  const handleTimeUpdate = useCallback(() => {
    if (!audioRef.current) return;
    const time = audioRef.current.currentTime;
    setCurrentTime(time);
    onTimeUpdate?.(time);
  }, [onTimeUpdate]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      void audioRef.current.play().catch(e => {
        setAudioError('Pemutaran audio gagal dimulai.');
        console.warn('Audio play error:', e);
      });
    }
  };

  const skip = (deltaSeconds: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(0, Math.min(duration || Infinity, audioRef.current.currentTime + deltaSeconds));
  };

  const handleRateChange = () => {
    const rates = [1, 1.25, 1.5, 2];
    const nextIdx = (rates.indexOf(playbackRate) + 1) % rates.length;
    const nextRate = rates[nextIdx];
    setPlaybackRate(nextRate);
    if (audioRef.current) audioRef.current.playbackRate = nextRate;
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setCurrentTime(val);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
    }
    onTimeUpdate?.(val);
  };

  useEffect(() => {
    if (expectedDuration && expectedDuration > 0 && !duration) {
      setDuration(expectedDuration);
    }
  }, [expectedDuration, duration]);

  return (
    <div className="synced-audio-player-card">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={e => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
          setAudioError(null);
        }}
        onError={() => setAudioError('Audio rekaman tidak dapat dimuat atau belum tersedia.')}
        muted={isMuted}
      />

      <div className="synced-player-main">
        <button
          type="button"
          className="synced-player-btn play-btn"
          onClick={togglePlay}
          aria-label={isPlaying ? 'Jeda' : 'Putar'}
          title={isPlaying ? 'Jeda' : 'Putar'}
        >
          {isPlaying ? <Pause size={18} /> : <Play size={18} style={{ marginLeft: 2 }} />}
        </button>

        <button
          type="button"
          className="synced-player-btn skip-btn"
          onClick={() => skip(-5)}
          title="Mundur 5 detik"
          aria-label="Mundur 5 detik"
        >
          <RotateCcw size={15} />
          <span className="skip-label">5s</span>
        </button>

        <div className="synced-player-progress-wrap">
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={currentTime}
            onChange={handleSliderChange}
            className="synced-player-slider"
            aria-label="Waktu audio"
          />
          <div className="synced-player-times">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <button
          type="button"
          className="synced-player-btn speed-btn"
          onClick={handleRateChange}
          title="Kecepatan pemutaran"
        >
          {playbackRate}x
        </button>

        <button
          type="button"
          className="synced-player-btn mute-btn"
          onClick={() => setIsMuted(m => !m)}
          title={isMuted ? 'Batal bisukan' : 'Bisukan'}
          aria-label={isMuted ? 'Batal bisukan' : 'Bisukan'}
        >
          {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>

        {onToggleAutoScroll && (
          <label className="synced-player-autoscroll" title="Otomatis gulir ke ucapan aktif">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={e => onToggleAutoScroll(e.target.checked)}
            />
            <span>Auto-scroll</span>
          </label>
        )}
      </div>

      {audioError && <p className="synced-player-error">{audioError}</p>}
    </div>
  );
});
