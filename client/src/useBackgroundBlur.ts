import { useCallback, useEffect, useRef, useState } from 'react';
import type { LocalParticipant, LocalVideoTrack } from 'livekit-client';
import { ParticipantEvent, Track } from 'livekit-client';
import { BackgroundProcessor, supportsBackgroundProcessors } from '@livekit/track-processors';
import { BackgroundEffectSession, BLUR_BACKGROUND, NO_BACKGROUND, validateBackgroundFile } from './backgroundEffects.ts';
import type { BackgroundChoice } from './backgroundEffects';

export function useBackgroundBlur(participant: LocalParticipant | undefined, isCameraEnabled: boolean, connected: boolean) {
  const [selection, setSelection] = useState<BackgroundChoice>(NO_BACKGROUND);
  const [blurPending, setPending] = useState(false);
  const [blurError, setError] = useState<string | null>(null);
  const blurSupported = typeof window !== 'undefined' && supportsBackgroundProcessors();
  const active = useRef<{ session: BackgroundEffectSession; selection: BackgroundChoice; busy: boolean; upload?: string } | null>(null);

  useEffect(() => {
    if (!connected || !participant) return;
    const state = { session: new BackgroundEffectSession(BackgroundProcessor), selection: NO_BACKGROUND, busy: false, upload: undefined as string | undefined };
    active.current = state;
    queueMicrotask(() => {
      if (active.current === state) { setSelection(NO_BACKGROUND); setPending(false); setError(null); }
    });
    const reapply = () => {
      const track = participant.getTrackPublication(Track.Source.Camera)?.track as LocalVideoTrack | undefined;
      if (!track || state.selection.id === 'none' || state.busy) return;
      state.busy = true; setPending(true);
      void state.session.apply(track, state.selection).catch(() => {
        if (active.current !== state) return;
        state.selection = NO_BACKGROUND; setSelection(NO_BACKGROUND);
        setError('Latar kamera gagal dipulihkan. Pilih ulang efek kamera.');
      }).finally(() => { state.busy = false; if (active.current === state) setPending(false); });
    };
    participant.on?.(ParticipantEvent.LocalTrackPublished, reapply);
    return () => {
      participant.off?.(ParticipantEvent.LocalTrackPublished, reapply);
      active.current = null;
      void state.session.close().catch(() => {}).finally(() => { if (state.upload) URL.revokeObjectURL(state.upload); });
    };
  }, [participant, connected]);

  const selectBackground = useCallback(async (choice: BackgroundChoice, file?: File) => {
    if (!blurSupported) { setError('Perangkat atau browser ini belum mendukung efek latar belakang.'); return; }
    const state = active.current;
    if (!state || !isCameraEnabled || state.busy) return;
    const track = participant?.getTrackPublication(Track.Source.Camera)?.track as LocalVideoTrack | undefined;
    if (!track) { setError('Nyalakan kamera sebelum memilih latar belakang.'); return; }
    state.busy = true; setPending(true); setError(null);
    let candidate: string | undefined, applying = false;
    try {
      if (file) {
        validateBackgroundFile(file);
        candidate = URL.createObjectURL(file);
        const image = new Image(); image.src = candidate;
        await image.decode();
        if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 4096 || image.naturalHeight > 4096) throw new Error('Resolusi gambar maksimal 4096 × 4096 piksel.');
        choice = { id: 'upload', label: 'Gambar sendiri', imagePath: candidate };
      }
      if (active.current !== state) return;
      applying = true;
      if (await state.session.apply(track, choice) && active.current === state) {
        if (state.upload && state.upload !== choice.imagePath) URL.revokeObjectURL(state.upload);
        state.upload = candidate || (choice.imagePath === state.upload ? state.upload : undefined);
        candidate = undefined;
        state.selection = choice; setSelection(choice);
      }
    } catch (error) {
      if (active.current === state) {
        if (applying) { state.selection = NO_BACKGROUND; setSelection(NO_BACKGROUND); }
        setError(error instanceof Error ? `Gagal menerapkan latar: ${error.message}` : 'Gagal menerapkan latar kamera.');
      }
    } finally {
      if (candidate) URL.revokeObjectURL(candidate);
      state.busy = false;
      if (active.current === state) setPending(false);
    }
  }, [participant, isCameraEnabled, blurSupported]);
  const clearBlurError = useCallback(() => setError(null), []);
  const toggleBlur = useCallback(() => selectBackground(selection.id === 'blur' ? NO_BACKGROUND : BLUR_BACKGROUND), [selection.id, selectBackground]);
  return { selection: connected ? selection : NO_BACKGROUND, selectBackground, isBlurEnabled: connected && selection.id === 'blur', blurPending, blurSupported, blurError, toggleBlur, clearBlurError };
}
export type BackgroundBlurControl = ReturnType<typeof useBackgroundBlur>;
