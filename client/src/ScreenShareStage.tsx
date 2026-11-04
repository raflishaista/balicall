import { VideoTrack } from '@livekit/components-react';
import type { TrackReference } from '@livekit/components-react';
import { useState, useRef, useEffect, useCallback } from 'react';
import { VideoQuality } from 'livekit-client';
import type { ScreenShareResolution } from './preferences';
import { MonitorUp, Maximize, Minimize, PanelTop, Users, ZoomIn, ZoomOut, RotateCcw, Check } from 'lucide-react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import type { ReactZoomPanPinchContentRef } from 'react-zoom-pan-pinch';
import { useTrackUnavailable } from './useTrackUnavailable';

export type ReceiveQuality = '1080p' | '720p' | '540p' | '360p' | 'auto' | 'high' | 'med' | 'low';

function screenShareKey(track: TrackReference) {
  return `${track.participant.identity}:${track.publication.trackSid}`;
}

export function getQualityLabel(q: string): string {
  switch (q) {
    case '1080p':
    case 'high':
      return '1080p';
    case '720p':
    case 'med':
      return '720p';
    case '540p':
      return '540p';
    case '360p':
    case 'low':
      return '360p';
    case '1440p':
      return '1440p';
    case 'original':
      return 'Asli';
    case 'auto':
      return 'Otomatis';
    default:
      return q;
  }
}

