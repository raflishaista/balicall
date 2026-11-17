import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

test('AdminLiveMeetingMonitor displays KPI metrics, meeting table, and handles observer session requests', async t => {
  const originalGlobals = {
    IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
    document: globalThis.document,
    window: globalThis.window,
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const document = new EventTarget();
  document.visibilityState = 'visible';
  globalThis.document = document;
  globalThis.window = { setInterval, clearInterval };

  let root;
  t.after(async () => {
    if (root) await act(async () => root.unmount());
    Object.assign(globalThis, originalGlobals);
  });

  const mockMeetings = [
    {
      id: 'm-live-001',
      title: 'Executive Board Strategy',
      hostName: 'Director Utama',
      hostId: 'BT-00001',
      participantCount: 4,
      startedAt: '2026-11-17T06:00:00Z',
      durationSeconds: 1800,
      status: 'active',
      livekitRoom: 'board-strat',
      observerCount: 0,
    },
  ];

  const mockKpis = {
    activeMeetings: 1,
    totalParticipants: 4,
    activeHosts: 1,
    averageDurationSeconds: 1800,
    connectionHealth: 'healthy',
  };

  let observerRequestMade = null;
  let enteredObserverMode = null;

  const apiRequest = async (path, options = {}) => {
    if (path === '/admin/access') {
      return { permissions: ['meetings:read', 'system:read', 'audit:read'], role: 'super_admin' };
    }
    if (path === '/admin/live-monitor') {
      return {
        summary: mockKpis,
        meetings: mockMeetings,
        checkedAt: '2026-11-17T06:30:00Z',
      };
    }
    if (path === '/admin/observer/sessions' && options.method === 'POST') {
      observerRequestMade = JSON.parse(options.body);
      return {
        success: true,
        observerId: 'obs-uuid-1234',
        meetingId: 'm-live-001',
        token: 'mock.livekit.token',
        session: {
          observerId: 'obs-uuid-1234',
          meetingId: 'm-live-001',
          accessReason: observerRequestMade.accessReason,
        },
      };
    }
    throw new Error(`Unexpected request path: ${path}`);
  };

  const modules = {
    react: React,
    'react/jsx-runtime': jsx,
    './api': { apiRequest, ApiError: Error },
    './AdminDashboard.css': {},
    './AdminEmployeeActions': {},
    'lucide-react': new Proxy({}, { get: () => () => null }),
  };

  const source = readFileSync(new URL('../src/AdminDashboard.tsx', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });

  const exports = {};
  new Function('exports', 'require', outputText)(exports, name => modules[name]);

  await act(async () => {
    root = create(
      React.createElement(exports.default, {
        section: 'live-monitor',
        onEnterObserverMode: session => {
          enteredObserverMode = session;
        },
      })
    );
  });

  const jsonString = () => JSON.stringify(root.toJSON());

  // 1. Check KPI cards
  assert.match(jsonString(), /Active Meetings/);
  assert.match(jsonString(), /Total Participants/);
  assert.match(jsonString(), /Active Hosts/);
  assert.match(jsonString(), /Meeting Duration \(Avg\)/);
  assert.match(jsonString(), /Meeting Status/);
  assert.match(jsonString(), /Connection Health/);

  // 2. Check Table contents
  assert.match(jsonString(), /Executive Board Strategy/);
  assert.match(jsonString(), /Director Utama/);
  assert.match(jsonString(), /Request Observer Access/);

  // 3. Find and click "Request Observer Access" button
  const buttons = root.root.findAllByType('button');
  const monitorBtn = buttons.find(b => b.props.title === 'Minta akses pemantau pribadi');
  assert.ok(monitorBtn, 'Must find "Request Observer Access" action button');

  await act(async () => {
    monitorBtn.props.onClick();
  });

  // Modal should now be open
  assert.match(jsonString(), /Minta Akses Pemantau Pribadi/);
  assert.match(jsonString(), /Alasan Akses Pemantauan/);

  // Find form, textarea, checkbox, and submit
  const form = root.root.findByType('form');
  const textarea = root.root.findByType('textarea');
  const inputs = root.root.findAllByType('input');
  const checkbox = inputs.find(i => i.props.type === 'checkbox');
  assert.ok(checkbox, 'Must find compliance confirmation checkbox');

  await act(async () => {
    textarea.props.onChange({
      target: { value: 'Audit Kepatuhan ISO 27001 Tahunan dan Pemeriksaan SLA' },
    });
  });

  await act(async () => {
    checkbox.props.onChange({
      target: { checked: true },
    });
  });

  await act(async () => {
    form.props.onSubmit({ preventDefault: () => {} });
  });

  // Assert observer session was created via API and onEnterObserverMode was invoked
  assert.ok(observerRequestMade, 'API request to create observer session must be sent');
  assert.equal(observerRequestMade.meetingId, 'm-live-001');
  assert.equal(observerRequestMade.accessReason, 'Audit Kepatuhan ISO 27001 Tahunan dan Pemeriksaan SLA');

  assert.ok(enteredObserverMode, 'onEnterObserverMode callback must be invoked');
  assert.equal(enteredObserverMode.observerId, 'obs-uuid-1234');
  assert.equal(enteredObserverMode.token, 'mock.livekit.token');
  assert.equal(enteredObserverMode.meetingId, 'm-live-001');
});
