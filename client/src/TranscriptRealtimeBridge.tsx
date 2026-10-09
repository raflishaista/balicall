import { useEffect, useEffectEvent } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { apiRequest, meetingPath } from './api';
import { createTranscriptRealtime } from './transcriptRealtime';
import type { TranscriptEntry } from './summaryHistory';
import type { TranscriptPublisher } from './transcriptDelivery';

export function TranscriptRealtimeBridge({ meetingId, token, onEntries, onError, register }: {
  meetingId: string; token: string;
  onEntries: (entries: TranscriptEntry[]) => void;
  onError: (message: string | null) => void;
  register: (publisher: TranscriptPublisher) => () => void;
}) {
  const room = useRoomContext();
  const applyEntries = useEffectEvent(onEntries);
  const applyError = useEffectEvent(onError);
  useEffect(() => {
    const sync = createTranscriptRealtime(room, meetingId, {
      fetchEntries: async signal => (await apiRequest<{ transcripts: TranscriptEntry[] }>(meetingPath(meetingId, 'transcript'), {
        headers: { Authorization: 'Bearer ' + token }, signal,
      })).transcripts,
      onEntries: entries => applyEntries(entries), onError: message => applyError(message),
    });
    const unregister = register({ meetingId, notifySaved: sync.notifySaved });
    return () => { unregister(); sync.dispose(); };
  }, [room, meetingId, token, register]);
  return null;
}
