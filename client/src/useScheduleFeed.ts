import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from './api.ts';
import type { ScheduledMeeting } from './ScheduleView';

// Without server events, refresh only the schedule feed, never media/transcripts.
export function useScheduleFeed() {
  const [schedules, setSchedules] = useState<ScheduledMeeting[]>([]);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState(false);
  const lifecycle = useRef({ controller: null as AbortController | null, generation: 0 });
  const refresh = useCallback(() => {
    const state = lifecycle.current;
    state.controller?.abort();
    const abort = new AbortController();
    state.controller = abort;
    const current = ++state.generation;
    return apiRequest<{ schedules: ScheduledMeeting[] }>('/schedules', { signal: abort.signal }, 10000).then(data => {
      if (!Array.isArray(data.schedules)) throw new Error('Invalid schedule feed');
      if (!abort.signal.aborted && current === state.generation) {
        setSchedules(data.schedules); setAvailable(true); setError(false);
      }
    }).catch(() => {
      if (!abort.signal.aborted && current === state.generation) { setAvailable(false); setError(true); }
    });
  }, []);
  const update = useCallback((apply: (previous: ScheduledMeeting[]) => ScheduledMeeting[]) => {
    ++lifecycle.current.generation;
    lifecycle.current.controller?.abort();
    setSchedules(apply);
  }, []);
  useEffect(() => {
    const state = lifecycle.current;
    const refreshVisible = () => { if (document.visibilityState !== 'hidden') void refresh(); };
    void refresh();
    const timer = setInterval(refreshVisible, 30000);
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      ++state.generation; state.controller?.abort(); clearInterval(timer);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [refresh]);
  return { schedules, update, available, error, refresh };
}
