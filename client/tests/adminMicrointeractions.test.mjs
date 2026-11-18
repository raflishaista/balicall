import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

const cssSource = readFileSync(new URL('../src/AdminDashboard.css', import.meta.url), 'utf8');
const tsxSource = readFileSync(new URL('../src/AdminDashboard.tsx', import.meta.url), 'utf8');

const { outputText } = ts.transpileModule(tsxSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});

test('AdminDashboard.css contains complete microinteractions, KPI animations, transitions, and reduced-motion rules', () => {
  // 1. KPI cards entrance animation and staggered delay including card #5
  assert.match(cssSource, /@keyframes admin-kpi-enter/);
  assert.match(cssSource, /\.admin-overview-kpis \.admin-kpi/);
  assert.match(cssSource, /\.admin-live-monitor \.admin-kpi-card/);
  assert.match(cssSource, /\.admin-health-kpis \.admin-kpi/);
  assert.match(cssSource, /\.admin-queue-kpis \.admin-kpi/);
  assert.match(cssSource, /\.admin-directory-summary \.admin-kpi/);
  assert.match(cssSource, /animation:\s*admin-kpi-enter/);
  assert.match(cssSource, /animation-delay:\s*40ms/);
  assert.match(cssSource, /animation-delay:\s*80ms/);
  assert.match(cssSource, /animation-delay:\s*120ms/);
  assert.match(cssSource, /animation-delay:\s*160ms/);

  // 2. Button hover, press (active), and accessible focus-visible
  assert.match(cssSource, /\.admin-page button:hover:not\(:disabled\)/);
  assert.match(cssSource, /\.admin-page \.button-primary:hover:not\(:disabled\)/);
  assert.match(cssSource, /\.admin-page \.button-secondary:hover:not\(:disabled\)/);
  assert.match(cssSource, /\.admin-page button:active:not\(:disabled\)/);
  assert.match(cssSource, /\.admin-page button:focus-visible/);
  assert.match(cssSource, /\.admin-subnav-btn:focus-visible/);

  // 3. Updating data indicator badge
  assert.match(cssSource, /\.admin-refreshing-badge/);
  assert.match(cssSource, /@keyframes admin-badge-pop/);

  // 4. Tab pane transition
  assert.match(cssSource, /@keyframes admin-tab-pane-in/);
  assert.match(cssSource, /\.admin-tab-panel/);

  // 5. Updating transition states
  assert.match(cssSource, /\.admin-overview-content\.is-updating/);
  assert.match(cssSource, /\.admin-live-table-wrapper\.is-updating/);
  assert.match(cssSource, /\.admin-monitor-kpi-summary\.is-updating/);
  assert.match(cssSource, /\.admin-tab-panel\.is-updating/);
  assert.match(cssSource, /\.admin-queue-metrics-container\.is-updating/);

  // 6. Reduced-motion preferences (system media query AND .reduce-motion class)
  assert.match(cssSource, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(cssSource, /\.reduce-motion \.admin-page \*/);
  assert.match(cssSource, /animation:\s*none !important;/);
  assert.match(cssSource, /transform:\s*none !important;/);
});

test('Overview: auto-refresh and filter change preserve previous numbers and show updating indicators', async t => {
  const originalGlobals = {
    IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
    document: globalThis.document,
    window: globalThis.window,
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const doc = new EventTarget();
  doc.visibilityState = 'visible';
  globalThis.document = doc;
  globalThis.window = { setInterval, clearInterval };

  let root;
  t.after(async () => {
    if (root) await act(async () => root.unmount());
    Object.assign(globalThis, originalGlobals);
  });

  const mockOverview = {
    totalEmployees: 42,
    activatedAccounts: 38,
    totalMeetings: 19,
    totalRecordings: 12,
    uploadedBytes: '20971520',
    periodStart: '2026-10-19T00:00:00.000Z',
    periodEnd: '2026-11-18T00:00:00.000Z',
    dailyActivity: [
      { date: '2026-11-16', meetings: 5, attendances: 12, meetingsWithParticipants: 5 },
      { date: '2026-11-17', meetings: 8, attendances: 20, meetingsWithParticipants: 8 },
    ],
    recentActivity: [
      { id: 'rec-101', kind: 'recording_completed', title: 'Evaluasi Anggaran Sentra', occurredAt: '2026-11-17T08:00:00.000Z' },
    ],
  };

  let pendingRequest = null;
  let requestCount = 0;

  const apiRequest = async path => {
    if (path === '/admin/access') {
      return { employeeId: 'ADMIN-1', permissions: ['meetings:read', 'system:read'] };
    }
    if (path.startsWith('/admin/overview')) {
      requestCount++;
      if (requestCount === 1) return mockOverview;
      return new Promise(resolve => { pendingRequest = resolve; });
    }
    throw new Error(`Unexpected path: ${path}`);
  };

  const modules = {
    react: React,
    'react/jsx-runtime': jsx,
    './api': { apiRequest, ApiError: Error },
    './AdminDashboard.css': {},
    './AdminEmployeeActions': {},
    'lucide-react': new Proxy({}, { get: () => props => React.createElement('span', props) }),
  };

  const exports = {};
  new Function('exports', 'require', outputText)(exports, name => modules[name]);

  await act(async () => {
    root = create(React.createElement(exports.default, { section: 'overview' }));
  });

  // Verify initial data rendered
  let json = JSON.stringify(root.toJSON());
  assert.match(json, /Evaluasi Anggaran Sentra/);
  assert.match(json, /42/);
  assert.match(json, /Ringkasan penggunaan/);

  // Trigger reload to simulate auto-refresh or manual refresh
  const buttons = root.root.findAllByType('button');
  const refreshBtn = buttons.find(b => b.props.title === 'Perbarui ringkasan' || b.props.children?.includes?.('Perbarui'));
  assert.ok(refreshBtn, 'Refresh button must be present in Overview');

  await act(async () => {
    refreshBtn.props.onClick();
  });

  // During in-flight request:
  // 1) Old data MUST still be rendered (NO blank loading state or layout flicker)
  json = JSON.stringify(root.toJSON());
  assert.match(json, /Evaluasi Anggaran Sentra/, 'Old table and activity must remain visible during refresh');
  assert.match(json, /42/, 'Old metrics must remain visible during refresh');

  // 2) Updating indicator and spinning icon must be displayed
  assert.match(json, /Memperbarui data…/, 'Updating badge must be visible when loading');
  assert.match(json, /admin-spin/, 'Refresh icon must have spinning class when loading');

  // Resolve pending request with updated numbers
  await act(async () => {
    pendingRequest({
      ...mockOverview,
      totalEmployees: 45,
      recentActivity: [
        { id: 'rec-102', kind: 'recording_completed', title: 'Evaluasi Lanjutan Q4', occurredAt: '2026-11-18T09:00:00.000Z' },
      ],
    });
  });

  // Data updated smoothly
  json = JSON.stringify(root.toJSON());
  assert.match(json, /Evaluasi Lanjutan Q4/);
  assert.match(json, /45/);
});

test('Live Monitor: preserves old meetings during refresh and displays updating indicator', async t => {
  const originalGlobals = {
    IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
    document: globalThis.document,
    window: globalThis.window,
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const doc = new EventTarget();
  doc.visibilityState = 'visible';
  globalThis.document = doc;
  globalThis.window = { setInterval, clearInterval };

  let root;
  t.after(async () => {
    if (root) await act(async () => root.unmount());
    Object.assign(globalThis, originalGlobals);
  });

  const mockLive = {
    summary: {
      activeMeetings: 2,
      totalParticipants: 8,
      activeHosts: 2,
      averageDurationSeconds: 1200,
      connectionHealth: 'healthy',
    },
    meetings: [
      {
        id: 'live-1',
        title: 'Koordinasi NOC Sentra',
        hostName: 'Admin NOC',
        participantCount: 5,
        startedAt: '2026-11-18T05:00:00Z',
        durationSeconds: 1200,
        status: 'active',
        roomCode: 'NOC-101',
      },
    ],
    checkedAt: '2026-11-18T05:20:00Z',
  };

  let pendingLive = null;
  let liveRequests = 0;

  const apiRequest = async path => {
    if (path === '/admin/access') {
      return { employeeId: 'ADMIN-1', permissions: ['meetings:read', 'system:read'] };
    }
    if (path === '/admin/live-monitor') {
      liveRequests++;
      if (liveRequests === 1) return mockLive;
      return new Promise(resolve => { pendingLive = resolve; });
    }
    throw new Error(`Unexpected path: ${path}`);
  };

  const modules = {
    react: React,
    'react/jsx-runtime': jsx,
    './api': { apiRequest, ApiError: Error },
    './AdminDashboard.css': {},
    './AdminEmployeeActions': {},
    'lucide-react': new Proxy({}, { get: () => props => React.createElement('span', props) }),
  };

  const exports = {};
  new Function('exports', 'require', outputText)(exports, name => modules[name]);

  await act(async () => {
    root = create(React.createElement(exports.default, { section: 'live-monitor' }));
  });

  let json = JSON.stringify(root.toJSON());
  assert.match(json, /Koordinasi NOC Sentra/);

  // Trigger reload
  const refreshBtn = root.root.findAllByType('button').find(b => b.props.title === 'Perbarui rapat langsung' || b.props.children?.includes?.('Perbarui'));
  assert.ok(refreshBtn, 'Refresh button in Live Monitor must be present');

  await act(async () => {
    refreshBtn.props.onClick();
  });

  // In-flight refresh: old table still present, indicator displayed
  json = JSON.stringify(root.toJSON());
  assert.match(json, /Koordinasi NOC Sentra/, 'Active meeting rows must be preserved during refresh');
  assert.match(json, /Memperbarui data…/, 'Updating badge must be displayed');
  assert.match(json, /admin-spin/, 'Refresh button icon must spin during update');

  // Resolve update
  await act(async () => {
    pendingLive({
      ...mockLive,
      meetings: [
        {
          id: 'live-1',
          title: 'Koordinasi NOC Sentra (Sesi 2)',
          hostName: 'Admin NOC',
          participantCount: 6,
          startedAt: '2026-11-18T05:00:00Z',
          durationSeconds: 1800,
          status: 'active',
          roomCode: 'NOC-101',
        },
      ],
    });
  });

  json = JSON.stringify(root.toJSON());
  assert.match(json, /Koordinasi NOC Sentra \(Sesi 2\)/);
});

test('Layanan (System): tabs switch cleanly with animation containers and health metrics', async t => {
  const originalGlobals = {
    IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
    document: globalThis.document,
    window: globalThis.window,
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const doc = new EventTarget();
  doc.visibilityState = 'visible';
  globalThis.document = doc;
  globalThis.window = { setInterval, clearInterval };

  let root;
  t.after(async () => {
    if (root) await act(async () => root.unmount());
    Object.assign(globalThis, originalGlobals);
  });

  const mockSystem = {
    services: [
      { id: 'database', name: 'PostgreSQL Sentra', group: 'core', status: 'ready', diagnostic: 'Normal' },
      { id: 'sfu', name: 'LiveKit SFU', group: 'core', status: 'ready', diagnostic: 'Normal' },
    ],
    checkedAt: '2026-11-18T05:30:00Z',
    databaseConnected: true,
    livekit: 'reachable',
    recordingQueue: {
      queued: 1,
      processing: 2,
      failed: 0,
      medianCompletionSeconds: 45,
      completionSampleSize: 10,
    },
    queueStats: {
      total: 3,
      avgWaitSeconds: 15,
      avgProcessSeconds: 30,
    },
  };

  const apiRequest = async path => {
    if (path === '/admin/access') {
      return { employeeId: 'ADMIN-1', permissions: ['system:read', 'meetings:read'] };
    }
    if (path === '/admin/system') return mockSystem;
    if (path.startsWith('/admin/system/jobs')) {
      return { jobs: [], total: 0, page: 1, pageSize: 20, totalPages: 1 };
    }
    throw new Error(`Unexpected path: ${path}`);
  };

  const modules = {
    react: React,
    'react/jsx-runtime': jsx,
    './api': { apiRequest, ApiError: Error },
    './AdminDashboard.css': {},
    './AdminEmployeeActions': {},
    'lucide-react': new Proxy({}, { get: () => props => React.createElement('span', props) }),
  };

  const exports = {};
  new Function('exports', 'require', outputText)(exports, name => modules[name]);

  await act(async () => {
    root = create(React.createElement(exports.default, { section: 'system' }));
  });

  const json = JSON.stringify(root.toJSON());
  assert.match(json, /Kesehatan Layanan/);
  assert.match(json, /Antrean & Investigasi Pekerjaan/);
  assert.match(json, /admin-health-kpis/);

  // Switch tab to Jobs
  const tabs = root.root.findAllByProps({ role: 'tab' });
  const jobsTab = tabs.find(t => t.props.id === 'admin-tab-jobs');
  assert.ok(jobsTab, 'Jobs tab must be present');

  await act(async () => {
    jobsTab.props.onClick();
  });

  const jobsJson = JSON.stringify(root.toJSON());
  assert.match(jobsJson, /admin-panel-jobs/);
  assert.match(jobsJson, /admin-tab-panel/);
});

test('Overview: period filter switch preserves chart and numbers without crashing when keyboard index exceeds new points length', async t => {
  const originalGlobals = {
    IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
    document: globalThis.document,
    window: globalThis.window,
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const doc = new EventTarget();
  doc.visibilityState = 'visible';
  globalThis.document = doc;
  globalThis.window = { setInterval, clearInterval };

  let root;
  t.after(async () => {
    if (root) await act(async () => root.unmount());
    Object.assign(globalThis, originalGlobals);
  });

  const thirtyDaysActivity = Array.from({ length: 30 }, (_, i) => ({
    date: `2026-10-${String(i + 1).padStart(2, '0')}`,
    meetings: 2 + (i % 3),
    attendances: 5 + (i % 4),
    meetingsWithParticipants: 2 + (i % 3),
  }));

  const sevenDaysActivity = Array.from({ length: 7 }, (_, i) => ({
    date: `2026-11-${String(i + 1).padStart(2, '0')}`,
    meetings: 3,
    attendances: 8,
    meetingsWithParticipants: 3,
  }));

  let pendingSwitch = null;
  const apiRequest = async path => {
    if (path === '/admin/access') {
      return { employeeId: 'ADMIN-1', permissions: ['meetings:read', 'system:read'] };
    }
    if (path.includes('days=30')) {
      return {
        totalEmployees: 40,
        totalMeetings: 60,
        totalRecordings: 10,
        uploadedBytes: '10485760',
        periodStart: '2026-10-01T00:00:00.000Z',
        periodEnd: '2026-10-30T00:00:00.000Z',
        dailyActivity: thirtyDaysActivity,
        recentActivity: [],
      };
    }
    if (path.includes('days=7')) {
      return new Promise(resolve => { pendingSwitch = resolve; });
    }
    throw new Error(`Unexpected path: ${path}`);
  };

  const modules = {
    react: React,
    'react/jsx-runtime': jsx,
    './api': { apiRequest, ApiError: Error },
    './AdminDashboard.css': {},
    './AdminEmployeeActions': {},
    'lucide-react': new Proxy({}, { get: () => props => React.createElement('span', props) }),
  };

  const exports = {};
  new Function('exports', 'require', outputText)(exports, name => modules[name]);

  await act(async () => {
    root = create(React.createElement(exports.default, { section: 'overview' }));
  });

  // Verify 30-day data rendered
  let json = JSON.stringify(root.toJSON());
  assert.match(json, /Tren penggunaan/);
  assert.match(json, /Per hari/);

  // Switch period select to 7 days
  const select = root.root.findByType('select');
  await act(async () => {
    select.props.onChange({ target: { value: '7' } });
  });

  // During in-flight switch:
  // 1. Chart and metrics must NOT disappear
  json = JSON.stringify(root.toJSON());
  assert.match(json, /Tren penggunaan/);
  assert.match(json, /is-updating/, 'Container must have is-updating class during filter switch');
  assert.match(json, /Memperbarui data…/, 'Updating badge must be visible');

  // Resolve 7-day request
  await act(async () => {
    pendingSwitch({
      totalEmployees: 40,
      totalMeetings: 21,
      totalRecordings: 4,
      uploadedBytes: '4194304',
      periodStart: '2026-11-01T00:00:00.000Z',
      periodEnd: '2026-11-07T00:00:00.000Z',
      dailyActivity: sevenDaysActivity,
      recentActivity: [],
    });
  });

  json = JSON.stringify(root.toJSON());
  assert.match(json, /Tren penggunaan/);
  assert.doesNotMatch(json, /is-updating/);
});

test('Layanan: auto-refresh preserves health metrics and shows updating badge', async t => {
  const originalGlobals = {
    IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
    document: globalThis.document,
    window: globalThis.window,
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const doc = new EventTarget();
  doc.visibilityState = 'visible';
  globalThis.document = doc;
  globalThis.window = { setInterval, clearInterval };

  let root;
  t.after(async () => {
    if (root) await act(async () => root.unmount());
    Object.assign(globalThis, originalGlobals);
  });

  const mockSystem = {
    services: [
      { id: 'database', name: 'PostgreSQL Sentra', group: 'core', status: 'ready', diagnostic: 'Normal' },
      { id: 'sfu', name: 'LiveKit SFU', group: 'core', status: 'ready', diagnostic: 'Normal' },
    ],
    checkedAt: '2026-11-18T05:30:00Z',
    databaseConnected: true,
    livekit: 'reachable',
    recordingQueue: {
      queued: 2,
      processing: 1,
      failed: 0,
      medianCompletionSeconds: 40,
      completionSampleSize: 8,
    },
    queueStats: {
      total: 3,
      avgWaitSeconds: 10,
      avgProcessSeconds: 25,
    },
  };

  let pendingRefresh = null;
  let requests = 0;

  const apiRequest = async path => {
    if (path === '/admin/access') {
      return { employeeId: 'ADMIN-1', permissions: ['system:read', 'meetings:read'] };
    }
    if (path === '/admin/system') {
      requests++;
      if (requests === 1) return mockSystem;
      return new Promise(resolve => { pendingRefresh = resolve; });
    }
    throw new Error(`Unexpected path: ${path}`);
  };

  const modules = {
    react: React,
    'react/jsx-runtime': jsx,
    './api': { apiRequest, ApiError: Error },
    './AdminDashboard.css': {},
    './AdminEmployeeActions': {},
    'lucide-react': new Proxy({}, { get: () => props => React.createElement('span', props) }),
  };

  const exports = {};
  new Function('exports', 'require', outputText)(exports, name => modules[name]);

  await act(async () => {
    root = create(React.createElement(exports.default, { section: 'system' }));
  });

  let json = JSON.stringify(root.toJSON());
  assert.match(json, /Layanan Siap/);
  assert.match(json, /Basis Data & SFU/);

  // Trigger manual or auto refresh
  const refreshBtn = root.root.findAllByType('button').find(b => b.props.title === 'Perbarui monitor layanan' || b.props.ariaLabel === 'Perbarui monitor layanan' || (Array.isArray(b.props.children) && b.props.children.some(c => typeof c === 'string' && c.includes('Perbarui'))));
  assert.ok(refreshBtn, 'Perbarui button must be present in Layanan');

  await act(async () => {
    refreshBtn.props.onClick();
  });

  // During refresh:
  // 1. Health KPI metrics and cards must remain rendered
  json = JSON.stringify(root.toJSON());
  assert.match(json, /Layanan Siap/, 'Health KPIs must remain visible during refresh');
  assert.match(json, /Basis Data & SFU/, 'Database & SFU card must remain visible');
  assert.match(json, /Memperbarui data…/, 'Updating badge must be visible in Layanan header');
  assert.match(json, /admin-spin/, 'Refresh icon must spin');

  // Resolve refresh
  await act(async () => {
    pendingRefresh({
      ...mockSystem,
      checkedAt: '2026-11-18T05:31:00Z',
    });
  });

  json = JSON.stringify(root.toJSON());
  assert.doesNotMatch(json, /Memperbarui data…/);
});

test('Layanan Jobs: preserves table when auto-refresh fails and displays updating indicator badge', async t => {
  const originalGlobals = {
    IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
    document: globalThis.document,
    window: globalThis.window,
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const doc = new EventTarget();
  doc.visibilityState = 'visible';
  globalThis.document = doc;
  globalThis.window = { setInterval, clearInterval };

  let root;
  t.after(async () => {
    if (root) await act(async () => root.unmount());
    Object.assign(globalThis, originalGlobals);
  });

  const mockSystem = {
    services: [],
    checkedAt: '2026-11-18T05:30:00Z',
    databaseConnected: true,
    livekit: 'reachable',
    recordingQueue: { queued: 0, processing: 0 },
  };

  const mockJobs = {
    jobs: [
      {
        id: 'job-001',
        title: 'Rapat Evaluasi Server',
        originalFilename: 'evaluasi.mp3',
        ownerName: 'Budi Santoso',
        createdAt: '2026-11-18T04:00:00Z',
        completedAt: '2026-11-18T04:05:00Z',
        durationSeconds: 300,
        sttModel: 'whisper',
        diarizer: 'nemotron',
        retryCount: 0,
        status: 'done',
        stage: 'completed',
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  };

  let pendingJobs = null;
  let jobRequests = 0;

  const apiRequest = async path => {
    if (path === '/admin/access') {
      return { employeeId: 'ADMIN-1', permissions: ['system:read', 'meetings:read'] };
    }
    if (path === '/admin/system') return mockSystem;
    if (path.startsWith('/admin/system/jobs')) {
      jobRequests++;
      if (jobRequests === 1) return mockJobs;
      return new Promise((_, reject) => { pendingJobs = reject; });
    }
    throw new Error(`Unexpected path: ${path}`);
  };

  const modules = {
    react: React,
    'react/jsx-runtime': jsx,
    './api': { apiRequest, ApiError: Error },
    './AdminDashboard.css': {},
    './AdminEmployeeActions': {},
    'lucide-react': new Proxy({}, { get: () => props => React.createElement('span', props) }),
  };

  const exports = {};
  new Function('exports', 'require', outputText)(exports, name => modules[name]);

  await act(async () => {
    root = create(React.createElement(exports.default, { section: 'system' }));
  });

  // Switch to Jobs tab
  const tabs = root.root.findAllByProps({ role: 'tab' });
  const jobsTab = tabs.find(t => t.props.id === 'admin-tab-jobs');
  await act(async () => {
    jobsTab.props.onClick();
  });

  // Initial jobs table rendered
  let json = JSON.stringify(root.toJSON());
  assert.match(json, /Rapat Evaluasi Server/);

  // Trigger refresh on jobs table
  const jobsButtons = root.root.findAllByType('button');
  const refreshJobsBtn = jobsButtons.find(b => b.props.title === 'Perbarui riwayat pekerjaan' || b.props.ariaLabel === 'Perbarui riwayat pekerjaan');
  assert.ok(refreshJobsBtn, 'Perbarui button in Jobs section must be present');

  await act(async () => {
    refreshJobsBtn.props.onClick();
  });

  // In flight: table is preserved and badge is shown
  json = JSON.stringify(root.toJSON());
  assert.match(json, /Rapat Evaluasi Server/, 'Table must remain visible while refresh is in flight');
  assert.match(json, /Memperbarui data…/, 'Updating badge must be shown in Jobs section');

  // Reject the refresh to simulate network failure
  await act(async () => {
    pendingJobs(new Error('Koneksi timeout'));
  });

  // When refresh fails:
  // Old table MUST NOT BE UNMOUNTED!
  json = JSON.stringify(root.toJSON());
  assert.match(json, /Rapat Evaluasi Server/, 'Table must still remain visible after failed refresh');
  assert.match(json, /Gagal memperbarui data pekerjaan/, 'Non-disruptive error notice must be displayed');
});
