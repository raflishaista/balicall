import {
  isTrackReference, ParticipantTile, VideoTrack, useIsMuted, useIsSpeaking,
} from '@livekit/components-react';
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { Track } from 'livekit-client';
import { AudioLines, Mic, MicOff, VideoOff } from 'lucide-react';
import { initials } from './presentation';

export function ParticipantVideoTile({ trackRef }: { trackRef: TrackReferenceOrPlaceholder }) {
  const participant = trackRef.participant;
  const cameraMuted = useIsMuted(trackRef);
  const microphoneMuted = useIsMuted({ participant, source: Track.Source.Microphone });
  const speaking = useIsSpeaking(participant);
  const mediaTrack = isTrackReference(trackRef) ? trackRef.publication.track?.mediaStreamTrack : undefined;
  const [failedTrack, setFailedTrack] = useState<MediaStreamTrack | undefined>();
  const subscribeToTrack = useCallback((listener: () => void) => {
    mediaTrack?.addEventListener('ended', listener);
    mediaTrack?.addEventListener('mute', listener);
    mediaTrack?.addEventListener('unmute', listener);
    return () => {
      mediaTrack?.removeEventListener('ended', listener);
      mediaTrack?.removeEventListener('mute', listener);
      mediaTrack?.removeEventListener('unmute', listener);
    };
  }, [mediaTrack]);
  const unavailable = useSyncExternalStore(subscribeToTrack, () => !mediaTrack || mediaTrack.readyState === 'ended' || mediaTrack.muted, () => true);
  const showVideo = !cameraMuted && !unavailable && failedTrack !== mediaTrack;
  const displayName = participant.name || participant.identity;

  return <ParticipantTile
    trackRef={trackRef}
    className={`participant-tile ${speaking ? 'is-speaking' : ''} ${showVideo ? 'has-video' : ''}`}
    aria-label={`${displayName}${participant.isLocal ? ' (Kamu)' : ''}`}
  >
    {showVideo && isTrackReference(trackRef) ? <VideoTrack
      trackRef={trackRef}
      className={`participant-video ${participant.isLocal ? 'is-local-video' : ''}`}
      autoPlay playsInline muted
      aria-label={`Video kamera ${displayName}`}
      onError={() => setFailedTrack(mediaTrack)}
    /> : <>
      <span className={`participant-avatar ${participant.isLocal ? 'is-local' : ''}`}>{initials(displayName)}</span>
      <span className="camera-placeholder"><VideoOff size={13} />{cameraMuted ? 'Kamera mati' : 'Video tidak tersedia'}</span>
    </>}
    <div className="participant-tile-footer">
      <span>{displayName}{participant.isLocal && <small> (Kamu)</small>}</span>
      <span className={microphoneMuted ? 'tile-mic muted' : 'tile-mic'} aria-label={microphoneMuted ? 'Mikrofon mati' : 'Mikrofon aktif'}>
        {microphoneMuted ? <MicOff size={17} /> : speaking ? <AudioLines size={18} /> : <Mic size={17} />}
      </span>
    </div>
    {speaking && <span className="speaker-label"><span />Berbicara</span>}
  </ParticipantTile>;
}
