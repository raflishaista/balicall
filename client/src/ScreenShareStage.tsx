import { VideoTrack } from '@livekit/components-react';
import type { TrackReference } from '@livekit/components-react';
import { useState } from 'react';
import { MonitorUp } from 'lucide-react';
import { useTrackUnavailable } from './useTrackUnavailable';

function screenShareKey(track: TrackReference) {
  return `${track.participant.identity}:${track.publication.trackSid}`;
}

export function ScreenShareStage({ tracks }: { tracks: TrackReference[] }) {
  const [selected, setSelected] = useState<string | null>(() => tracks[0] ? screenShareKey(tracks[0]) : null);
  const active = tracks.find(track => screenShareKey(track) === selected) || tracks[0];
  if (!active) return null;
  const presenter = active.participant.name || active.participant.identity;

  return <section className="screen-share-stage" aria-label="Layar yang dibagikan">
    <header className="screen-share-header">
      <span role="status"><MonitorUp size={17} /><strong>{presenter}{active.participant.isLocal ? ' (Kamu)' : ''}</strong> membagikan layar</span>
      {tracks.length > 1 && <label>Presenter<select aria-label="Pilih presenter layar" value={screenShareKey(active)} onChange={event => setSelected(event.target.value)}>
        {tracks.map(track => <option key={screenShareKey(track)} value={screenShareKey(track)}>{track.participant.name || track.participant.identity}{track.participant.isLocal ? ' (Kamu)' : ''}</option>)}
      </select></label>}
    </header>
    <ScreenShareVideo key={screenShareKey(active)} track={active} presenter={presenter} />
  </section>;
}

function ScreenShareVideo({ track, presenter }: { track: TrackReference; presenter: string }) {
  const native = track.publication.track?.mediaStreamTrack;
  const [failedTrack, setFailedTrack] = useState<MediaStreamTrack>();
  const unavailable = useTrackUnavailable(native);
  return <div className="screen-share-content">
    {unavailable ? <p role="status">Menunggu layar presenter tersambung kembali.</p> : failedTrack === native ? <p role="status">Layar belum dapat ditampilkan. Minta presenter membagikan layar kembali.</p> : <VideoTrack trackRef={track} className="screen-share-video" autoPlay playsInline muted aria-label={`Layar ${presenter}`} onError={() => setFailedTrack(native)} />}
  </div>;
}
