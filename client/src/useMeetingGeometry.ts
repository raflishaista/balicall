import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

export function useMeasuredBox<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, ...size };
}

const compactQuery = '(max-width: 1024px)';
function subscribeCompact(callback: () => void) {
  const query = matchMedia(compactQuery);
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}
export function useCompactMeeting() {
  return useSyncExternalStore(subscribeCompact, () => matchMedia(compactQuery).matches, () => false);
}
