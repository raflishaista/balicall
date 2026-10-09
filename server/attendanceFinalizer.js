import { setTimeout as delay } from 'node:timers/promises';

export function createAttendanceFinalizer({ store, pendingAudio, persist, summarize }) {
  const jobs = new Map();
  let closed = false;
  const enqueue = id => {
    const state = store.get(id)?.attendanceFinalization;
    if (closed || jobs.has(id) || !state || !['pending', 'processing'].includes(state.status)) return;
    const timer = setTimeout(async () => {
      try {
        // Stop accepting new uploads, then let uploads already accepted finish.
        store.transact(() => { store.get(id).closingForUploads = true; });
        let pending = pendingAudio(id);
        while (pending.length) {
          await Promise.allSettled(pending);
          await delay(0);
          pending = pendingAudio(id);
        }
        if (closed) return;
        const meeting = store.finalizeAttendance(id);
        await persist(meeting);
        if (!meeting.transcripts.length) return;
        await summarize(id);
        // A manual request may have started before the final audio was saved.
        // Its older snapshot is shared, then regenerated once against the closed transcript.
        if (store.get(id).summary?.transcriptCount !== store.get(id).transcripts.length) await summarize(id);
        store.transact(() => {
          const final = store.get(id).attendanceFinalization;
          final.status = 'complete'; final.error = null;
        });
      } catch {
        if (!closed) {
          try {
            store.transact(() => {
              const final = store.get(id).attendanceFinalization;
              final.status = 'failed';
              final.error = 'Notulen otomatis belum berhasil. Transkrip tersimpan; coba buat notulen kembali.';
            });
          } catch { console.warn('[ATTENDANCE] Could not persist finalization failure; pending work will be retried after restart.'); }
        }
      } finally { jobs.delete(id); }
    }, Math.max(0, Date.parse(state.runAt) - Date.now()));
    timer.unref?.();
    jobs.set(id, timer);
  };
  // Resume accepted room_finished work after a backend restart.
  for (const meeting of store.meetings.values()) enqueue(meeting.id);
  return { enqueue, close() { closed = true; for (const timer of jobs.values()) clearTimeout(timer); jobs.clear(); } };
}
