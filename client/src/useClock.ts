import { useEffect, useState } from 'react';

// Supplying a fixed epoch keeps seeded forms deterministic (including tests).
export function useClock(fixedEpoch?: number) {
  const [epoch, setEpoch] = useState(() => fixedEpoch ?? Date.now());
  useEffect(() => {
    if (fixedEpoch !== undefined || typeof window === 'undefined' || typeof document === 'undefined') return;
    const update = () => setEpoch(Date.now());
    const timer = setInterval(update, 1000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [fixedEpoch]);
  return fixedEpoch ?? epoch;
}
