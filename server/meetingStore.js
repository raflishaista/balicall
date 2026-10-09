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
      return [meeting.id, {
        ...meeting,
        recording: meeting.recording || {
          egressId: null,
          status: 'idle',
          startedAt: null,
          stoppedAt: null,
          filepath: null,
        },
        participants: new Map(
          meeting.participants.map(participant => [participant.employeeId, participant])
        ),
      }];
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
      let meeting = [...this.meetings.values()].find(value => value.roomName === roomName && value.status === 'active' && !value.attendanceFinalization);
      if (meeting && [...meeting.participants.values()].every(person => person.leftAt || Date.now() - Date.parse(person.lastSeen) >= 45000)) {
        meeting.status = 'ended';
        meeting.endedAt = new Date().toISOString();
        meeting = undefined;
      }
      if (!meeting) {
        const id = randomUUID();
        meeting = {
          id,
          roomName,
          livekitRoom: `meeting-${id}`,
          status: 'active',
          createdAt: new Date().toISOString(),
          endedAt: null,
          participants: new Map(),
          transcripts: [],
          emptyAudioRequests: [],
          summary: null,
          recording: {
            egressId: null,
            status: 'idle',
            startedAt: null,
            stoppedAt: null,
            filepath: null,
          },
        };
        this.meetings.set(id, meeting);
      }
      const previous = meeting.participants.get(participant.employeeId);
      meeting.participants.set(participant.employeeId, {
        ...previous, ...participant, joinedAt: previous?.joinedAt || null,
        lastSeen: new Date().toISOString(), connected: false, leftAt: null,
      });
      return meeting;
    });
  }
  get(id) { return this.meetings.get(id); }
  applyLivekitEvent(event, graceMs) {
    const meeting = [...this.meetings.values()].find(value => value.livekitRoom === event.room?.name);
    if (!meeting) return { ignored: 'unknown-room' };
    const eventMs = Number(event.createdAt) * 1000;
    if (!event.id || !event.room?.sid || !Number.isSafeInteger(eventMs) || eventMs <= 0 || eventMs > Date.now() + 300000) return { ignored: 'invalid-event' };
    if ((meeting.webhookReceipts || []).includes(event.id)) return { meetingId: meeting.id, duplicate: true };
    if (meeting.livekitRoomSid && meeting.livekitRoomSid !== event.room.sid) return { ignored: 'old-room-instance' };
    const participant = meeting.participants.get(event.participant?.identity);
    const isParticipant = ['participant_joined', 'participant_left'].includes(event.event);
    if (isParticipant && (!participant || !event.participant?.sid)) return { ignored: 'unknown-participant' };
    if (!isParticipant && !['room_started', 'room_finished'].includes(event.event)) return { ignored: 'unhandled-event' };
    return this.transact(() => {
      meeting.livekitRoomSid ||= event.room.sid;
      meeting.webhookReceipts ||= [];
      meeting.webhookReceipts.push(event.id);
      meeting.webhookReceipts = meeting.webhookReceipts.slice(-1000);
      const at = new Date(eventMs).toISOString();
      if (event.event === 'room_finished') {
        if (eventMs < (meeting.livekitLatestJoinMs || 0) || meeting.attendanceFinalization) return { meetingId: meeting.id, ignored: 'stale-room-finish' };
        meeting.attendanceFinalization = { status: 'pending', roomFinishedAt: at, runAt: new Date(Date.now() + graceMs).toISOString(), error: null };
        return { meetingId: meeting.id, finalize: true };
      }
      if (isParticipant && !meeting.attendanceFinalization) {
        const sid = event.participant.sid;
        const latest = participant.livekitEventMs || 0;
        if (event.event === 'participant_joined') {
          // A delayed join may fill the first attendance time, but must not undo a later leave.
          participant.livekitJoinedAt = !participant.livekitJoinedAt || at < participant.livekitJoinedAt ? at : participant.livekitJoinedAt;
          if (!participant.joinedAt) { participant.joinedAt = at; meeting.summary = null; }
          if (eventMs < latest || (participant.livekitDepartedSids || []).includes(sid)) return { meetingId: meeting.id, ignored: 'stale-participant-event' };
          participant.livekitParticipantSid = sid;
          participant.livekitLeftAt = null;
          participant.livekitEventMs = eventMs;
          participant.connected = !participant.leftAt;
          participant.lastSeen = at;
          meeting.livekitLatestJoinMs = Math.max(meeting.livekitLatestJoinMs || 0, eventMs);
        } else {
          if (eventMs < latest || (participant.livekitParticipantSid && participant.livekitParticipantSid !== sid)) return { meetingId: meeting.id, ignored: 'stale-participant-event' };
          participant.livekitParticipantSid = sid;
          participant.livekitEventMs = eventMs;
          participant.livekitLeftAt = at;
          participant.livekitDepartedSids = [...new Set([...(participant.livekitDepartedSids || []), sid])].slice(-32);
          participant.connected = false;
          participant.lastSeen = at;
          // leftAt is the API authorization boundary; do not reject queued STT just because media disconnected.
        }
      }
      return { meetingId: meeting.id };
    });
  }
  finalizeAttendance(id) {
    return this.transact(() => {
      const meeting = this.get(id);
      const at = meeting.attendanceFinalization.roomFinishedAt;
      for (const participant of meeting.participants.values()) {
        if (participant.joinedAt) {
          participant.livekitLeftAt ||= at;
          participant.leftAt ||= participant.livekitLeftAt;
        }
        participant.connected = false;
      }
      meeting.status = 'ended';
      meeting.endedAt ||= at;
      meeting.attendanceFinalization.status = meeting.transcripts.length ? 'processing' : 'skipped';
      return meeting;
    });
  }
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
  append(id, speakerId, text, requestId, segments, sttModel) {
    const existing = this.findEntry(this.get(id), speakerId, requestId);
    if (existing) return existing;
    return this.transact(() => {
      const meeting = this.get(id);
      const speaker = meeting.participants.get(speakerId);
      const entry = { id: randomUUID(), requestId, speakerId, speakerName: speaker.employeeName, text: text.trim(), timestamp: new Date().toISOString() };
      if (segments) entry.segments = structuredClone(segments);
      if (sttModel) entry.sttModel = sttModel;
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
      participant.connected = connected && !participant.livekitLeftAt;
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
