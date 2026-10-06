import { useCallback, useSyncExternalStore } from 'react';

export function useTrackUnavailable(track?: MediaStreamTrack) {
  const subscribe = useCallback((listener: () => void) => {
    track?.addEventListener('ended', listener);
    track?.addEventListener('mute', listener);
    track?.addEventListener('unmute', listener);
    return () => {
      track?.removeEventListener('ended', listener);
      track?.removeEventListener('mute', listener);
      track?.removeEventListener('unmute', listener);
    };
  }, [track]);
  return useSyncExternalStore(subscribe, () => !track || track.readyState === 'ended' || track.muted, () => true);
}
