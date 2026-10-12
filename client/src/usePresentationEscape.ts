import {useEffect, useEffectEvent} from 'react';

export function usePresentationEscape(enabled: boolean, onExit: () => void) {
  const exit = useEffectEvent(onExit);
  useEffect(() => {
    if (!enabled) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.repeat || event.isComposing) return;
      // Native fullscreen and open overlays own the first Escape, including
      // device dialogs rendered outside the meeting element.
      if (document.fullscreenElement || document.querySelector('dialog[open], #meeting-more-options:not([hidden])')) return;
      event.preventDefault();
      exit();
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [enabled]);
}
