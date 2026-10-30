export function speakerDisplayLabel(segment: {speaker: string; sessionId?: string; speakerName?: string; attribution?: string}, accountName?: string) {
  const label=segment.attribution === 'participant' ? accountName?.trim() || 'Peserta' : segment.speakerName || segment.speaker;
  return segment.sessionId ? `${label} · sesi ${segment.sessionId.slice(0,8)}` : label;
}
