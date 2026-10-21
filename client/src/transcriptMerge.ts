import type { TranscriptEntry } from './summaryHistory';

export function mergeTranscripts(current: TranscriptEntry[], incoming: TranscriptEntry[]) {
  const byId = new Map(current.map(entry => [entry.id, entry]));
  for (const entry of incoming) {
    const previous=byId.get(entry.id);
    if (!previous || (entry.revision || 0)>=(previous.revision || 0)) byId.set(entry.id,entry);
  }
  return [...byId.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
