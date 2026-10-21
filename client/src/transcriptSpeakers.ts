export function speakerDisplayLabel(segment: {speaker: string; sessionId?: string}) {
  return segment.sessionId ? `${segment.speaker} · sesi ${segment.sessionId.slice(0,8)}` : segment.speaker;
}
