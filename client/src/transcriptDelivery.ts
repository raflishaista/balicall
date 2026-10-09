import type { TranscriptEntry } from './summaryHistory';

export interface TranscriptPublisher {
  meetingId: string;
  notifySaved: (entry: TranscriptEntry) => Promise<void>;
}

// Keep late save completions and transport lifetimes scoped to their meeting.
export function createTranscriptDelivery(onEntry: (entry: TranscriptEntry) => void) {
  let meeting: string | null = null;
  let publisher: TranscriptPublisher | null = null;
  return {
    beginMeeting(id: string) { meeting = id; },
    register(next: TranscriptPublisher) {
      publisher = next;
      return () => { if (publisher === next) publisher = null; };
    },
    saved({ entry, meetingId }: { entry: TranscriptEntry | null; meetingId: string }) {
      if (!entry || meetingId !== meeting) return;
      onEntry(entry);
      if (publisher?.meetingId === meetingId) void publisher.notifySaved(entry).catch(() => {});
    },
  };
}
