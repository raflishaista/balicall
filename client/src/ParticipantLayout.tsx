import { useMeasuredBox } from './useMeetingGeometry';
import type { CSSProperties } from 'react';
import type { Participant } from 'livekit-client';
import { Track } from 'livekit-client';
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react';
import { ParticipantVideoTile } from './ParticipantVideoTile';
import { fitParticipantGrid } from './meetingLayout';

export function ParticipantLayout({ participants, cameras, mirrorLocalVideo, strip = false, spotlightIdentity }: {
  participants: Participant[]; cameras: Map<string, TrackReferenceOrPlaceholder>; mirrorLocalVideo: boolean;
  strip?: boolean; spotlightIdentity?: string;
}) {
  const { ref, width, height } = useMeasuredBox<HTMLDivElement>();
  const layout = fitParticipantGrid(participants.length, width, height);
  const tiles = (items: Participant[]) => items.map(participant => <ParticipantVideoTile key={participant.identity} mirrorLocalVideo={mirrorLocalVideo}
      spotlight={participant.identity === spotlightIdentity}
      trackRef={cameras.get(participant.identity) || { participant, source: Track.Source.Camera }} />);
  return <div ref={ref} className={`participant-grid ${strip ? 'participant-strip' : 'equal-grid'}`}
    role="region" aria-label={strip ? 'Thumbnail peserta' : 'Video peserta rapat'} tabIndex={0}
    data-columns={strip ? undefined : layout.columns}
    style={{ '--tile-width': `${strip ? Math.max(1, Math.min(176, (width - 10 * (participants.length - 1)) / Math.max(1, participants.length))) : layout.tileWidth}px` } as CSSProperties}
    onKeyDown={event => {
      if (!strip || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const node = event.currentTarget;
      if (event.key === 'Home') node.scrollLeft = 0;
      else if (event.key === 'End') node.scrollLeft = node.scrollWidth;
      else node.scrollLeft += event.key === 'ArrowRight' ? 180 : -180;
    }}>
    {strip ? tiles(participants) : Array.from({ length: Math.ceil(participants.length / layout.columns) }, (_, index) => <div className="participant-grid-row" key={index}>{tiles(participants.slice(index * layout.columns, (index + 1) * layout.columns))}</div>)}
  </div>;
}
