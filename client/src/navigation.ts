export type AppView =
  | 'home'
  | 'lobby'
  | 'in-call'
  | 'summary'
  | 'schedule'
  | 'settings'
  | 'recordings'
  | 'documentation';

export type SettingsSection =
  | 'overview'
  | 'profile'
  | 'devices'
  | 'display'
  | 'notifications'
  | 'ai'
  | 'storage'
  | 'security';

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  'overview',
  'profile',
  'devices',
  'display',
  'notifications',
  'ai',
  'storage',
  'security',
] as const;

export interface RouteState {
  view: AppView;
  section?: SettingsSection;
  meetingId?: string | null;
  intent?: 'create' | 'join';
  recordingId?: string | null;
}

export function isSettingsSection(value: unknown): value is SettingsSection {
  return typeof value === 'string' && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

export function routeToHash(route: RouteState): string {
  switch (route.view) {
    case 'home':
      return '#/home';
    case 'schedule':
      return '#/schedule';
    case 'documentation':
      return '#/documentation';
    case 'settings':
      return route.section && route.section !== 'overview'
        ? `#/settings/${route.section}`
        : '#/settings';
    case 'summary':
      return route.meetingId
        ? `#/summary/${encodeURIComponent(route.meetingId)}`
        : '#/summary';
    case 'recordings':
      return route.recordingId
        ? `#/recordings/${encodeURIComponent(route.recordingId)}`
        : '#/recordings';
    case 'lobby':
      return route.intent === 'join' ? '#/lobby?intent=join' : '#/lobby?intent=create';
    case 'in-call':
      return route.meetingId ? `#/call/${encodeURIComponent(route.meetingId)}` : '#/call';
    case 'documentation':
      return '#/documentation';
    default:
      return '#/home';
  }
}

export function hashToRoute(hash: string, fallback?: RouteState): RouteState {
  if (!hash || hash === '#' || hash === '#/' || hash === '#/home' || hash === '#home') {
    return { view: 'home' };
  }

  // Preserve existing view if accessibility skip link or in-page anchor was targeted
  if (hash.startsWith('#main-content') || hash.startsWith('#skip')) {
    return fallback || { view: 'home' };
  }

  // Remove leading '#' and optional leading '/'
  const clean = hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = clean.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const primary = segments[0]?.toLowerCase();

  switch (primary) {
    case 'home':
      return { view: 'home' };

    case 'schedule':
      return { view: 'schedule' };

    case 'documentation':
      return { view: 'documentation' };

    case 'settings': {
      const section = segments[1]?.toLowerCase();
      return {
        view: 'settings',
        section: isSettingsSection(section) ? section : 'overview',
      };
    }

    case 'summary': {
      const meetingId = segments[1] ? decodeURIComponent(segments[1]) : null;
      return {
        view: 'summary',
        meetingId,
      };
    }

    case 'recordings': {
      const recordingId = segments[1] ? decodeURIComponent(segments[1]) : null;
      return {
        view: 'recordings',
        recordingId,
      };
    }

    case 'lobby': {
      let intent: 'create' | 'join' = 'create';
      if (segments[1] === 'join' || segments[1] === 'create') {
        intent = segments[1];
      } else if (queryPart) {
        const search = new URLSearchParams(queryPart);
        if (search.get('intent') === 'join') intent = 'join';
      }
      return {
        view: 'lobby',
        intent,
      };
    }

    case 'call': {
      const meetingId = segments[1] ? decodeURIComponent(segments[1]) : null;
      return {
        view: 'in-call',
        meetingId,
      };
    }

    case 'documentation':
      return { view: 'documentation' };

    default:
      return fallback || { view: 'home' };
  }
}

export function isSameRoute(a: RouteState, b: RouteState): boolean {
  if (a.view !== b.view) return false;
  if (a.view === 'settings') {
    return (a.section || 'overview') === (b.section || 'overview');
  }
  if (a.view === 'summary') {
    return (a.meetingId || null) === (b.meetingId || null);
  }
  if (a.view === 'recordings') {
    return (a.recordingId || null) === (b.recordingId || null);
  }
  if (a.view === 'lobby') {
    return (a.intent || 'create') === (b.intent || 'create');
  }
  if (a.view === 'in-call') {
    return (a.meetingId || null) === (b.meetingId || null);
  }
  return true;
}

export function sanitizeRouteForGuest(route: RouteState, isGuest: boolean): RouteState {
  if (!isGuest) return route;
  if (route.view === 'in-call') return route;
  if (route.view === 'settings') {
    return {
      view: 'settings',
      section: route.section === 'devices' || route.section === 'display' ? route.section : 'overview',
    };
  }
  return { view: 'lobby', intent: 'join' };
}

export function syncBrowserHistory(route: RouteState, replace = false): void {
  if (typeof window === 'undefined' || !window.history) return;
  const targetHash = routeToHash(route);
  if (window.location.hash !== targetHash) {
    if (replace) {
      window.history.replaceState(route, '', targetHash);
    } else {
      window.history.pushState(route, '', targetHash);
    }
  } else if (!window.history.state || !isSameRoute(window.history.state, route)) {
    window.history.replaceState(route, '', targetHash);
  }
}

