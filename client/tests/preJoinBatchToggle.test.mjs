import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.React = React;

// Transpile PreJoinPreview.tsx
const preJoinPreviewSrc = readFileSync(new URL('../src/PreJoinPreview.tsx', import.meta.url), 'utf8');
const preJoinPreviewTranspiled = ts.transpileModule(preJoinPreviewSrc, {
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

function mockLucideIcon(name) {
  return function MockIcon(props) {
    return React.createElement('span', { 'data-icon': name, ...props });
  };
}
const mockLucide = new Proxy({}, {
  get: (_target, prop) => mockLucideIcon(String(prop))
});

const preJoinPreviewModule = { exports: {} };
const prejoinRequire = (id) => {
  if (id === 'react') return React;
  if (id === 'lucide-react') return mockLucide;
  if (id === './presentation') return { initials: () => 'BT' };
  if (id === './MicrophoneDiagnostic') return { MicrophoneDiagnostic: () => null };
  if (id === './TranscriptionModelOptions') return { TranscriptionModelOptions: () => null };
  if (id === './modelSelection') return { SEA_LIVE_MODEL: 'sea-live', SEA_LIVE_NOTICE: '', MING_LIVE_MODEL: 'ming-live', MING_LIVE_NOTICE: '', QWEN_GGUF_LIVE_MODEL: 'qwen-gguf', QWEN_GGUF_LIVE_NOTICE: '' };
  if (id === './preferences') return {
    isChromiumBrowser: () => true,
    supportsSharedMicrophone: () => true,
    QWEN_TRANSCRIPTION_NOTICE: '',
    QWEN_DIARIZATION_NOTICE: '',
    QWEN_LIVE_DIARIZATION_NOTICE: '',
    QWEN_GGUF_NOTICE: ''
  };
  return {};
};

new Function('module', 'exports', 'require', 'React', preJoinPreviewTranspiled)(preJoinPreviewModule, preJoinPreviewModule.exports, prejoinRequire, React);
const { PreJoinPreview } = preJoinPreviewModule.exports;

// Transpile Workspace.tsx for LobbyView check
const workspaceSrc = readFileSync(new URL('../src/Workspace.tsx', import.meta.url), 'utf8')
  .replace(/import\.meta\.env\.DEV/g, 'true');
const workspaceTranspiled = ts.transpileModule(workspaceSrc, {
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

const workspaceModule = { exports: {} };
new Function('module', 'exports', 'require', 'React', workspaceTranspiled)(workspaceModule, workspaceModule.exports, id => {
  if (id === 'react') return React;
  if (id === 'lucide-react') return mockLucide;
  if (id === './presentation') return { initials: () => 'BT' };
  if (id === './ProfileEditor') return { UserAvatar: () => null };
  return {};
}, React);
const { LobbyView } = workspaceModule.exports;

const mockMedia = {
  devices: [],
  streams: {},
  pending: {},
  errors: {},
  choices: {
    microphoneEnabled: true,
    cameraEnabled: true,
    microphoneId: 'default',
    cameraId: 'default',
    sharedRoomMic: false,
    liveDiarization: true,
    batchDiarization: true
  },
  select: () => {},
  toggle: () => {},
  capture: async () => {},
  stopCamera: () => {},
  stopMicrophone: () => {},
  refresh: async () => {}
};

test('PreJoinPreview renders Batch pasca-rapat when isCreateMeeting and qwenBatchConfigured are true', () => {
  let toggled = false;
  let rendered;
  act(() => {
    rendered = create(
      React.createElement(PreJoinPreview, {
        media: mockMedia,
        employeeName: 'Rafli',
        blocked: false,
        isCreateMeeting: true,
        qwenBatchConfigured: true,
        postMeetingBatch: false,
        onTogglePostMeetingBatch: val => { toggled = val; }
      })
    );
  });

  const root = rendered.root;
  const match = root.findAll(node => node.type === 'strong' && node.children.includes('Batch pasca-rapat · Qwen + Nemotron'));
  assert.equal(match.length, 1);

  // Check the toggle input triggers onTogglePostMeetingBatch
  const checkbox = root.findByProps({ className: 'prejoin-shared-mic-toggle prejoin-batch-toggle ' }).findByType('input');
  act(() => {
    checkbox.props.onChange({ target: { checked: true } });
  });
  assert.equal(toggled, true);
});

test('PreJoinPreview hides Batch pasca-rapat when isCreateMeeting is false', () => {
  let rendered;
  act(() => {
    rendered = create(
      React.createElement(PreJoinPreview, {
        media: mockMedia,
        employeeName: 'Rafli',
        blocked: false,
        isCreateMeeting: false,
        qwenBatchConfigured: true,
        postMeetingBatch: false
      })
    );
  });

  const root = rendered.root;
  const match = root.findAll(node => node.type === 'strong' && node.children.includes('Batch pasca-rapat · Qwen + Nemotron'));
  assert.equal(match.length, 0);
});

test('PreJoinPreview hides Batch pasca-rapat when qwenBatchConfigured is false', () => {
  let rendered;
  act(() => {
    rendered = create(
      React.createElement(PreJoinPreview, {
        media: mockMedia,
        employeeName: 'Rafli',
        blocked: false,
        isCreateMeeting: true,
        qwenBatchConfigured: false,
        postMeetingBatch: false
      })
    );
  });

  const root = rendered.root;
  const match = root.findAll(node => node.type === 'strong' && node.children.includes('Batch pasca-rapat · Qwen + Nemotron'));
  assert.equal(match.length, 0);
});

test('LobbyView right-side card does not contain Batch pasca-rapat', () => {
  let rendered;
  act(() => {
    rendered = create(
      React.createElement(LobbyView, {
        intent: 'create',
        onIntentChange: () => {},
        employeeId: 'BT-10492',
        setEmployeeId: () => {},
        employeeName: 'Rafli',
        setEmployeeName: () => {},
        department: 'NOC',
        setDepartment: () => {},
        roomName: 'Ruang Rapat',
        setRoomName: () => {},
        roomCode: 'ABCDE',
        setRoomCode: () => {},
        onRegenerateCode: () => {},
        isJoining: false,
        joinError: null,
        onJoin: () => {},
        mediaPreview: React.createElement('div', { id: 'test-preview' }, 'Media Preview'),
        personas: []
      })
    );
  });

  const root = rendered.root;
  const lobbyCard = root.findByProps({ className: 'lobby-card' });
  const batchMatches = lobbyCard.findAll(node => node.type === 'strong' && node.children.includes('Batch pasca-rapat · Qwen + Nemotron'));
  assert.equal(batchMatches.length, 0);
});
