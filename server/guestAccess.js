import { randomBytes, randomUUID } from 'node:crypto';
import { hashToken } from './authStore.js';

export function createGuestAccess(store, { getSchedules } = {}) {
  const user = (meeting, person) => ({ employeeId: person.employeeId, name: person.employeeName,
    email: '', department: 'Tamu', position: 'Tamu rapat', isGuest: true,
    guestMeetingId: meeting.id, guestRoomName: meeting.roomName, guestRoomCode: meeting.roomCode });
  const admitPerson = (meeting, name) => {
    const token = randomBytes(32).toString('base64url');
    const person = { employeeId: 'GUEST-' + randomUUID(), employeeName: name.trim() + ' (Tamu)', department: 'Tamu', isGuest: true,
      joinedAt: null, leftAt: null, connected: false, lastSeen: new Date().toISOString(),
      guestSessionHash: hashToken(token), guestSessionExpiresAt: Date.now() + 8 * 3600000 };
    store.transact(() => { meeting.participants.set(person.employeeId, person); });
    return { token, user: user(meeting, person) };
  };
  return {
    join({ name, inviteCode } = {}) {
      const code = typeof inviteCode === 'string' ? inviteCode.trim() : '';
      const isRoomCode = /^[A-Za-z0-9]{5}$/.test(code);
      const isLegacyInvite = /^[A-Za-z0-9_-]{22}$/.test(code);
      if (typeof name !== 'string' || !name.trim() || name.length > 80 || /[\x00-\x1f\x7f]/.test(name) || (!isRoomCode && !isLegacyInvite)) {
        throw Object.assign(new Error('Isi nama dan kode undangan tamu yang valid.'), { status: 400 });
      }
      const upperCode = code.toUpperCase();
      const meeting = [...store.meetings.values()].find(m =>
        m.status === 'active' &&
        !m.attendanceFinalization &&
        !m.closingForUploads &&
        (m.guestInviteCode === code || (isRoomCode && m.roomCode && m.roomCode.toUpperCase() === upperCode))
      );
      if (meeting) {
        return admitPerson(meeting, name);
      }
      if (isRoomCode && typeof getSchedules === 'function') {
        return Promise.resolve(getSchedules()).catch(() => []).then(schedules => {
          const now = Date.now();
          const scheduled = (schedules || []).find(item =>
            item.status !== 'cancelled' &&
            Date.parse(item.scheduledEnd) > now &&
            item.roomCode &&
            item.roomCode.toUpperCase() === upperCode
          );
          if (!scheduled) {
            throw Object.assign(new Error('Undangan tidak tersedia atau rapat sudah selesai.'), { status: 404 });
          }
          const scheduledMeeting = store.ensureScheduledRoom({
            roomName: scheduled.roomName,
            roomCode: scheduled.roomCode,
            hostId: scheduled.hostId || '',
            scheduleId: scheduled.id,
            scheduledStart: scheduled.scheduledStart,
            scheduledEnd: scheduled.scheduledEnd,
          });
          return admitPerson(scheduledMeeting, name);
        });
      }
      throw Object.assign(new Error('Undangan tidak tersedia atau rapat sudah selesai.'), { status: 404 });
    },
    session(token) {
      if (!token) return null;
      const hash = hashToken(token);
      for (const meeting of store.meetings.values()) for (const person of meeting.participants.values()) {
        if (person.isGuest && person.guestSessionHash === hash && person.guestSessionExpiresAt > Date.now()) return user(meeting, person);
      }
      return null;
    },
    revoke(token) {
      const current = this.session(token);
      if (current) store.transact(() => { delete store.get(current.guestMeetingId).participants.get(current.employeeId).guestSessionHash; });
    },
  };
}
