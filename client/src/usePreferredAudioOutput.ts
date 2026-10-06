import { useEffect, useRef, useState } from 'react';
import { RoomEvent } from 'livekit-client';
import type { Room } from 'livekit-client';

export function usePreferredAudioOutput(room: Room, connected: boolean, outputId: string) {
  const [error, setError] = useState<string | null>(null);
  const applied = useRef<{ room: Room; outputId: string } | null>(null);
  useEffect(() => {
    const changed = (kind: MediaDeviceKind) => { if (kind === 'audiooutput') setError(null); };
    room.on(RoomEvent.ActiveDeviceChanged, changed);
    return () => { room.off(RoomEvent.ActiveDeviceChanged, changed); };
  }, [room]);
  useEffect(() => {
    if (!connected || outputId === 'default' || (applied.current?.room === room && applied.current.outputId === outputId)) return;
    let cancelled = false;
    const supported = typeof HTMLMediaElement !== 'undefined' && typeof HTMLMediaElement.prototype.setSinkId === 'function';
    const apply = async () => {
      let message: string | null = null;
      try {
        if (!supported) { message = 'Pilihan speaker tersimpan belum didukung browser ini. Output sistem digunakan.'; }
        else {
          const devices = await navigator.mediaDevices.enumerateDevices();
          if (cancelled) return;
          const available = devices.some(device => device.kind === 'audiooutput' && device.deviceId === outputId);
          if (!available) message = 'Speaker pilihan tidak tersedia atau belum diizinkan. Output sistem digunakan; pilih speaker di pengaturan perangkat rapat.';
          const selected = await room.switchActiveDevice('audiooutput', available ? outputId : 'default');
          if (!selected) throw new Error('Output selection failed');
        }
      } catch {
        message = 'Speaker pilihan belum dapat digunakan. Pilih output di pengaturan perangkat rapat.';
        try { if (!cancelled) await room.switchActiveDevice('audiooutput', 'default'); } catch { /* Keep an actionable message. */ }
      }
      if (!cancelled) { applied.current = { room, outputId }; setError(message); }
    };
    void apply();
    return () => { cancelled = true; };
  }, [room, connected, outputId]);
  return error;
}
