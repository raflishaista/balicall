import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  routeToHash,
  hashToRoute,
  isSameRoute,
  sanitizeRouteForGuest,
  sanitizeRouteForUser,
  syncBrowserHistory,
  SETTINGS_SECTIONS,
} from '../src/navigation.ts';

test('routeToHash generates correct hashes for all main views', () => {
  assert.equal(routeToHash({ view: 'home' }), '#/home');
  assert.equal(routeToHash({ view: 'schedule' }), '#/schedule');
  assert.equal(routeToHash({ view: 'recordings' }), '#/recordings');
  assert.equal(routeToHash({ view: 'recordings', recordingId: 'rec-123' }), '#/recordings/rec-123');
  assert.equal(routeToHash({ view: 'summary' }), '#/summary');
  assert.equal(routeToHash({ view: 'summary', meetingId: 'meet 456' }), '#/summary/meet%20456');
  assert.equal(routeToHash({ view: 'lobby', intent: 'create' }), '#/lobby?intent=create');
  assert.equal(routeToHash({ view: 'lobby', intent: 'join' }), '#/lobby?intent=join');
  assert.equal(routeToHash({ view: 'in-call' }), '#/call');
  assert.equal(routeToHash({ view: 'in-call', meetingId: 'call-789' }), '#/call/call-789');
});

test('routeToHash formats settings sections correctly', () => {
  assert.equal(routeToHash({ view: 'settings' }), '#/settings');
  assert.equal(routeToHash({ view: 'settings', section: 'overview' }), '#/settings');
  assert.equal(routeToHash({ view: 'settings', section: 'devices' }), '#/settings/devices');
  assert.equal(routeToHash({ view: 'settings', section: 'display' }), '#/settings/display');
  assert.equal(routeToHash({ view: 'settings', section: 'notifications' }), '#/settings/notifications');
  assert.equal(routeToHash({ view: 'settings', section: 'ai' }), '#/settings/ai');
  assert.equal(routeToHash({ view: 'settings', section: 'storage' }), '#/settings/storage');
  assert.equal(routeToHash({ view: 'settings', section: 'security' }), '#/settings/security');
  assert.equal(routeToHash({ view: 'settings', section: 'profile' }), '#/settings/profile');
});

test('admin sidebar routes preserve the section and keep the overview URL', () => {
  const employees = { view: 'admin', adminSection: 'employees' };
  assert.deepEqual(hashToRoute(routeToHash(employees)), employees);
  const recordings = { view: 'admin', adminSection: 'recordings' };
  assert.equal(routeToHash(recordings), '#/admin/recordings');
  assert.deepEqual(hashToRoute('#/admin/recordings'), recordings);
  assert.deepEqual(hashToRoute('#/recordings'), { view: 'recordings', recordingId: null });
  assert.equal(routeToHash({ view: 'admin', adminSection: 'overview' }), '#/admin');
  assert.deepEqual(hashToRoute('#/admin/unknown'), { view: 'admin' });
  assert.equal(isSameRoute(employees, { view: 'admin', adminSection: 'audit' }), false);
  assert.equal(isSameRoute({ view: 'admin' }, { view: 'admin', adminSection: 'overview' }), true);
  assert.deepEqual(sanitizeRouteForGuest(employees, true), { view: 'lobby', intent: 'join' });
});

test('meeting invitations prefill a valid room code only on the join route', () => {
  const invite = { view: 'lobby', intent: 'join', roomCode: 'N0C26' };
  assert.deepEqual(hashToRoute(routeToHash(invite)), invite);
  assert.deepEqual(hashToRoute('#/lobby?intent=join&code=n0c26'), invite);
  assert.equal(hashToRoute('#/lobby?intent=create&code=N0C26').roomCode, undefined);
  assert.equal(hashToRoute('#/lobby?intent=join&code=bad%2Fcode').roomCode, undefined);
  assert.equal(isSameRoute(invite, { ...invite, roomCode: 'N0C27' }), false);
});

test('hashToRoute parses top-level and nested hashes accurately', () => {
  assert.deepEqual(hashToRoute(''), { view: 'home' });
  assert.deepEqual(hashToRoute('#'), { view: 'home' });
  assert.deepEqual(hashToRoute('#/'), { view: 'home' });
  assert.deepEqual(hashToRoute('#/home'), { view: 'home' });
  assert.deepEqual(hashToRoute('#schedule'), { view: 'schedule' });
  assert.deepEqual(hashToRoute('#/schedule'), { view: 'schedule' });

  // Settings
  assert.deepEqual(hashToRoute('#/settings'), { view: 'settings', section: 'overview' });
  assert.deepEqual(hashToRoute('#/settings/storage'), { view: 'settings', section: 'storage' });
  assert.deepEqual(hashToRoute('#/settings/security'), { view: 'settings', section: 'security' });
  assert.deepEqual(hashToRoute('#/settings/unknown'), { view: 'settings', section: 'overview' });

  // Summary
  assert.deepEqual(hashToRoute('#/summary'), { view: 'summary', meetingId: null });
  assert.deepEqual(hashToRoute('#/summary/room-101'), { view: 'summary', meetingId: 'room-101' });
  assert.deepEqual(hashToRoute('#/summary/room%20101'), { view: 'summary', meetingId: 'room 101' });

  // Recordings
  assert.deepEqual(hashToRoute('#/recordings'), { view: 'recordings', recordingId: null });
  assert.deepEqual(hashToRoute('#/recordings/rec-99'), { view: 'recordings', recordingId: 'rec-99' });

  // Lobby
  assert.deepEqual(hashToRoute('#/lobby'), { view: 'lobby', intent: 'create' });
  assert.deepEqual(hashToRoute('#/lobby?intent=join'), { view: 'lobby', intent: 'join' });
  assert.deepEqual(hashToRoute('#/lobby/join'), { view: 'lobby', intent: 'join' });

  // Call
  assert.deepEqual(hashToRoute('#/call'), { view: 'in-call', meetingId: null });
  assert.deepEqual(hashToRoute('#/call/m-42'), { view: 'in-call', meetingId: 'm-42' });
});

