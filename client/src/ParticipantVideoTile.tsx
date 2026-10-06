import {
  isTrackReference, ParticipantTile, VideoTrack, useIsMuted, useIsSpeaking,
} from '@livekit/components-react';
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react';
import { useState } from 'react';
import { useTrackUnavailable } from './useTrackUnavailable';
import { Track } from 'livekit-client';
import { AudioLines, Mic, MicOff, VideoOff } from 'lucide-react';
import { initials } from './presentation';

export function ParticipantVideoTile({ trackRef, spotlight = false }: { trackRef: TrackReferenceOrPlaceholder; spotlight?: boolean }) {
  const participant = trackRef.participant;
  const cameraMuted = useIsMuted(trackRef);
  const microphoneMuted = useIsMuted({ participant, source: Track.Source.Microphone });
  const speaking = useIsSpeaking(participant);
  const mediaTrack = isTrackReference(trackRef) ? trackRef.publication.track?.mediaStreamTrack : undefined;
  const [failedTrack, setFailedTrack] = useState<MediaStreamTrack | undefined>();
  const unavailable = useTrackUnavailable(mediaTrack);
  const showVideo = !cameraMuted && !unavailable && failedTrack !== mediaTrack;
  const displayName = participant.name || participant.identity;

  return <ParticipantTile
    role="group"
    trackRef={trackRef}
    className={`participant-tile ${speaking ? 'is-speaking' : ''} ${showVideo ? 'has-video' : ''} ${spotlight ? 'is-spotlight' : ''}`}
    data-spotlight={spotlight ? 'true' : 'false'}
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
      <span role="img" className={microphoneMuted ? 'tile-mic muted' : 'tile-mic'} aria-label={microphoneMuted ? 'Mikrofon mati' : 'Mikrofon aktif'}>
        {microphoneMuted ? <MicOff size={17} /> : speaking ? <AudioLines size={18} /> : <Mic size={17} />}
      </span>
    </div>
    {speaking && <span className="speaker-label"><span />Berbicara</span>}
  </ParticipantTile>;
}
