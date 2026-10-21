export function speakerDisplayLabel(segment: {speaker: string; sessionId?: string; speakerName?: string}) {
  const label=segment.speakerName || segment.speaker;
  return segment.sessionId ? `${label} · sesi ${segment.sessionId.slice(0,8)}` : label;
}
