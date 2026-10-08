import { accountKey, withAccountScope } from './accountScope.ts';
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
  hostId?: string; hostName?: string; department?: string;
}
export interface InProgressRecord {
  meetingId: string; roomName: string; token?: string; transcripts: TranscriptEntry[]; startedAt: string;
  hostId?: string; hostName?: string; department?: string;
}
export interface SummarySession {
  meetingId: string; roomName: string; token: string; transcripts: TranscriptEntry[]; open: boolean;
  isSummarizing?: boolean;
}
export const HISTORY_KEY = 'balicall.summary-history.v1';
export const SESSION_KEY = 'balicall.summary-session.v1';
export const IN_PROGRESS_KEY = 'balicall.summary-in-progress.v1';
export const ACTIVE_VIEW_KEY = 'balicall.active-view.v1';
const TOKEN_KEY = 'balicall.summary-tokens.v1';
export const HISTORY_LIMIT = 20;

function read(key: string, session = false): unknown {
  try { return JSON.parse((session ? window.sessionStorage : window.localStorage).getItem(accountKey(key)) || 'null'); }
  catch { return null; }
}
function write(key: string, value: unknown, session = false) {
  try { (session ? window.sessionStorage : window.localStorage).setItem(accountKey(key), JSON.stringify(value)); return true; }
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
  return write(HISTORY_KEY, records.slice(0, HISTORY_LIMIT).map(({ meetingId, roomName, savedAt, summary, transcripts, hostId, hostName, department }) => ({
    meetingId, roomName, savedAt, summary, transcripts,
    ...(hostId ? { hostId } : {}),
    ...(hostName ? { hostName } : {}),
    ...(department ? { department } : {}),
  })));
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

export function readInProgressSummaries(): InProgressRecord[] {
  const value = read(IN_PROGRESS_KEY, true);
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is InProgressRecord =>
    object(item) && typeof item.meetingId === 'string' && typeof item.roomName === 'string'
    && typeof item.startedAt === 'string' && validTranscripts(item.transcripts)
  );
}

export function saveInProgressSummary(record: InProgressRecord): boolean {
  if (record.token) {
    const previous = read(TOKEN_KEY, true);
    const tokens = object(previous) ? previous : {};
    write(TOKEN_KEY, Object.fromEntries([[record.meetingId, record.token], ...Object.entries(tokens).filter(([id]) => id !== record.meetingId)].slice(0, HISTORY_LIMIT)), true);
  }
  const current = readInProgressSummaries();
  const next = [record, ...current.filter(item => item.meetingId !== record.meetingId)];
  return write(IN_PROGRESS_KEY, next, true);
}

export function removeInProgressSummary(meetingId: string): boolean {
  const current = readInProgressSummaries();
  const next = current.filter(item => item.meetingId !== meetingId);
  return write(IN_PROGRESS_KEY, next, true);
}

export function readActiveView(): string | null {
  const value = read(ACTIVE_VIEW_KEY, true);
  return typeof value === 'string' ? value : null;
}

export function saveActiveView(view: string): boolean {
  return write(ACTIVE_VIEW_KEY, view, true);
}

export function normalizeDbSummary(raw: any): SummaryRecord {
  const s = raw?.summary || raw || {};
  const rawActions = s.action_items || s.actionItems || [];
  const actionItems = Array.isArray(rawActions) ? rawActions.map((item: any) => ({
    task: typeof item?.task === 'string' ? item.task : String(item || ''),
    assignee: typeof item?.assignee === 'string' ? item.assignee : 'Belum ditentukan',
    priority: (['High', 'Medium', 'Low'].includes(String(item?.priority)) ? item.priority : 'Medium') as 'High' | 'Medium' | 'Low',
    deadline: typeof item?.deadline === 'string' ? item.deadline : 'Belum ditentukan',
  })) : [];

  return {
    meetingId: String(raw.meeting_id || raw.meetingId || raw.id || ''),
    roomName: String(raw.room_name || raw.roomName || 'Ruang Rapat'),
    savedAt: String(raw.created_at || raw.createdAt || raw.savedAt || new Date().toISOString()),
    summary: {
      title: String(s.title || 'Notulen Rapat'),
      executiveSummary: String(s.executive_summary || s.executiveSummary || 'Ringkasan tidak tersedia.'),
      keyDiscussionPoints: Array.isArray(s.key_discussion_points || s.keyDiscussionPoints)
        ? (s.key_discussion_points || s.keyDiscussionPoints).map(String) : [],
      decisions: Array.isArray(s.decisions) ? s.decisions.map(String) : [],
      actionItems,
      attendanceSummary: Array.isArray(s.attendance_summary || s.attendanceSummary)
        ? (s.attendance_summary || s.attendanceSummary).map(String) : [],
      provider: s.provider ? String(s.provider) : undefined,
      generatedAt: String(s.created_at || s.createdAt || s.generatedAt || new Date().toISOString()),
      dbSummaryId: typeof raw.id === 'number' ? raw.id : undefined,
    },
    transcripts: Array.isArray(raw.transcripts) ? raw.transcripts : [],
    hostId: raw.host_id || raw.hostId,
    hostName: raw.host_name || raw.hostName,
    department: raw.department,
  };
}

// Bind storage to the account at mount, including late async callbacks from an old session.
export function scopedSummaryStorage(employeeId: string | null) {
  const bind = <A extends unknown[], R>(fn: (...args: A) => R) => (...args: A): R => withAccountScope(employeeId, () => fn(...args));
  return { readSummaryHistory: bind(readSummaryHistory), readSummarySession: bind(readSummarySession),
    saveSummaryHistory: bind(saveSummaryHistory), saveSummarySession: bind(saveSummarySession),
    summaryTokenFor: bind(summaryTokenFor), readInProgressSummaries: bind(readInProgressSummaries),
    saveInProgressSummary: bind(saveInProgressSummary), removeInProgressSummary: bind(removeInProgressSummary),
    readActiveView: bind(readActiveView), saveActiveView: bind(saveActiveView) };
}