export function ScreenShareStage({
  tracks, focused, showThumbnails, fullscreen, fullscreenPending, fullscreenSupported,
  screenShareResolution = '1080p', onSelectScreenShareResolution,
  onFocus, onThumbnails, onFullscreen,
}: {
  tracks: TrackReference[];
  focused: boolean; showThumbnails: boolean; fullscreen: boolean;
  fullscreenPending: boolean; fullscreenSupported: boolean;
  screenShareResolution?: ScreenShareResolution;
  onSelectScreenShareResolution?: (res: ScreenShareResolution) => void;
  onFocus: () => void; onThumbnails: () => void; onFullscreen: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(() => tracks[0] ? screenShareKey(tracks[0]) : null);
  const active = tracks.find(track => screenShareKey(track) === selected) || tracks[0];
  const activeKey = active ? screenShareKey(active) : null;

  const transformRef = useRef<ReactZoomPanPinchContentRef | null>(null);
  const [receiveQuality, setReceiveQuality] = useState<ReceiveQuality>('1080p');
  const [qualityApplying, setQualityApplying] = useState(false);
  const [qualityApplied, setQualityApplied] = useState(false);
  const [appliedLabel, setAppliedLabel] = useState('');
  const applyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [scale, setScale] = useState(1);
  const [prevActiveKey, setPrevActiveKey] = useState(activeKey);
  if (prevActiveKey !== activeKey) {
    setPrevActiveKey(activeKey);
    setScale(1);
  }

  const triggerQualityFeedback = useCallback((target: string) => {
    if (applyTimer.current) clearTimeout(applyTimer.current);
    if (finishTimer.current) clearTimeout(finishTimer.current);

    setQualityApplying(true);
    setQualityApplied(false);
    setAppliedLabel(getQualityLabel(target));

    // Display circular loading progress, then sign completion after transition
    applyTimer.current = setTimeout(() => {
      setQualityApplying(false);
      setQualityApplied(true);

      finishTimer.current = setTimeout(() => {
        setQualityApplied(false);
      }, 1800);
    }, 700);
  }, []);

  const finishQualityEarly = useCallback(() => {
    if (applyTimer.current) {
      clearTimeout(applyTimer.current);
      applyTimer.current = null;
      setQualityApplying(false);
      setQualityApplied(true);
      if (finishTimer.current) clearTimeout(finishTimer.current);
      finishTimer.current = setTimeout(() => {
        setQualityApplied(false);
      }, 1800);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (applyTimer.current) clearTimeout(applyTimer.current);
      if (finishTimer.current) clearTimeout(finishTimer.current);
    };
  }, []);

  if (!active) return null;
  const presenter = active.participant.name || active.participant.identity;
  const isZoomed = scale > 1.01;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      transformRef.current?.zoomIn(0.25);
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      transformRef.current?.zoomOut(0.25);
    } else if (e.key === '0') {
      e.preventDefault();
      transformRef.current?.resetTransform();
    }
  };

  const handleViewerQualityChange = (q: ReceiveQuality) => {
    setReceiveQuality(q);
    triggerQualityFeedback(q);
  };

  const handlePresenterResolutionChange = (res: ScreenShareResolution) => {
    onSelectScreenShareResolution?.(res);
    triggerQualityFeedback(res);
  };

  return <section className="screen-share-stage" aria-label="Layar yang dibagikan" tabIndex={0} onKeyDown={handleKeyDown}>
    <header className="screen-share-header">
      <span role="status"><MonitorUp size={17} /><strong>{presenter}{active.participant.isLocal ? ' (Kamu)' : ''}</strong> membagikan layar{active.participant.isLocal && onSelectScreenShareResolution && (
        <label className="presentation-resolution-select" title="Resolusi tangkapan layar">
          <select
            aria-label="Pilih resolusi berbagi layar"
            value={screenShareResolution}
            disabled={qualityApplying}
            onChange={event => handlePresenterResolutionChange(event.target.value as ScreenShareResolution)}
          >
            <option value="1080p">1080p</option>
            <option value="720p">720p</option>
            <option value="540p">540p</option>
            <option value="360p">360p</option>
            <option value="1440p">1440p</option>
            <option value="original">Asli</option>
          </select>
          {qualityApplying && (
            <span className="circular-spinner-inline" title="Menerapkan resolusi..." aria-hidden="true">
              <svg className="circular-progress-svg" viewBox="0 0 36 36" width="14" height="14">
                <circle className="circular-progress-bg" cx="18" cy="18" r="14" fill="none" strokeWidth="4" />
                <circle className="circular-progress-meter" cx="18" cy="18" r="14" fill="none" strokeWidth="4" strokeDasharray="65 100" strokeLinecap="round" />
              </svg>
            </span>
          )}
        </label>
      )}</span>
      {tracks.length > 1 && <label>Presenter<select aria-label="Pilih presenter layar" value={screenShareKey(active)} onChange={event => setSelected(event.target.value)}>
        {tracks.map(track => <option key={screenShareKey(track)} value={screenShareKey(track)}>{track.participant.name || track.participant.identity}{track.participant.isLocal ? ' (Kamu)' : ''}</option>)}
      </select></label>}
      <div className="presentation-actions" role="group" aria-label="Tampilan presentasi">
        {!active.participant.isLocal && (
          <label className="presentation-resolution-select" title="Pilih kualitas penerimaan video">
            <select
              aria-label="Pilih kualitas penerimaan video"
              value={receiveQuality}
              disabled={qualityApplying}
              onChange={event => handleViewerQualityChange(event.target.value as ReceiveQuality)}
            >
              <option value="1080p">1080p (Maksimal)</option>
              <option value="720p">720p (HD)</option>
              <option value="540p">540p (Standar)</option>
              <option value="360p">360p (Hemat Kuota)</option>
              <option value="auto">Otomatis</option>
            </select>
            {qualityApplying && (
              <span className="circular-spinner-inline" title="Menerapkan resolusi..." aria-hidden="true">
                <svg className="circular-progress-svg" viewBox="0 0 36 36" width="14" height="14">
                  <circle className="circular-progress-bg" cx="18" cy="18" r="14" fill="none" strokeWidth="4" />
                  <circle className="circular-progress-meter" cx="18" cy="18" r="14" fill="none" strokeWidth="4" strokeDasharray="65 100" strokeLinecap="round" />
                </svg>
              </span>
            )}
          </label>
        )}
        {isZoomed ? (
          <button
            type="button"
            className="presentation-fit-btn is-zoomed"
            onClick={() => transformRef.current?.resetTransform()}
            title="Klik untuk reset zoom ke Fit (100%)"
            aria-label={`Ukuran ${Math.round(scale * 100)}%, klik untuk reset ke Fit`}
          >
            <RotateCcw size={13} />
            <span>Fit ({Math.round(scale * 100)}%)</span>
          </button>
        ) : (
          <span className="presentation-fit" title="Seluruh isi layar ditampilkan tanpa dipotong. Gunakan scroll atau cubit untuk zoom.">Fit</span>
        )}
        <button type="button" aria-pressed={focused} onClick={onFocus}><PanelTop size={16}/>{focused ? 'Keluar Fokus' : 'Fokus Presentasi'}</button>
        <button type="button" aria-pressed={showThumbnails} onClick={onThumbnails}><Users size={16}/>{showThumbnails ? 'Sembunyikan kamera' : 'Tampilkan kamera'}</button>
        <button type="button" aria-pressed={fullscreen} aria-busy={fullscreenPending} disabled={fullscreenPending || !fullscreenSupported} onClick={onFullscreen} title={fullscreenSupported ? 'Esc untuk keluar Full Screen' : 'Gunakan Fokus Presentasi pada browser ini'}>
          {fullscreen ? <Minimize size={16}/> : <Maximize size={16}/>}<span>{fullscreen ? 'Keluar Full Screen' : 'Full Screen'}</span>
        </button>
      </div>
    </header>

    {(qualityApplying || qualityApplied) && (
      <div
        className={`screen-share-resolution-pill ${qualityApplying ? 'is-loading' : 'is-finished'}`}
        role="status"
        aria-live="polite"
      >
        {qualityApplying ? (
          <>
            <svg className="circular-progress-svg" viewBox="0 0 36 36" width="20" height="20" aria-hidden="true">
              <circle className="circular-progress-bg" cx="18" cy="18" r="14" fill="none" strokeWidth="3.5" />
              <circle className="circular-progress-meter" cx="18" cy="18" r="14" fill="none" strokeWidth="3.5" strokeDasharray="60 100" strokeLinecap="round" />
            </svg>
            <span className="resolution-pill-text">Menerapkan resolusi {appliedLabel}...</span>
          </>
        ) : (
          <>
            <span className="circular-finish-icon" aria-hidden="true">
              <Check size={14} />
            </span>
            <span className="resolution-pill-text">Resolusi {appliedLabel} diterapkan</span>
          </>
        )}
      </div>
    )}

    <ScreenShareVideo
      key={activeKey}
      track={active}
      presenter={presenter}
      transformRef={transformRef}
      scale={scale}
      receiveQuality={receiveQuality}
      onScaleChange={setScale}
      onVideoResized={finishQualityEarly}
    />
  </section>;
}

