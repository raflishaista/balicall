import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.React = React;

// Load generateRoomCode from roomCode.ts
const roomCodeSrc = readFileSync(new URL('../src/roomCode.ts', import.meta.url), 'utf8');
const roomCodeTranspiled = ts.transpileModule(roomCodeSrc, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const roomCodeModule = { exports: {} };
new Function('module', 'exports', roomCodeTranspiled)(roomCodeModule, roomCodeModule.exports);
const { generateRoomCode } = roomCodeModule.exports;

// Transpile Workspace.tsx to get LobbyView
const workspaceSrc = readFileSync(new URL('../src/Workspace.tsx', import.meta.url), 'utf8')
  .replace(/import\.meta\.env\.DEV/g, 'true');

const workspaceTranspiled = ts.transpileModule(workspaceSrc, {
  compilerOptions: {
    jsx: ts.JsxEmit.React,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;

const workspaceModule = { exports: {} };
function mockLucideIcon(name) {
  return function MockIcon(props) {
    return React.createElement('span', { 'data-icon': name, ...props });
  };
}
const mockLucide = new Proxy({}, {
  get: (_target, prop) => mockLucideIcon(String(prop))
});
const mockPresentation = { initials: () => 'BT' };
const mockProfileEditor = { UserAvatar: () => React.createElement('div', null, 'Avatar') };

const customRequire = (id) => {
  if (id === 'react') return React;
  if (id === 'lucide-react') return mockLucide;
  if (id === './presentation') return mockPresentation;
  if (id === './ProfileEditor') return mockProfileEditor;
  return {};
};

new Function('module', 'exports', 'require', 'React', workspaceTranspiled)(workspaceModule, workspaceModule.exports, customRequire, React);
const { LobbyView } = workspaceModule.exports;

test('generateRoomCode returns 5-digit uppercase alphanumeric string', () => {
  for (let i = 0; i < 20; i++) {
    const code = generateRoomCode();
    assert.equal(typeof code, 'string');
    assert.equal(code.length, 5);
    assert.match(code, /^[0-9A-Z]{5}$/);
  }
});

test('LobbyView in create mode shows room name input and generated room code below it', () => {
  let rendered;
  act(() => {
    rendered = create(
      React.createElement(LobbyView, {
        intent: 'create',
        onIntentChange: () => {},
        employeeId: 'BT-10492',
        setEmployeeId: () => {},
        employeeName: 'Rafli Aditya',
        setEmployeeName: () => {},
        department: 'NOC',
        setDepartment: () => {},
        roomName: 'Koordinasi Jaringan',
        setRoomName: () => {},
        roomCode: 'K9X2P',
        setRoomCode: () => {},
        onRegenerateCode: () => {},
        isJoining: false,
        joinError: null,
        onJoin: () => {},
        mediaPreview: React.createElement('div', null, 'Preview'),
        personas: [],
      })
    );
  });

  const root = rendered.root;
  // Check room name input is present
  const roomNameInput = root.findByProps({ placeholder: 'Contoh: koordinasi-jaringan' });
  assert.ok(roomNameInput);
  assert.equal(roomNameInput.props.value, 'Koordinasi Jaringan');

  // Check generated room code input is present below it
  const roomCodeInput = root.findByProps({ id: 'create-room-code' });
  assert.ok(roomCodeInput);
  assert.equal(roomCodeInput.props.value, 'K9X2P');
  assert.equal(roomCodeInput.props.readOnly, true);

  // Check refresh button is present
  const refreshBtn = root.findByProps({ className: 'button-ghost room-code-refresh-btn' });
  assert.ok(refreshBtn);
});

test('LobbyView in join mode replaces room name input with 5-digit room code input', () => {
  let currentCode = '7B3MN';
  let rendered;
  act(() => {
    rendered = create(
      React.createElement(LobbyView, {
        intent: 'join',
        onIntentChange: () => {},
        employeeId: 'BT-10492',
        setEmployeeId: () => {},
        employeeName: 'Rafli Aditya',
        setEmployeeName: () => {},
        department: 'NOC',
        setDepartment: () => {},
        roomName: '',
        setRoomName: () => {},
        roomCode: currentCode,
        setRoomCode: val => { currentCode = val; },
        isJoining: false,
        joinError: null,
        onJoin: () => {},
        mediaPreview: React.createElement('div', null, 'Preview'),
        personas: [],
      })
    );
  });

  const root = rendered.root;
  // Room name input for create should NOT be present
  const createRoomInputs = root.findAllByProps({ placeholder: 'Contoh: koordinasi-jaringan' });
  assert.equal(createRoomInputs.length, 0);

  // Join room code input should be present
  const joinInput = root.findByProps({ id: 'join-room-code' });
  assert.ok(joinInput);
  assert.equal(joinInput.props.value, '7B3MN');
  assert.equal(joinInput.props.maxLength, 5);
  assert.equal(joinInput.props.pattern, '[A-Za-z0-9]{5}');
});
