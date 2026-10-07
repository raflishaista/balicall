export interface TranscriptEntry {
  id: string; speakerId: string; speakerName: string; text: string; timestamp: string;
}
export interface MeetingSummary {
  title: string; executiveSummary: string; keyDiscussionPoints: string[]; decisions: string[];
  actionItems: { task: string; assignee: string; priority: 'High' | 'Medium' | 'Low'; deadline: string }[];
  attendanceSummary: string[]; transcriptCount?: number; provider?: string; note?: string;
  generatedAt?: string; dbSummaryId?: number;
}
export interface SummaryRecord {
  meetingId: string; roomName: string; savedAt: string; summary: MeetingSummary; transcripts: TranscriptEntry[];
}
export interface SummarySession {
  meetingId: string; roomName: string; token: string; transcripts: TranscriptEntry[]; open: boolean;
}
export const HISTORY_KEY = 'balicall.summary-history.v1';
export const SESSION_KEY = 'balicall.summary-session.v1';
const TOKEN_KEY = 'balicall.summary-tokens.v1';
export const HISTORY_LIMIT = 20;

function read(key: string, session = false): unknown {
  try { return JSON.parse((session ? window.sessionStorage : window.localStorage).getItem(key) || 'null'); }
  catch { return null; }
}
function write(key: string, value: unknown, session = false) {
  try { (session ? window.sessionStorage : window.localStorage).setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(item => typeof item === 'string'); }
export function validSummary(value: unknown): value is MeetingSummary {
  return object(value) && typeof value.title === 'string' && typeof value.executiveSummary === 'string'
    && ['provider', 'note', 'generatedAt'].every(key => value[key] === undefined || typeof value[key] === 'string')
    && ['transcriptCount', 'dbSummaryId'].every(key => value[key] === undefined || typeof value[key] === 'number')
    && strings(value.keyDiscussionPoints) && strings(value.decisions) && strings(value.attendanceSummary)
    && Array.isArray(value.actionItems) && value.actionItems.every(item => object(item) && typeof item.task === 'string'
      && typeof item.assignee === 'string' && typeof item.deadline === 'string' && ['High', 'Medium', 'Low'].includes(String(item.priority)));
}
function validTranscripts(value: unknown): value is TranscriptEntry[] {
  return Array.isArray(value) && value.every(item => object(item)
    && ['id', 'speakerId', 'speakerName', 'text', 'timestamp'].every(key => typeof item[key] === 'string'));
}
export function readSummaryHistory(): SummaryRecord[] {
  const value = read(HISTORY_KEY);
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is SummaryRecord => object(item) && typeof item.meetingId === 'string'
    && typeof item.roomName === 'string' && typeof item.savedAt === 'string' && Number.isFinite(Date.parse(item.savedAt)) && validSummary(item.summary)
    && validTranscripts(item.transcripts)).slice(0, HISTORY_LIMIT);
}
export function upsertSummary(records: SummaryRecord[], record: SummaryRecord) {
  return [record, ...records.filter(item => item.meetingId !== record.meetingId)].slice(0, HISTORY_LIMIT);
}
export function saveSummaryHistory(records: SummaryRecord[]) {
  // Explicit projection keeps bearer tokens out of persistent localStorage.
  return write(HISTORY_KEY, records.slice(0, HISTORY_LIMIT).map(({ meetingId, roomName, savedAt, summary, transcripts }) => ({ meetingId, roomName, savedAt, summary, transcripts })));
}
export function readSummarySession(): SummarySession | null {
  const value = read(SESSION_KEY, true);
  return object(value) && typeof value.meetingId === 'string' && typeof value.roomName === 'string'
    && typeof value.token === 'string' && typeof value.open === 'boolean' && validTranscripts(value.transcripts) ? value as unknown as SummarySession : null;
}
export function saveSummarySession(value: SummarySession) {
  if (value.token) {
    const previous = read(TOKEN_KEY, true);
    const tokens = object(previous) ? previous : {};
    // Keep credentials in this tab's session, never in localStorage.
    write(TOKEN_KEY, Object.fromEntries([[value.meetingId, value.token], ...Object.entries(tokens).filter(([id]) => id !== value.meetingId)].slice(0, HISTORY_LIMIT)), true);
  }
  return write(SESSION_KEY, value, true);
}
export function summaryTokenFor(id: string): string {
  const tokens = read(TOKEN_KEY, true);
  return object(tokens) && typeof tokens[id] === 'string' ? tokens[id] : '';
}
