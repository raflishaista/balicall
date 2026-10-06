import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export class MeetingStore {
  constructor(filename) {
    this.filename = filename;
    this.meetings = new Map();
    if (existsSync(filename)) this.restore(readFileSync(filename, 'utf8'));
  }
  serialize() {
    return JSON.stringify({ version: 1, meetings: [...this.meetings.values()].map(meeting => ({ ...meeting, participants: [...meeting.participants.values()] })) });
  }
  restore(serialized) {
    const data = JSON.parse(serialized);
    if (data.version !== 1 || !Array.isArray(data.meetings)) throw new Error('Unsupported or corrupted meeting data; restore the data file before starting');
    this.meetings = new Map(data.meetings.map(meeting => {
      if (!meeting.id || !Array.isArray(meeting.transcripts) || !Array.isArray(meeting.participants)) throw new Error('Corrupted meeting record');
      return [meeting.id, { ...meeting, participants: new Map(meeting.participants.map(participant => [participant.employeeId, participant])) }];
    }));
  }
  transact(change) {
    const before = this.serialize();
    try {
      const result = change();
      mkdirSync(dirname(this.filename), { recursive: true });
      const temporary = `${this.filename}.tmp`;
      writeFileSync(temporary, this.serialize(), { mode: 0o600 });
      renameSync(temporary, this.filename);
      return result;
    } catch (error) {
      this.restore(before);
      throw error;
    }
  }
  join(roomName, participant) {
    return this.transact(() => {
      let meeting = [...this.meetings.values()].find(value => value.roomName === roomName && value.status === 'active');
      if (meeting && [...meeting.participants.values()].every(person => person.leftAt || Date.now() - Date.parse(person.lastSeen) >= 45000)) {
        meeting.status = 'ended';
        meeting.endedAt = new Date().toISOString();
        meeting = undefined;
      }
      if (!meeting) {
        const id = randomUUID();
        meeting = { id, roomName, livekitRoom: `meeting-${id}`, status: 'active', createdAt: new Date().toISOString(), endedAt: null, participants: new Map(), transcripts: [], emptyAudioRequests: [], summary: null };
        this.meetings.set(id, meeting);
      }
      const previous = meeting.participants.get(participant.employeeId);
      meeting.participants.set(participant.employeeId, {
        ...participant, joinedAt: previous?.joinedAt || null,
        lastSeen: new Date().toISOString(), connected: false, leftAt: null,
      });
      return meeting;
    });
  }
  get(id) { return this.meetings.get(id); }
  findEntry(meeting, speakerId, requestId) {
    return requestId ? meeting.transcripts.find(entry => entry.speakerId === speakerId && entry.requestId === requestId) : undefined;
  }
  hasEmptyAudioRequest(id, speakerId, requestId) {
    return (this.get(id).emptyAudioRequests || []).some(receipt => receipt.speakerId === speakerId && receipt.requestId === requestId);
  }
  saveEmptyAudioRequest(id, speakerId, requestId) {
    this.transact(() => {
      const meeting = this.get(id);
      meeting.emptyAudioRequests ||= [];
      meeting.emptyAudioRequests.push({ speakerId, requestId });
    });
  }
  append(id, speakerId, text, requestId) {
    const existing = this.findEntry(this.get(id), speakerId, requestId);
    if (existing) return existing;
    return this.transact(() => {
      const meeting = this.get(id);
      const speaker = meeting.participants.get(speakerId);
      const entry = { id: randomUUID(), requestId, speakerId, speakerName: speaker.employeeName, text: text.trim(), timestamp: new Date().toISOString() };
      meeting.transcripts.push(entry);
      meeting.summary = null;
      speaker.lastSeen = entry.timestamp;
      return entry;
    });
  }
  presence(id, speakerId, connected) {
    return this.transact(() => {
      const meeting = this.get(id);
      const participant = meeting.participants.get(speakerId);
      participant.connected = connected;
      participant.lastSeen = new Date().toISOString();
      if (connected) participant.joinedAt ||= participant.lastSeen;
      return participant;
    });
  }
  leave(id, speakerId) {
    return this.transact(() => {
      const meeting = this.get(id);
      const participant = meeting.participants.get(speakerId);
      participant.connected = false;
      participant.leftAt = new Date().toISOString();
      participant.lastSeen = participant.leftAt;
      // Pending/reconnecting participants keep their session for a short grace period.
      const remaining = [...meeting.participants.values()].some(value => !value.leftAt && Date.now() - Date.parse(value.lastSeen) < 45000);
      if (!remaining) {
        meeting.status = 'ended';
        meeting.endedAt = participant.leftAt;
      }
      return meeting;
    });
  }
}
