import { useCallback, useEffect, useRef, useState } from 'react';

export type InputKind = 'audioinput' | 'videoinput';
export interface JoinMediaChoices {
  microphoneEnabled: boolean; cameraEnabled: boolean;
  microphoneId: string; cameraId: string;
}
const defaults: JoinMediaChoices = { microphoneEnabled: true, cameraEnabled: true, microphoneId: 'default', cameraId: 'default' };
const enabledKey = { audioinput: 'microphoneEnabled', videoinput: 'cameraEnabled' } as const;
const idKey = { audioinput: 'microphoneId', videoinput: 'cameraId' } as const;
const names = { audioinput: 'Mikrofon', videoinput: 'Kamera' };
const kinds: InputKind[] = ['audioinput', 'videoinput'];

export function usePreJoinMedia(inLobby: boolean) {
  const [choices, setChoices] = useState<JoinMediaChoices>(defaults);
  const choiceRef = useRef(choices);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [streams, setStreams] = useState<Record<InputKind, MediaStream | null>>({ audioinput: null, videoinput: null });
  const owned = useRef<Record<InputKind, MediaStream | null>>({ audioinput: null, videoinput: null });
  const removers = useRef<Partial<Record<InputKind, () => void>>>({});
  const generations = useRef({ audioinput: 0, videoinput: 0 });
  const enumeration = useRef(0);
  const pendingRef = useRef({ audioinput: false, videoinput: false });
  const active = useRef(false);
  const [pending, setPending] = useState({ audioinput: false, videoinput: false });
  const [errors, setErrors] = useState<Record<InputKind, string | null>>({ audioinput: null, videoinput: null });
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const patchChoices = useCallback((patch: Partial<JoinMediaChoices>) => {
    choiceRef.current = { ...choiceRef.current, ...patch };
    setChoices(choiceRef.current);
  }, []);
  const release = useCallback((kind: InputKind) => {
    generations.current[kind]++;
    removers.current[kind]?.(); delete removers.current[kind];
    owned.current[kind]?.getTracks().forEach(track => track.stop());
    owned.current[kind] = null;
    pendingRef.current[kind] = false;
    if (active.current) {
      setStreams(previous => ({ ...previous, [kind]: null }));
      setPending(previous => ({ ...previous, [kind]: false }));
    }
  }, []);
  const stopAll = useCallback(() => { kinds.forEach(release); }, [release]);
  const refresh = useCallback(async () => {
    const request = ++enumeration.current;
    try {
      if (!navigator.mediaDevices?.enumerateDevices) throw new Error('unsupported');
      const next = await navigator.mediaDevices.enumerateDevices();
      if (!active.current || request !== enumeration.current) return;
      setDevices(next.filter(device => kinds.includes(device.kind as InputKind)));
      setStreams({ ...owned.current }); setPending({ ...pendingRef.current });
      setDeviceError(null);
      for (const kind of kinds) {
        const stream = owned.current[kind];
        const actualId = stream?.getTracks()[0]?.getSettings().deviceId;
        if (actualId && !next.some(device => device.kind === kind && device.deviceId === actualId)) {
          release(kind); patchChoices({ [enabledKey[kind]]: false });
          setErrors(previous => ({ ...previous, [kind]: `${names[kind]} terputus. Pilih perangkat lain, lalu aktifkan kembali.` }));
        }
      }
    } catch {
      if (active.current && request === enumeration.current) setDeviceError('Daftar perangkat belum tersedia. Periksa izin browser atau coba perbarui daftar.');
    }
  }, [patchChoices, release]);
  const deactivate = useCallback(() => { active.current = false; enumeration.current++; stopAll(); }, [stopAll]);

  useEffect(() => {
    active.current = inLobby;
    if (!inLobby) return;
    queueMicrotask(() => { if (active.current) void refresh(); });
    const mediaDevices = navigator.mediaDevices;
    mediaDevices?.addEventListener('devicechange', refresh);
    return () => {
      deactivate();
      mediaDevices?.removeEventListener('devicechange', refresh);
    };
  }, [inLobby, refresh, deactivate]);

  const capture = useCallback(async (kind: InputKind) => {
    if (!active.current) return;
    release(kind);
    const request = generations.current[kind];
    const id = choiceRef.current[idKey[kind]];
    pendingRef.current[kind] = true;
    setPending(previous => ({ ...previous, [kind]: true }));
    setErrors(previous => ({ ...previous, [kind]: null }));
    let stream: MediaStream | null = null;
    try {
      const selected = id && id !== 'default' ? { deviceId: { exact: id } } : true;
      stream = await navigator.mediaDevices.getUserMedia(kind === 'audioinput' ? { audio: selected, video: false } : { audio: false, video: selected });
      if (!active.current || request !== generations.current[kind]) { stream.getTracks().forEach(track => track.stop()); return; }
      const track = kind === 'audioinput' ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
      if (!track || track.readyState === 'ended') throw new Error('No live track');
      const ended = () => {
        if (owned.current[kind] !== stream) return;
        release(kind); patchChoices({ [enabledKey[kind]]: false });
        setErrors(previous => ({ ...previous, [kind]: `${names[kind]} berhenti. Periksa perangkat dan aktifkan kembali.` }));
      };
      track.addEventListener('ended', ended);
      removers.current[kind] = () => track.removeEventListener('ended', ended);
      owned.current[kind] = stream;
      setStreams(previous => ({ ...previous, [kind]: stream }));
      // Keep “default” as a preference; explicit selections must match the capture.
      const actualId = track.getSettings().deviceId;
      patchChoices({ [enabledKey[kind]]: true, ...(id !== 'default' && actualId ? { [idKey[kind]]: actualId } : {}) });
      void refresh();
    } catch (cause) {
      stream?.getTracks().forEach(track => track.stop());
      if (!active.current || request !== generations.current[kind]) return;
      patchChoices({ [enabledKey[kind]]: false });
      const name = cause instanceof Error ? cause.name : '';
      const message = name === 'NotAllowedError' || name === 'SecurityError' ? 'izin belum diberikan. Izinkan di browser, lalu coba lagi.'
        : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'tidak ditemukan. Pilih perangkat lain atau hubungkan kembali.'
        : 'belum dapat digunakan. Periksa perangkat dan coba lagi.';
      setErrors(previous => ({ ...previous, [kind]: `${names[kind]}: ${message} Kamu tetap bisa bergabung dengan perangkat ini nonaktif.` }));
    } finally {
      if (active.current && request === generations.current[kind]) { pendingRef.current[kind] = false; setPending(previous => ({ ...previous, [kind]: false })); }
    }
  }, [patchChoices, refresh, release]);
  const select = useCallback((kind: InputKind, id: string) => {
    if (!active.current) return;
    const running = Boolean(owned.current[kind]) || pendingRef.current[kind];
    patchChoices({ [idKey[kind]]: id });
    setErrors(previous => ({ ...previous, [kind]: null }));
    if (running) void capture(kind);
  }, [capture, patchChoices]);
  const toggle = useCallback((kind: InputKind) => {
    if (!active.current) return;
    const enable = !choiceRef.current[enabledKey[kind]];
    patchChoices({ [enabledKey[kind]]: enable });
    if (enable) void capture(kind); else release(kind);
  }, [capture, patchChoices, release]);

  return { choices, devices, streams, pending, errors, deviceError, refresh, capture, select, toggle,
    stopMicrophone: () => release('audioinput'), stopCamera: () => release('videoinput'), stopAll,
    resetLobby() { stopAll(); setErrors({ audioinput: null, videoinput: null }); setDeviceError(null); },
    prepareJoin() { const selected = { ...choiceRef.current }; stopAll(); return selected; },
  };
}
