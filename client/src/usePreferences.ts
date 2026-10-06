import { useState } from 'react';
import { DEFAULT_PREFERENCES, readPreferences, writePreferences } from './preferences';
import type { MeetingPreferences } from './preferences';

export function usePreferences() {
  const [initial] = useState(() => {
    try { return readPreferences(window.localStorage); }
    catch { return { preferences: { ...DEFAULT_PREFERENCES }, notice: 'Penyimpanan browser tidak tersedia. Preferensi belum dapat disimpan.' }; }
  });
  const [preferences, setPreferences] = useState(initial.preferences);
  const [notice, setNotice] = useState(initial.notice);
  const save = (next: MeetingPreferences) => {
    try {
      const saved = writePreferences(window.localStorage, next);
      setPreferences(saved); setNotice(null);
      return true;
    } catch { setNotice('Gagal menyimpan preferensi. Izinkan penyimpanan browser, lalu coba lagi.'); return false; }
  };
  return { preferences, notice, save };
}
