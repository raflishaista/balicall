import { ConnectionState, RoomEvent } from 'livekit-client';
import type { Room, RemoteParticipant } from 'livekit-client';
import type { TranscriptEntry } from './summaryHistory';

export const TRANSCRIPT_TOPIC = 'balicall.transcript.saved.v1';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function decodeTranscriptNotice(payload: Uint8Array, meetingId: string): string | null {
  if (!payload.byteLength || payload.byteLength > 1024) return null;
  try {
    const value = JSON.parse(decoder.decode(payload));
    return value?.v === 1 && value.meetingId === meetingId && typeof value.entryId === 'string'
      && value.entryId.length > 0 && value.entryId.length <= 256 ? value.entryId : null;
  } catch { return null; }
}

export function createTranscriptRealtime(room: Room, meetingId: string, options: {
  fetchEntries: (signal: AbortSignal) => Promise<TranscriptEntry[]>;
  onEntries: (entries: TranscriptEntry[]) => void;
  onError: (message: string | null) => void;
  reconciliationMs?: number;
  debounceMs?: number;
}) {
  let disposed = false;
  let running = false;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abort = new AbortController();
  const seen = new Set<string>();
  const connected = () => room.state === ConnectionState.Connected;
  const sync = async () => {
    timer = undefined;
    if (disposed || !connected()) return;
    if (running) { dirty = true; return; }
    running = true;
    dirty = false;
    try {
      const entries = await options.fetchEntries(abort.signal);
      if (!disposed) { options.onEntries(entries); options.onError(null); }
    } catch {
      if (!disposed) options.onError('Transkrip belum tersinkron. Periksa koneksi layanan.');
    } finally {
      running = false;
      if (dirty && !disposed) requestSync();
    }
  };
  const requestSync = () => {
    if (disposed || !connected()) return;
    if (running) { dirty = true; return; }
    if (timer === undefined) timer = setTimeout(() => { void sync(); }, options.debounceMs ?? 100);
  };
  const received = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
    if (disposed || topic !== TRANSCRIPT_TOPIC || !participant || !room.remoteParticipants.has(participant.identity)) return;
    const id = decodeTranscriptNotice(payload, meetingId);
    if (!id || seen.has(id)) return;
    seen.add(id);
    if (seen.size > 256) seen.delete(seen.values().next().value!);
    requestSync();
  };
  room.on(RoomEvent.DataReceived, received);
  room.on(RoomEvent.Connected, requestSync);
  room.on(RoomEvent.Reconnected, requestSync);
  const interval = setInterval(requestSync, options.reconciliationMs ?? 30000);
  requestSync();
  return {
    async notifySaved(entry: TranscriptEntry) {
      if (disposed || !connected()) return;
      try {
        await room.localParticipant.publishData(encoder.encode(JSON.stringify({ v: 1, meetingId, entryId: entry.id })), {
          reliable: true, topic: TRANSCRIPT_TOPIC,
        });
      } catch {
        // The saved transcript remains authoritative; reconciliation recovers a lost notice.
        if (!disposed) options.onError('Transkrip tersimpan. Pembaruan realtime tertunda; sinkronisasi cadangan tetap berjalan.');
      }
    },
    dispose() {
      disposed = true;
      abort.abort();
      clearTimeout(timer); clearInterval(interval);
      room.off(RoomEvent.DataReceived, received);
      room.off(RoomEvent.Connected, requestSync);
      room.off(RoomEvent.Reconnected, requestSync);
      seen.clear();
    },
  };
}
