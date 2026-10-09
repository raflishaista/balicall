import { randomBytes, randomUUID } from 'node:crypto';
import { hashToken } from './authStore.js';

export function createGuestAccess(store) {
  const user = (meeting, person) => ({ employeeId: person.employeeId, name: person.employeeName,
    email: '', department: 'Tamu', position: 'Tamu rapat', isGuest: true,
    guestMeetingId: meeting.id, guestRoomName: meeting.roomName });
  return {
    join({ name, inviteCode } = {}) {
      if (typeof name !== 'string' || !name.trim() || name.length > 80 || /[\x00-\x1f\x7f]/.test(name) || typeof inviteCode !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(inviteCode.trim())) {
        throw Object.assign(new Error('Isi nama dan kode undangan tamu yang valid.'), { status: 400 });
      }
      const meeting = [...store.meetings.values()].find(m => m.guestInviteCode === inviteCode.trim() && m.status === 'active' && !m.attendanceFinalization && !m.closingForUploads);
      if (!meeting) throw Object.assign(new Error('Undangan tidak tersedia atau rapat sudah selesai.'), { status: 404 });
      const token = randomBytes(32).toString('base64url');
      const person = { employeeId: 'GUEST-' + randomUUID(), employeeName: name.trim() + ' (Tamu)', department: 'Tamu', isGuest: true,
        joinedAt: null, leftAt: null, connected: false, lastSeen: new Date().toISOString(),
        guestSessionHash: hashToken(token), guestSessionExpiresAt: Date.now() + 8 * 3600000 };
      store.transact(() => { meeting.participants.set(person.employeeId, person); });
      return { token, user: user(meeting, person) };
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
