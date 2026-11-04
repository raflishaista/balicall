import { VideoTrack } from '@livekit/components-react';
import type { TrackReference } from '@livekit/components-react';
import { useState, useRef, useEffect } from 'react';
import { VideoQuality } from 'livekit-client';
import type { ScreenShareResolution } from './preferences';
import { MonitorUp, Maximize, Minimize, PanelTop, Users, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import type { ReactZoomPanPinchContentRef } from 'react-zoom-pan-pinch';
import { useTrackUnavailable } from './useTrackUnavailable';

function screenShareKey(track: TrackReference) {
  return `${track.participant.identity}:${track.publication.trackSid}`;
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
  const [receiveQuality, setReceiveQuality] = useState<'high' | 'med' | 'low'>('high');
  const [scale, setScale] = useState(1);
  const [prevActiveKey, setPrevActiveKey] = useState(activeKey);
  if (prevActiveKey !== activeKey) {
    setPrevActiveKey(activeKey);
    setScale(1);
  }

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

  return <section className="screen-share-stage" aria-label="Layar yang dibagikan" tabIndex={0} onKeyDown={handleKeyDown}>
    <header className="screen-share-header">
      <span role="status"><MonitorUp size={17} /><strong>{presenter}{active.participant.isLocal ? ' (Kamu)' : ''}</strong> membagikan layar{active.participant.isLocal && onSelectScreenShareResolution && (
        <label className="presentation-resolution-select" title="Resolusi tangkapan layar">
          <select
            aria-label="Pilih resolusi berbagi layar"
            value={screenShareResolution}
            onChange={event => onSelectScreenShareResolution(event.target.value as ScreenShareResolution)}
          >
            <option value="1080p">1080p</option>
            <option value="720p">720p</option>
            <option value="540p">540p</option>
            <option value="360p">360p</option>
            <option value="1440p">1440p</option>
            <option value="original">Asli</option>
          </select>
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
              onChange={event => setReceiveQuality(event.target.value as 'high' | 'med' | 'low')}
            >
              <option value="high">Kualitas: Maksimal</option>
              <option value="med">Kualitas: Sedang</option>
              <option value="low">Kualitas: Rendah</option>
            </select>
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
    <ScreenShareVideo
      key={activeKey}
      track={active}
      presenter={presenter}
      transformRef={transformRef}
      scale={scale}
      receiveQuality={receiveQuality}
      onScaleChange={setScale}
    />
  </section>;
}

function ScreenShareVideo({
  track,
  presenter,
  transformRef,
  scale,
  receiveQuality = 'high',
  onScaleChange,
}: {
  track: TrackReference;
  presenter: string;
  transformRef: React.RefObject<ReactZoomPanPinchContentRef | null>;
  scale: number;
  receiveQuality?: 'high' | 'med' | 'low';
  onScaleChange: (scale: number) => void;
}) {
  const native = track.publication.track?.mediaStreamTrack;
  const [failedTrack, setFailedTrack] = useState<MediaStreamTrack>();
  const [isPanning, setIsPanning] = useState(false);
  const unavailable = useTrackUnavailable(native);

  useEffect(() => {
    if (track.publication && typeof track.publication.setVideoQuality === 'function') {
      try {
        const q = receiveQuality === 'low' ? VideoQuality.LOW : receiveQuality === 'med' ? VideoQuality.MEDIUM : VideoQuality.HIGH;
        track.publication.setVideoQuality(q);
      } catch {}
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
