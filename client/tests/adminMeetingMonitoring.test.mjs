import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

test('meeting monitoring refreshes only while visible and keeps the table during a refresh', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
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

  const meetings = [{
    id: 'qc-meeting', title: 'Rapat QC', status: 'active', participantCount: 1,
    durationSeconds: 60, scheduledStart: null, startedAt: '2026-11-13T03:00:00Z',
  }];
  const firstCheck = '2026-11-13T03:01:00Z';
  const lastCheck = '2026-11-13T03:01:15Z';
  let requests = 0;
  let pending;
  const apiRequest = async path => {
    if (path === '/admin/access') return { permissions: ['meetings:read'] };
    if (path.startsWith('/admin/meetings/history?')) return { meetings: [], total: 0, page: 1, pageSize: 20 };
    assert.equal(path, '/admin/meetings');
    if (++requests === 1) return { meetings, checkedAt: firstCheck, livekitStatus: 'reachable' };
    return new Promise((resolve, reject) => { pending = { resolve, reject }; });
  };
  const modules = {
    react: React,
    'react/jsx-runtime': jsx,
    './api': { apiRequest, ApiError: Error },
    './AdminDashboard.css': {},
    './AdminEmployeeActions': {},
    'lucide-react': { RefreshCw: () => null },
  };
  const source = readFileSync(new URL('../src/AdminDashboard.tsx', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports = {};
  new Function('exports', 'require', outputText)(exports, name => modules[name]);
  await act(async () => { root = create(React.createElement(exports.default, { section: 'meetings' })); });
  const text = () => JSON.stringify(root.toJSON());
  assert.equal(requests, 1);
  assert.match(text(), /Rapat QC/);
  assert.equal(root.root.findAllByType('time').some(element => element.props.dateTime === firstCheck), true);

  await act(async () => t.mock.timers.tick(15000));
  assert.equal(requests, 2);
  assert.match(text(), /Rapat QC/);
  await act(async () => t.mock.timers.tick(30000));
  assert.equal(requests, 2);
  await act(async () => pending.resolve({
    meetings: [{ ...meetings[0], status: 'empty', participantCount: 0, durationSeconds: null }],
    checkedAt: lastCheck, livekitStatus: 'reachable',
  }));
  assert.match(text(), /Kosong/);
  assert.equal(root.root.findAllByType('time').some(element => element.props.dateTime === lastCheck), true);

  document.visibilityState = 'hidden';
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    t.mock.timers.tick(30000);
  });
  assert.equal(requests, 2);
  document.visibilityState = 'visible';
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  assert.equal(requests, 3);
  await act(async () => pending.reject(new Error('Layanan tidak tersedia')));
  assert.match(text(), /data dari pengecekan terakhir/);
  assert.match(text(), /Rapat QC/);

  const refresh = root.root.findAllByType('button').find(button => button.props.children.includes?.(' Perbarui'));
  await act(async () => refresh.props.onClick());
  assert.equal(requests, 4);
  await act(async () => pending.resolve({
    meetings: [{ ...meetings[0], status: 'unverified', participantCount: null, durationSeconds: null }],
    checkedAt: lastCheck, livekitStatus: 'unavailable',
  }));
  assert.match(text(), /Tidak dapat diverifikasi/);
  assert.doesNotMatch(text(), /data dari pengecekan terakhir/);

  const history = root.root.findAllByType('button').find(button => button.props.children === 'Riwayat rapat');
  await act(async () => history.props.onClick());
  await act(async () => t.mock.timers.tick(30000));
  assert.equal(requests, 4);
});
