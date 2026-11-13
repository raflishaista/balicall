import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

test('meeting history renders summary cards, table columns, filter reset, and handles empty samples', async t => {
  const originalGlobals = {
    IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
    document: globalThis.document,
    window: globalThis.window,
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.document = new EventTarget();
  globalThis.window = { setInterval, clearInterval };
  let root;
  t.after(async () => {
    if (root) await act(async () => root.unmount());
    Object.assign(globalThis, originalGlobals);
  });

  const historyData = {
    total: 3,
    page: 1,
    pageSize: 20,
    summary: {
      totalEndedMeetings: 3,
      totalDurationSeconds: 7200,
      durationSamples: 2,
      averageParticipants: 4.5,
      participantSamples: 3,
    },
    meetings: [
      {
        id: 'mtg-01',
        title: 'Koordinasi Operasional',
        status: 'ended',
        createdAt: '2026-11-12T08:00:00.000Z',
        endedAt: '2026-11-12T09:00:00.000Z',
        startedAt: '2026-11-12T08:05:00.000Z',
        hostName: 'Budi Santoso',
        participantCount: 5,
        durationSeconds: 3300,
      },
      {
        id: 'mtg-02',
        title: 'Review Sprint',
        status: 'ended',
        createdAt: '2026-11-12T10:00:00.000Z',
        endedAt: '2026-11-12T11:05:00.000Z',
        startedAt: '2026-11-12T10:00:00.000Z',
        hostName: null,
        participantCount: 4,
        durationSeconds: 3900,
      },
      {
        id: 'mtg-03',
        title: 'Rapat Tanpa Waktu Selesai',
        status: 'ended',
        createdAt: '2026-11-12T13:00:00.000Z',
        endedAt: null,
        startedAt: null,
        hostName: 'Siti Aminah',
        participantCount: 0,
        durationSeconds: null,
      },
    ],
  };

  let requestedPath = '';
  const apiRequest = async path => {
    if (path === '/admin/access') return { permissions: ['meetings:read'] };
    if (path.startsWith('/admin/meetings/history')) {
      requestedPath = path;
      return historyData;
    }
    if (path === '/admin/meetings') {
      return { meetings: [], livekitStatus: 'reachable', checkedAt: new Date().toISOString() };
    }
    throw new Error(`Unexpected path: ${path}`);
  };

  const modules = {
    react: React,
    'react/jsx-runtime': jsx,
    './api': { apiRequest, ApiError: Error, API_BASE: '/api' },
    './AdminDashboard.css': {},
    './AdminEmployeeActions': { AdminEmployeeActions: () => null, default: () => null },
    'lucide-react': new Proxy({}, { get: () => () => null }),
  };

  const source = readFileSync(new URL('../src/AdminDashboard.tsx', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports = {};
  new Function('exports', 'require', outputText)(exports, name => modules[name]);

  await act(async () => {
    root = create(React.createElement(exports.default, { section: 'meetings' }));
  });

  // Switch to "Riwayat rapat" tab
  const buttons = root.root.findAllByType('button');
  const historyTabBtn = buttons.find(b => b.children.includes('Riwayat rapat'));
  assert.ok(historyTabBtn, 'Riwayat rapat tab button must exist');
  await act(async () => {
    historyTabBtn.props.onClick();
  });

  const json = JSON.stringify(root.toJSON());

  // 1. Verify 3 Summary Cards & Scope label
  assert.match(json, /Total rapat selesai/);
  assert.match(json, /3/);
  assert.match(json, /Total durasi/);
  assert.match(json, /2 jam 0 mnt/);
  assert.match(json, /Dari 2 rapat/);
  assert.match(json, /Rata-rata peserta/);
  assert.match(json, /4,5 orang/);
  assert.match(json, /Dari 3 rapat/);
  assert.match(json, /Angka ringkasan mengikuti filter yang diterapkan\./);

  // 2. Verify "Ekspor CSV" button
  assert.match(json, /Ekspor CSV/);

  // 3. Verify Table Columns
  assert.match(json, /Rapat/);
  assert.match(json, /Waktu \(WIB\)/);
  assert.match(json, /Host/);
  assert.match(json, /Peserta/);
  assert.match(json, /Durasi/);
  assert.match(json, /Status/);

  // 4. Verify Meeting Row Values
  assert.match(json, /Koordinasi Operasional/);
  assert.match(json, /Budi Santoso/);
  assert.match(json, /Belum tercatat/); // mtg-02 host is null
  assert.match(json, /Selesai/);
  assert.match(json, /55 mnt/);

  // 5. Test Filter Inputs and Submission
  const form = root.root.findByType('form');
  const searchInput = root.root.findByProps({ name: 'q' });
  const fromInput = root.root.findByProps({ name: 'from' });
  const toInput = root.root.findByProps({ name: 'to' });

  await act(async () => {
    searchInput.props.onChange({ target: { value: 'Koordinasi' } });
    fromInput.props.onChange({ target: { value: '2026-11-01' } });
    toInput.props.onChange({ target: { value: '2026-11-12' } });
  });

  await act(async () => {
    form.props.onSubmit({ preventDefault() {} });
  });

  assert.ok(requestedPath.includes('q=Koordinasi'));
  assert.ok(requestedPath.includes('from=2026-11-01'));
  assert.ok(requestedPath.includes('to=2026-11-12'));
  assert.ok(requestedPath.includes('page=1'));

  // 6. Test Reset Button
  await act(async () => {
    form.props.onReset();
  });

  // Verify inputs are cleared
  assert.equal(searchInput.props.value, '');
  assert.equal(fromInput.props.value, '');
  assert.equal(toInput.props.value, '');
  assert.ok(requestedPath.includes('q=&from=&to=&page=1'));
});

test('meeting history displays "Belum tersedia" when no valid samples exist', async t => {
  const originalGlobals = {
    IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
    document: globalThis.document,
    window: globalThis.window,
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.document = new EventTarget();
  globalThis.window = { setInterval, clearInterval };
  let root;
  t.after(async () => {
    if (root) await act(async () => root.unmount());
    Object.assign(globalThis, originalGlobals);
  });

  const emptyData = {
    total: 0,
    page: 1,
    pageSize: 20,
    summary: {
      totalEndedMeetings: 0,
      totalDurationSeconds: 0,
      durationSamples: 0,
      averageParticipants: 0,
      participantSamples: 0,
    },
    meetings: [],
  };

  const apiRequest = async path => {
    if (path === '/admin/access') return { permissions: ['meetings:read'] };
    if (path.startsWith('/admin/meetings/history')) return emptyData;
    if (path === '/admin/meetings') return { meetings: [], livekitStatus: 'reachable', checkedAt: new Date().toISOString() };
    throw new Error(`Unexpected path: ${path}`);
  };

  const modules = {
    react: React,
    'react/jsx-runtime': jsx,
    './api': { apiRequest, ApiError: Error, API_BASE: '/api' },
    './AdminDashboard.css': {},
    './AdminEmployeeActions': { AdminEmployeeActions: () => null, default: () => null },
    'lucide-react': new Proxy({}, { get: () => () => null }),
  };

  const source = readFileSync(new URL('../src/AdminDashboard.tsx', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports = {};
  new Function('exports', 'require', outputText)(exports, name => modules[name]);

  await act(async () => {
    root = create(React.createElement(exports.default, { section: 'meetings' }));
  });

  const buttons = root.root.findAllByType('button');
  const historyTabBtn = buttons.find(b => b.children.includes('Riwayat rapat'));
  await act(async () => {
    historyTabBtn.props.onClick();
  });

  const json = JSON.stringify(root.toJSON());

  // 0 meetings, "Belum tersedia" for duration and participants, "0 sampel valid"
  assert.match(json, /Total rapat selesai/);
  assert.match(json, /Total durasi/);
  assert.match(json, /Belum tersedia/);
  assert.match(json, /0 sampel valid/);
});
