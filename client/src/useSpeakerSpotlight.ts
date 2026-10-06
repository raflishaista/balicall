import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { RoomEvent, Track } from 'livekit-client';
import type { Room } from 'livekit-client';
import { createSpeakerSpotlight } from './speakerSpotlight';

export function useSpeakerSpotlight(room: Room, connected: boolean) {
  const selection = useMemo(() => createSpeakerSpotlight([room.localParticipant.identity, ...room.remoteParticipants.keys()]), [room]);
  const spotlight = useSyncExternalStore(selection.subscribe, selection.getSnapshot, () => null);

  useEffect(() => {
    const speakersChanged = () => {
      const speakers = room.activeSpeakers.filter(participant => !participant.getTrackPublication(Track.Source.Microphone)?.isMuted);
      selection.updateSpeakers(speakers.map(participant => participant.identity));
    };
    const rosterChanged = () => {
      selection.updateParticipants([room.localParticipant.identity, ...room.remoteParticipants.keys()]);
      speakersChanged();
    };
    selection.setConnected(connected);
    room.on(RoomEvent.ActiveSpeakersChanged, speakersChanged);
    room.on(RoomEvent.ParticipantConnected, rosterChanged);
    room.on(RoomEvent.ParticipantDisconnected, rosterChanged);
    room.on(RoomEvent.TrackMuted, speakersChanged);
    room.on(RoomEvent.TrackUnmuted, speakersChanged);
    rosterChanged();
    return () => {
      selection.setConnected(false);
      room.off(RoomEvent.ActiveSpeakersChanged, speakersChanged);
      room.off(RoomEvent.ParticipantConnected, rosterChanged);
      room.off(RoomEvent.ParticipantDisconnected, rosterChanged);
      room.off(RoomEvent.TrackMuted, speakersChanged);
      room.off(RoomEvent.TrackUnmuted, speakersChanged);
    };
  }, [room, connected, selection]);

  return spotlight;
}