function ScreenShareVideo({
  track,
  presenter,
  transformRef,
  scale,
  receiveQuality = '1080p',
  onScaleChange,
  onVideoResized,
}: {
  track: TrackReference;
  presenter: string;
  transformRef: React.RefObject<ReactZoomPanPinchContentRef | null>;
  scale: number;
  receiveQuality?: ReceiveQuality;
  onScaleChange: (scale: number) => void;
  onVideoResized?: () => void;
}) {
  const native = track.publication.track?.mediaStreamTrack;
  const [failedTrack, setFailedTrack] = useState<MediaStreamTrack>();
  const [isPanning, setIsPanning] = useState(false);
  const unavailable = useTrackUnavailable(native);

  useEffect(() => {
    const pub = track.publication as any;
    if (!pub) return;
    try {
      if (receiveQuality === 'low' || receiveQuality === '360p') {
        if (typeof pub.setVideoQuality === 'function') {
          pub.setVideoQuality(VideoQuality.LOW);
        }
        if (typeof pub.setVideoDimensions === 'function') {
          pub.setVideoDimensions({ width: 640, height: 360 });
        }
      } else if (receiveQuality === '540p') {
        if (typeof pub.setVideoQuality === 'function') {
          pub.setVideoQuality(VideoQuality.MEDIUM);
        }
        if (typeof pub.setVideoDimensions === 'function') {
          pub.setVideoDimensions({ width: 960, height: 540 });
        }
      } else if (receiveQuality === 'med' || receiveQuality === '720p') {
        if (typeof pub.setVideoQuality === 'function') {
          pub.setVideoQuality(VideoQuality.MEDIUM);
        }
        if (typeof pub.setVideoDimensions === 'function') {
          pub.setVideoDimensions({ width: 1280, height: 720 });
        }
      } else if (receiveQuality === 'high' || receiveQuality === '1080p') {
        if (typeof pub.setVideoQuality === 'function') {
          pub.setVideoQuality(VideoQuality.HIGH);
        }
        if (typeof pub.setVideoDimensions === 'function') {
          pub.setVideoDimensions({ width: 1920, height: 1080 });
        }
      } else if (receiveQuality === 'auto') {
        if (typeof pub.setVideoQuality === 'function') {
          pub.setVideoQuality(VideoQuality.HIGH);
        }
      }
    } catch {
      // Ignore if publication methods are unavailable
    }
  }, [track.publication, receiveQuality]);

  if (unavailable) {
    return <div className="screen-share-content">
      <p role="status">Menunggu layar presenter tersambung kembali.</p>
    </div>;
  }

  if (failedTrack === native) {
    return <div className="screen-share-content">
      <p role="status">Layar belum dapat ditampilkan. Minta presenter membagikan layar kembali.</p>
    </div>;
  }

  const isZoomed = scale > 1.01;
  const percentage = Math.round(scale * 100);

  return <div className={`screen-share-content ${isZoomed ? 'is-zoomed' : ''} ${isPanning ? 'is-panning' : ''}`}>
    <TransformWrapper
      ref={transformRef}
      initialScale={1}
      minScale={1}
      maxScale={5}
      centerOnInit
      limitToBounds
      doubleClick={{ mode: 'toggle', step: 1.0 }}
      wheel={{ step: 0.15 }}
      panning={{ disabled: !isZoomed, velocityDisabled: false }}
      onInit={(ref: any) => onScaleChange(ref.state.scale)}
      onTransform={(_ref: any, state: any) => onScaleChange(state.scale)}
      onPanningStart={() => setIsPanning(true)}
      onPanningStop={() => setIsPanning(false)}
    >
      <TransformComponent
        wrapperClass="screen-share-transform-wrapper"
        contentClass="screen-share-transform-content"
      >
        <VideoTrack
          trackRef={track}
          className="screen-share-video"
          autoPlay
          playsInline
          muted
          aria-label={`Layar ${presenter}`}
          onResize={() => onVideoResized?.()}
          onError={() => setFailedTrack(native)}
        />
      </TransformComponent>
    </TransformWrapper>

    <div className="screen-share-zoom-bar" role="toolbar" aria-label="Kontrol perbesaran layar">
      <button
        type="button"
        className="screen-share-zoom-btn"
        onClick={() => transformRef.current?.zoomOut(0.25)}
        disabled={!isZoomed}
        title="Perkecil layar (-)"
        aria-label="Perkecil layar"
      >
        <ZoomOut size={15} />
      </button>
      <button
        type="button"
        className="screen-share-zoom-badge"
        onClick={() => transformRef.current?.resetTransform()}
        title="Klik untuk reset ke ukuran normal (100%)"
        aria-label={`Ukuran ${percentage}%, klik untuk reset`}
      >
        <span>{percentage}%</span>
        {isZoomed && <RotateCcw size={12} className="reset-icon" />}
      </button>
      <button
        type="button"
        className="screen-share-zoom-btn"
        onClick={() => transformRef.current?.zoomIn(0.25)}
        disabled={scale >= 5}
        title="Perbesar layar (+)"
        aria-label="Perbesar layar"
      >
        <ZoomIn size={15} />
      </button>
    </div>
  </div>;
}
