export const SPEAKER_SETTLE_MS = 600;
export const SPEAKER_HOLD_MS = 1200;

// Select on speaking membership changes, not the fluctuating loudness order.
// Timer/clock injection lets tests verify hysteresis without wall-clock sleeps.
export function createSpeakerSpotlight(initialParticipants: string[], options: {
  settleMs?: number; holdMs?: number; now?: () => number;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
} = {}) {
  const now = options.now || Date.now;
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const settleMs = options.settleMs ?? SPEAKER_SETTLE_MS;
  const holdMs = options.holdMs ?? SPEAKER_HOLD_MS;
  let roster = [...new Set(initialParticipants.filter(Boolean))];
  let spotlight: string | null = roster[0] || null;
  let active = new Set<string>();
  let rank = 0;
  const started = new Map<string, number>();
  let history: string[] = [];
  let lastSwitch = -Infinity;
  let connected = true;
  let pending: { id: string; since: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  const cancel = () => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined; pending = null;
  };
  const remember = (id: string) => { history = [id, ...history.filter(previous => previous !== id)]; };
  const promote = (id: string | null) => {
    if (spotlight === id) return;
    spotlight = id; lastSwitch = now();
    listeners.forEach(listener => listener());
  };
  const plan = () => {
    if (!connected) { cancel(); return; }
    const candidate = [...active].filter(id => roster.includes(id)).sort((a, b) => (started.get(b) || 0) - (started.get(a) || 0))[0];
    if (!candidate || candidate === spotlight) {
      cancel();
      if (candidate) remember(candidate);
      return;
    }
    if (pending?.id !== candidate) { cancel(); pending = { id: candidate, since: now() }; }
    const delay = Math.max(pending.since + settleMs - now(), lastSwitch + holdMs - now());
    if (delay <= 0) {
      cancel(); remember(candidate); promote(candidate);
    } else if (timer === undefined) {
      timer = setTimer(() => { timer = undefined; plan(); }, delay);
    }
  };

  return {
    getSnapshot: () => spotlight,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    updateParticipants(ids: string[]) {
      const current = new Set(ids.filter(Boolean));
      // Retain existing arrival order even if an observer returns a new order.
      roster = [...roster.filter(id => current.has(id)), ...[...current].filter(id => !roster.includes(id))];
      history = history.filter(id => current.has(id));
      [...started.keys()].forEach(id => { if (!current.has(id)) started.delete(id); });
      active = new Set([...active].filter(id => current.has(id)));
      if (!spotlight || !current.has(spotlight)) {
        cancel(); promote(history[0] || roster[0] || null);
        // Roster fallback should not delay the first real speaker.
        lastSwitch = -Infinity;
      }
      plan();
    },
    updateSpeakers(ids: string[]) {
      const next = new Set(connected ? ids.filter(id => roster.includes(id)) : []);
      // Speakers starting in the same event use the SDK's first speaker as tie-break.
      [...next].filter(id => !active.has(id)).reverse().forEach(id => started.set(id, ++rank));
      active = next; plan();
    },
    setConnected(value: boolean) {
      if (connected === value) return;
      connected = value;
      if (!value) { active.clear(); cancel(); }
    },
  };
}