test('hashToRoute ignores skip link and retains fallback', () => {
  const fallback = { view: 'settings', section: 'ai' };
  assert.deepEqual(hashToRoute('#main-content', fallback), fallback);
});

test('isSameRoute detects matching and differing routes', () => {
  assert.equal(isSameRoute({ view: 'home' }, { view: 'home' }), true);
  assert.equal(isSameRoute({ view: 'home' }, { view: 'schedule' }), false);
  assert.equal(
    isSameRoute({ view: 'settings', section: 'storage' }, { view: 'settings', section: 'storage' }),
    true
  );
  assert.equal(
    isSameRoute({ view: 'settings', section: 'overview' }, { view: 'settings' }),
    true
  );
  assert.equal(
    isSameRoute({ view: 'settings', section: 'storage' }, { view: 'settings', section: 'ai' }),
    false
  );
  assert.equal(
    isSameRoute({ view: 'summary', meetingId: 'm1' }, { view: 'summary', meetingId: 'm1' }),
    true
  );
  assert.equal(
    isSameRoute({ view: 'summary', meetingId: 'm1' }, { view: 'summary', meetingId: 'm2' }),
    false
  );
});

test('sanitizeRouteForGuest restricts guest navigation safely', () => {
  // Non-guest is unrestricted
  assert.deepEqual(
    sanitizeRouteForGuest({ view: 'schedule' }, false),
    { view: 'schedule' }
  );

  // Guest cannot access schedule or summary
  assert.deepEqual(
    sanitizeRouteForGuest({ view: 'schedule' }, true),
    { view: 'lobby', intent: 'join' }
  );
  assert.deepEqual(
    sanitizeRouteForGuest({ view: 'summary' }, true),
    { view: 'lobby', intent: 'join' }
  );

  // Guest can access allowed settings and call
  assert.deepEqual(
    sanitizeRouteForGuest({ view: 'settings', section: 'devices' }, true),
    { view: 'settings', section: 'devices' }
  );
  assert.deepEqual(
    sanitizeRouteForGuest({ view: 'in-call', meetingId: 'abc' }, true),
    { view: 'in-call', meetingId: 'abc' }
  );
});

test('sanitizeRouteForUser restricts admin navigation for normal users and guests safely', () => {
  const adminRoute = { view: 'admin', adminSection: 'requests' };
  // Normal employee cannot access admin route -> redirected to home
  assert.deepEqual(
    sanitizeRouteForUser(adminRoute, { isSuperAdmin: false }),
    { view: 'home' }
  );
  assert.deepEqual(
    sanitizeRouteForUser(adminRoute, null),
    { view: 'home' }
  );

  // Super admin can access admin route
  assert.deepEqual(
    sanitizeRouteForUser(adminRoute, { isSuperAdmin: true }),
    adminRoute
  );

  // Guest is restricted to guest flow
  assert.deepEqual(
    sanitizeRouteForUser(adminRoute, { isGuest: true }),
    { view: 'lobby', intent: 'join' }
  );

  // Normal employee can access other views normally
  assert.deepEqual(
    sanitizeRouteForUser({ view: 'schedule' }, { isSuperAdmin: false }),
    { view: 'schedule' }
  );
  assert.deepEqual(
    sanitizeRouteForUser({ view: 'summary', meetingId: 'm1' }, { isSuperAdmin: false }),
    { view: 'summary', meetingId: 'm1' }
  );
});

test('syncBrowserHistory updates pushState and replaceState appropriately', () => {
  let calls = [];
  globalThis.window = {
    location: { hash: '#/home' },
    history: {
      state: null,
      pushState(state, title, url) {
        calls.push({ method: 'pushState', state, url });
        window.location.hash = url;
        window.history.state = state;
      },
      replaceState(state, title, url) {
        calls.push({ method: 'replaceState', state, url });
        window.location.hash = url;
        window.history.state = state;
      },
    },
  };

  // Navigating to new route pushes history
  syncBrowserHistory({ view: 'settings', section: 'storage' }, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'pushState');
  assert.equal(calls[0].url, '#/settings/storage');
  assert.equal(window.location.hash, '#/settings/storage');

  // Same route does not push duplicate
  syncBrowserHistory({ view: 'settings', section: 'storage' }, false);
  assert.equal(calls.length, 1);

  // Replace mode uses replaceState
  syncBrowserHistory({ view: 'schedule' }, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].method, 'replaceState');
  assert.equal(calls[1].url, '#/schedule');
});


test('documentation participates in browser history', () => {
  assert.equal(routeToHash({view:'documentation'}), '#/documentation');
  assert.deepEqual(hashToRoute('#/documentation'), {view:'documentation'});
});
