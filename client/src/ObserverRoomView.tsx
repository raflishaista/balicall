import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
  useParticipants,
  useTracks,
  VideoTrack,
  isTrackReference,
} from '@livekit/components-react';
import { ConnectionState, Track } from 'livekit-client';
import {
  Activity,
  AlertCircle,
  AudioLines,
  Clock,
  Eye,
  LogOut,
  MicOff,
  Monitor,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { apiRequest } from './api';
import { ParticipantVideoTile } from './ParticipantVideoTile';
import { initials } from './presentation';
import './ObserverRoomView.css';

export interface ObserverSessionData {
  observerId: string;
  meetingId: string;
  roomName: string;
  roomCode?: string;
  hostName?: string;
  token: string;
  serverUrl: string;
  expiresAt: string;
  accessReason?: string;
}

export interface ObserverRoomViewProps {
  session: ObserverSessionData;
  onExit: () => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function ObserverContent({ session, onExit }: { session: ObserverSessionData; onExit: () => void }) {
  const connectionState = useConnectionState();
  const participants = useParticipants();
  const remoteParticipants = useMemo(() => participants.filter(p => !p.isLocal), [participants]);

  const cameraTracks = useTracks([Track.Source.Camera]).filter(t => !t.participant.isLocal);
  const screenTracks = useTracks([Track.Source.ScreenShare]).filter(t => !t.participant.isLocal);

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(() => {
    const ms = new Date(session.expiresAt).getTime() - Date.now();
    return Math.max(0, Math.floor(ms / 1000));
  });
  const [isEnding, setIsEnding] = useState(false);
  const [exitError, setExitError] = useState<string | null>(null);

  const handleExit = useCallback(async () => {
    if (isEnding) return;
    setIsEnding(true);
    setExitError(null);
    try {
      await apiRequest(`/admin/observer/sessions/${encodeURIComponent(session.observerId)}/end`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Observer keluar dari ruang pantau' }),
      });
    } catch (err) {
      console.warn('[OBSERVER] Failed to notify backend session end:', err);
    } finally {
      setIsEnding(false);
      onExit();
    }
  }, [session.observerId, onExit, isEnding]);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
      const remaining = Math.max(0, Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000));
      setRemainingSeconds(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        void handleExit();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [session.expiresAt, handleExit]);

  const isConnected = connectionState === ConnectionState.Connected;
  const isConnecting = connectionState === ConnectionState.Connecting || connectionState === ConnectionState.Reconnecting;

  return (
    <div className="observer-room">
      {/* Top Header */}
      <header className="observer-header" role="banner">
        <div className="observer-header-left">
          <div className="observer-badge-group">
            <span className="observer-badge observer-badge--primary" title="Sesi Pemantau Resmi Super Admin">
              <Eye size={15} aria-hidden="true" />
              <span>SUPER ADMIN OBSERVER</span>
            </span>
            <span className="observer-badge observer-badge--lock" title="Akses Receive-Only">
              <ShieldCheck size={15} aria-hidden="true" />
              <span>HANYA BACA (READ-ONLY)</span>
            </span>
          </div>
          <div className="observer-meeting-meta">
            <h1 className="observer-meeting-title">
              {session.roomName || 'Rapat Tanpa Judul'}
              {session.roomCode && <span className="observer-room-code">#{session.roomCode}</span>}
            </h1>
            <p className="observer-meeting-sub">
              Host: <strong>{session.hostName || '—'}</strong> • ID Rapat: <code>{session.meetingId}</code>
            </p>
          </div>
        </div>

        <div className="observer-header-right">
          <div className="observer-stat-item" title="Durasi Pengamatan Aktif">
            <Clock size={16} aria-hidden="true" />
            <span>Durasi: <strong>{formatDuration(elapsedSeconds)}</strong></span>
          </div>

          <div
            className={`observer-stat-item ${remainingSeconds < 300 ? 'observer-stat-item--warning' : ''}`}
            title="Waktu Sesi Observer Tersisa"
          >
            <ShieldAlert size={16} aria-hidden="true" />
            <span>Kedaluwarsa: <strong>{formatDuration(remainingSeconds)}</strong></span>
          </div>

          <div className="observer-stat-item" title="Kualitas Sambungan Media">
            <Activity size={16} aria-hidden="true" />
            <span className={`status-indicator ${isConnected ? 'status-indicator--green' : 'status-indicator--amber'}`}>
              {isConnected ? 'Koneksi Stabil' : isConnecting ? 'Menghubungkan...' : 'Terputus'}
            </span>
          </div>

          <button
            type="button"
            className="button-secondary observer-exit-btn"
            onClick={handleExit}
            disabled={isEnding}
            aria-label="Keluar dari Mode Pemantau"
          >
            <LogOut size={16} aria-hidden="true" />
            <span>{isEnding ? 'Mengakhiri...' : 'Keluar dari Pemantauan'}</span>
          </button>
        </div>
      </header>

      {/* Compliance Disclosure Alert Banner */}
      <div className="observer-compliance-banner" role="status">
        <ShieldCheck size={18} aria-hidden="true" />
        <div className="observer-compliance-text">
          <strong>Mode Pemantau Kepatuhan Aktif:</strong> Anda memantau sebagai Super Admin terotorisasi.
          Akses mikrofon, kamera, chat, dan kontrol rapat dinonaktifkan di level server & SFU.
          Pemberitahuan pemantauan organisasi telah didisclose ke peserta.
        </div>
      </div>

      {exitError && (
        <div className="observer-error-bar" role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          <span>{exitError}</span>
        </div>
      )}

      {/* Main Content Area */}
      <main className="observer-viewport" id="main-content" tabIndex={-1}>
        {isConnecting && remoteParticipants.length === 0 ? (
          <div className="observer-loading-state" role="status">
            <Activity className="observer-spin" size={32} aria-hidden="true" />
            <p>Menghubungkan ke ruang rapat melalui SFU LiveKit...</p>
          </div>
        ) : screenTracks.length > 0 ? (
          <div className="observer-presentation-layout">
            <section className="observer-screen-stage" aria-label="Tampilan Layar Bersama">
              <div className="observer-stage-header">
                <Monitor size={16} aria-hidden="true" />
                <span>Layar Bersama: <strong>{screenTracks[0].participant.name || screenTracks[0].participant.identity}</strong></span>
              </div>
              <div className="observer-screen-video-wrapper">
                {isTrackReference(screenTracks[0]) && (
                  <VideoTrack trackRef={screenTracks[0]} className="observer-screen-video" autoPlay />
                )}
              </div>
            </section>

            <aside className="observer-strip-sidebar" aria-label="Peserta Rapat">
              <div className="observer-strip-heading">
                <Users size={16} aria-hidden="true" />
                <span>Peserta ({remoteParticipants.length})</span>
              </div>
              <div className="observer-strip-scroll">
                {remoteParticipants.map(participant => {
                  const cameraTrack = cameraTracks.find(t => t.participant.identity === participant.identity);
                  return (
                    <div key={participant.identity} className="observer-strip-card">
                      {cameraTrack ? (
                        <ParticipantVideoTile trackRef={cameraTrack} mirrorLocalVideo={false} />
                      ) : (
                        <div className="observer-participant-card">
                          <span className="observer-avatar">{initials(participant.name || participant.identity)}</span>
                          <span className="observer-participant-name">{participant.name || participant.identity}</span>
                          <span className="observer-mic-icon" title={participant.isMicrophoneEnabled ? 'Mikrofon aktif' : 'Mikrofon mati'}>
                            {participant.isMicrophoneEnabled ? <AudioLines size={14} /> : <MicOff size={14} />}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </aside>
          </div>
        ) : (
          <section className="observer-grid-stage" aria-label="Grid Video Peserta">
            {remoteParticipants.length === 0 ? (
              <div className="observer-empty-state">
                <Users size={48} aria-hidden="true" />
                <h3>Belum ada peserta yang terhubung di ruangan ini</h3>
                <p>Menunggu peserta masuk ke ruang panggilan...</p>
              </div>
            ) : (
              <div className="observer-video-grid" style={{
                gridTemplateColumns: remoteParticipants.length <= 1 ? '1fr' : remoteParticipants.length <= 4 ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(280px, 1fr))'
              }}>
                {remoteParticipants.map(participant => {
                  const cameraTrack = cameraTracks.find(t => t.participant.identity === participant.identity);
                  if (cameraTrack) {
                    return (
                      <div key={participant.identity} className="observer-tile-wrapper">
                        <ParticipantVideoTile trackRef={cameraTrack} mirrorLocalVideo={false} />
                      </div>
                    );
                  }
                  return (
                    <div key={participant.identity} className="observer-audio-tile">
                      <div className="observer-audio-avatar">
                        {initials(participant.name || participant.identity)}
                      </div>
                      <div className="observer-audio-info">
                        <span className="observer-audio-name">{participant.name || participant.identity}</span>
                        <span className="observer-audio-mic">
                          {participant.isMicrophoneEnabled ? (
                            <><AudioLines size={15} className="observer-icon-speaking" /> Bersuara</>
                          ) : (
                            <><MicOff size={15} /> Bisu</>
                          )}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </main>

      {/* Read-Only Status Footer */}
      <footer className="observer-footer">
        <div className="observer-footer-status">
          <ShieldCheck size={14} aria-hidden="true" />
          <span>Pengawasan kepatuhan terverifikasi. Tidak ada data audio atau video lokal yang dikirim ke SFU.</span>
        </div>
        <div className="observer-footer-counts">
          <span>{remoteParticipants.length} Peserta Terhubung</span> • 
          <span>{cameraTracks.length} Kamera Aktif</span>
          {screenTracks.length > 0 && <span> • 1 Berbagi Layar</span>}
        </div>
      </footer>
    </div>
  );
}

export function ObserverRoomView({ session, onExit }: ObserverRoomViewProps) {
  return (
    <LiveKitRoom
      serverUrl={session.serverUrl}
      token={session.token}
      connect={true}
      video={false}
      audio={false}
      className="observer-room-container"
    >
      <RoomAudioRenderer />
      <ObserverContent session={session} onExit={onExit} />
    </LiveKitRoom>
  );
}

export default ObserverRoomView;