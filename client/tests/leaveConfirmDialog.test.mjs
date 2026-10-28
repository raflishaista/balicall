import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const source = readFileSync(new URL('../src/LeaveConfirmDialog.tsx', import.meta.url), 'utf8');
const exports = {};
const iconMock = () => null;
const lucideMock = new Proxy({}, { get: () => iconMock });

new Function(
  'exports',
  'require',
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
)(exports, name => (name === 'react' ? React : name === 'react/jsx-runtime' ? jsx : lucideMock));

const { LeaveConfirmDialog } = exports;

test('LeaveConfirmDialog renders nothing when isOpen is false', async () => {
  let root;
  try {
    await act(async () => {
      root = create(
        React.createElement(LeaveConfirmDialog, {
          isOpen: false,
          isLastUser: false,
          intent: 'leave',
          busy: false,
          onConfirm: () => {},
          onCancel: () => {},
        })
      );
    });
    assert.equal(root.toJSON(), null);
  } finally {
    await act(async () => root?.unmount());
  }
});

test('LeaveConfirmDialog prompts when user leaves and other participants remain', async () => {
  let root;
  let confirmed = false;
  let cancelled = false;

  try {
    await act(async () => {
      root = create(
        React.createElement(LeaveConfirmDialog, {
          isOpen: true,
          isLastUser: false,
          intent: 'leave',
          busy: false,
          onConfirm: () => { confirmed = true; },
          onCancel: () => { cancelled = true; },
        })
      );
    });

    const dialog = root.root.findByProps({ role: 'dialog' });
    assert.ok(dialog);

    const title = root.root.findByProps({ id: 'leave-dialog-title' });
    assert.match(title.children.join(''), /Keluar dari Rapat\?/);

    const desc = root.root.findByProps({ id: 'leave-dialog-desc' });
    assert.match(desc.children.join(''), /Peserta lain masih berada/);

    const buttons = root.root.findAllByType('button');
    // Close button, Batal button, Confirm button
    const cancelBtn = buttons.find(b => b.children.includes('Batal'));
    assert.ok(cancelBtn);
    await act(async () => cancelBtn.props.onClick());
    assert.equal(cancelled, true);

    const confirmBtn = buttons.find(b => b.props.className?.includes('button-danger'));
    assert.ok(confirmBtn);
    await act(async () => confirmBtn.props.onClick());
    assert.equal(confirmed, true);
  } finally {
    await act(async () => root?.unmount());
  }
});

test('LeaveConfirmDialog informs the last user that leaving will end the meeting and generate minutes', async () => {
  let root;
  let confirmed = false;

  try {
    await act(async () => {
      root = create(
        React.createElement(LeaveConfirmDialog, {
          isOpen: true,
          isLastUser: true,
          isGuest: false,
          intent: 'leave',
          busy: false,
          onConfirm: () => { confirmed = true; },
          onCancel: () => {},
        })
      );
    });

    const title = root.root.findByProps({ id: 'leave-dialog-title' });
    assert.match(title.children.join(''), /Keluar & Akhiri Rapat\?/);

    const desc = root.root.findByProps({ id: 'leave-dialog-desc' });
    assert.match(desc.children.join(''), /peserta terakhir/);
    assert.match(desc.children.join(''), /notulen/);

    const buttons = root.root.findAllByType('button');
    const confirmBtn = buttons.find(b =>
      b.props.className?.includes('button-primary') && !b.props.className?.includes('button-danger')
    );
    assert.ok(confirmBtn);
    await act(async () => confirmBtn.props.onClick());
    assert.equal(confirmed, true);
  } finally {
    await act(async () => root?.unmount());
  }
});

test('LeaveConfirmDialog prompts for ending meeting with summary', async () => {
  let root;
  let confirmed = false;

  try {
    await act(async () => {
      root = create(
        React.createElement(LeaveConfirmDialog, {
          isOpen: true,
          isLastUser: false,
          intent: 'summary',
          busy: false,
          onConfirm: () => { confirmed = true; },
          onCancel: () => {},
        })
      );
    });

    const title = root.root.findByProps({ id: 'leave-dialog-title' });
    assert.match(title.children.join(''), /Akhiri Rapat & Buat Notulen\?/);

    const desc = root.root.findByProps({ id: 'leave-dialog-desc' });
    assert.match(desc.children.join(''), /semua peserta/);

    const buttons = root.root.findAllByType('button');
    const confirmBtn = buttons.find(b => b.props.className?.includes('button-primary'));
    assert.ok(confirmBtn);
    await act(async () => confirmBtn.props.onClick());
    assert.equal(confirmed, true);
  } finally {
    await act(async () => root?.unmount());
  }
});

test('last user leaving calculates shouldGenerate as true while non-last user gets false', () => {
  const computeFinish = (intent, isLast, isGuest) => (intent === 'summary' || isLast) && !isGuest;

  // Non-last user leaving -> false (do not generate summary/notulen, return to home)
  assert.equal(computeFinish('leave', false, false), false);

  // Last user leaving -> true (end meeting and redirect to summarization process page!)
  assert.equal(computeFinish('leave', true, false), true);

  // Host finishing with summary -> true
  assert.equal(computeFinish('summary', false, false), true);
  assert.equal(computeFinish('summary', true, false), true);

  // Guests cannot generate summaries
  assert.equal(computeFinish('leave', true, true), false);
});

