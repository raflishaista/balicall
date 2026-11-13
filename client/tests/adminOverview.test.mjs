import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

const source = readFileSync(new URL('../src/AdminDashboard.tsx', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test('overview renders with older API responses and unavailable timestamps', async () => {
  const previous = { totalEmployees: 3, activatedAccounts: 2, totalMeetings: 4, uploadedBytes: '1024' };
  for (const [response, expected] of [
    [previous, /Data aktivitas terbaru belum tersedia/],
    [{
      ...previous, totalRecordings: 0, periodStart: 'invalid', periodEnd: '2026-11-13',
      dailyActivity: [{ date: 'invalid', meetings: 1, attendances: 0 }],
      recentActivity: [{ id: 'qc', title: 'Rapat QC', kind: 'meeting_created', occurredAt: 'invalid' }],
    }, /Waktu belum tercatat/],
  ]) {
    const apiRequest = async path => path === '/admin/access'
      ? { employeeId: 'QC', permissions: ['meetings:read'] }
      : response;
    const modules = {
      react: React, 'react/jsx-runtime': jsx, './api': { apiRequest, ApiError: Error },
      './AdminDashboard.css': {}, './AdminEmployeeActions': {},
      'lucide-react': new Proxy({}, { get: () => () => null }),
    };
    const exports = {};
    new Function('exports', 'require', outputText)(exports, name => modules[name]);
    let root;
    try {
      await act(async () => { root = create(React.createElement(exports.default, { section: 'overview' })); });
      const rendered = JSON.stringify(root.toJSON());
      assert.match(rendered, /Rentang tanggal belum tersedia/);
      assert.match(rendered, expected);
      assert.match(rendered, /Akun saat ini/);
    } finally {
      if (root) await act(async () => root.unmount());
    }
  }
});

test('overview renders normal response with complete data', async () => {
  const normalData = {
    totalEmployees: 25,
    activatedAccounts: 20,
    totalMeetings: 12,
    totalRecordings: 8,
    uploadedBytes: '10485760',
    periodStart: '2026-11-06T00:00:00.000Z',
    periodEnd: '2026-11-13T00:00:00.000Z',
    dailyActivity: [
      { date: '2026-11-06', meetings: 2, attendances: 5, meetingsWithParticipants: 1 },
      { date: '2026-11-07', meetings: 1, attendances: 3, meetingsWithParticipants: 1 },
      { date: '2026-11-13', meetings: 3, attendances: 8, meetingsWithParticipants: 3 },
    ],
    recentActivity: [
      { id: 'rec-1', kind: 'recording_completed', title: 'Rekaman Evaluasi QC', occurredAt: '2026-11-13T04:15:00.000Z' },
      { id: 'meet-1', kind: 'meeting_created', title: 'Rapat Koordinasi Mingguan', occurredAt: '2026-11-12T02:00:00.000Z' },
    ],
  };

  const apiRequest = async path => path === '/admin/access'
    ? { employeeId: 'QC', permissions: ['meetings:read'] }
    : normalData;

  const modules = {
    react: React, 'react/jsx-runtime': jsx, './api': { apiRequest, ApiError: Error },
    './AdminDashboard.css': {}, './AdminEmployeeActions': {},
    'lucide-react': new Proxy({}, { get: () => () => null }),
  };
  const exports = {};
  new Function('exports', 'require', outputText)(exports, name => modules[name]);

  let root;
  try {
    await act(async () => { root = create(React.createElement(exports.default, { section: 'overview' })); });
    const rendered = JSON.stringify(root.toJSON());
    assert.match(rendered, /sampai/);
    assert.match(rendered, /WIB/);
    assert.match(rendered, /Rekaman Evaluasi QC/);
    assert.match(rendered, /Rapat dibuat/);
    assert.match(rendered, /Rekaman selesai diproses/);
    assert.match(rendered, /Tren penggunaan/);
    assert.match(rendered, /25/);
    assert.match(rendered, /Rapat dengan peserta/);
    assert.equal(root.root.findAllByProps({ type: 'range' }).length, 0);
    const plot = root.root.findByProps({ role: 'group', tabIndex: 0 });
    await act(async () => plot.props.onKeyDown({ key: 'ArrowRight', preventDefault() {} }));
    const readout = root.root.findByProps({ className: 'admin-trend-announcement' });
    assert.match(readout.children.join(''), /Rapat dengan peserta 1, Kehadiran tercatat 3/);
    assert.equal(root.root.findAllByProps({ className: 'admin-trend-guide' }).length, 2);
  } finally {
    if (root) await act(async () => root.unmount());
  }
});
