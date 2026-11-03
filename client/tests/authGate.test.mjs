import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import {act,create} from 'react-test-renderer';
import ts from 'typescript';
const require=createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
function fixture({enabled=true,user={employeeId:'qc-user',name:'QC'},failLogout=false,failPush=false}={}) {
  let logoutCalls=0,cleared=0,scope='initial',appLoads=0;
  globalThis.window={addEventListener(){},removeEventListener(){}};
  function Workspace(props){return React.createElement('button',{onClick:props.onLogout,disabled:props.logoutPending},'Workspace '+(props.authUser?.name||'local'));}
  const dependencies={react:React,'react/jsx-runtime':require('react/jsx-runtime'),'./App':{__esModule:true,default:Workspace},
    './api':{AUTH_EXPIRED_EVENT:'expired',setAuthCsrfToken(){},apiRequest:async(path)=>{
      if(path==='/auth/session')return {enabled,user};
      assert.equal(path,'/auth/logout');logoutCalls++;if(failLogout)throw Error('Network unavailable');return {success:true};
    }},'./accountScope':{setAccountScope:value=>{scope=value;}},
    './summaryHistory':{clearSummarySession:()=>{cleared++;}},
    './pushNotifications':{disablePush:async()=>{if(failPush)throw Error('Push unavailable');}},
    'lucide-react':{AlertCircle:()=>null,Eye:()=>null,EyeOff:()=>null,Loader2:()=>null,LockKeyhole:()=>null,Mail:()=>null}};
  const source=readFileSync(new URL('../src/AuthGate.tsx',import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const exports={};new Function('exports','require',code)(exports,name=>{if(name==='./App')appLoads++;return dependencies[name]||{};});
  return {AuthGate:exports.AuthGate,LoginPage:exports.LoginPage,Workspace,get appLoads(){return appLoads},get calls(){return logoutCalls},get cleared(){return cleared},get scope(){return scope}};
}
test('logout revokes the session and returns to login, even when push cleanup fails',async()=>{
  const f=fixture({failPush:true});let root;
  try{await act(async()=>{root=create(React.createElement(f.AuthGate));});
    const logout=root.root.findByType(f.Workspace).props.onLogout;assert.equal(typeof logout,'function');
    await act(async()=>Promise.all([logout(),logout()]));
    assert.equal(f.calls,1);assert.equal(f.cleared,1);assert.equal(f.scope,null);
    assert.equal(root.root.findAllByType(f.Workspace).length,0);
    assert.ok(root.root.findAllByType('form').length>0,'Login form should replace the workspace');
  }finally{await act(async()=>root?.unmount());}
});
test('logout failure keeps the account active and shows the error',async()=>{
  const f=fixture({failLogout:true});let root;
  try{await act(async()=>{root=create(React.createElement(f.AuthGate));});
    await act(async()=>root.root.findByType(f.Workspace).props.onLogout());
    assert.equal(f.cleared,0);assert.equal(f.scope,'qc-user');assert.equal(root.root.findAllByType(f.Workspace).length,1);
    assert.ok(root.root.findAllByProps({role:'alert'}).some(node=>node.children.includes('Network unavailable')));
  }finally{await act(async()=>root?.unmount());}
});
test('authentication disabled keeps local mode without pretending an account is signed in',async()=>{
  const f=fixture({enabled:false,user:null});let root;
  try{await act(async()=>{root=create(React.createElement(f.AuthGate));});assert.equal(root.root.findByType(f.Workspace).props.onLogout,undefined);}
  finally{await act(async()=>root?.unmount());}
});


test('login defers the workspace module until a session is accepted',async()=>{
 const f=fixture({user:null});let root;
 try{
  await act(async()=>{root=create(React.createElement(f.AuthGate));});
  assert.equal(f.appLoads,0);assert.ok(root.root.findAllByType('form').length);
  await act(async()=>root.root.findByType(f.LoginPage).props.onAuthenticated({enabled:true,user:{employeeId:'qc-user',name:'QC'}}));
  assert.equal(f.appLoads,1);assert.equal(root.root.findAllByType(f.Workspace).length,1);
 }finally{await act(async()=>root?.unmount());}
});

test('duplicate login attempt triggers active session popup, allowing cancel or force takeover', async () => {
  let loginPayloads = [];
  let simulateConflict = true;
  globalThis.window = { addEventListener() {}, removeEventListener() {}, localStorage: { setItem() {}, removeItem() {} } };
  const dependencies = {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    './App': { __esModule: true, default: () => null },
    './api': {
      AUTH_EXPIRED_EVENT: 'expired',
      setAuthCsrfToken() {},
      apiRequest: async (path, options) => {
        if (path === '/auth/session') return { enabled: true, user: null };
        if (path === '/auth/login') {
          const body = JSON.parse(options.body);
          loginPayloads.push(body);
          if (simulateConflict && !body.force) {
            const err = new Error('Akun ini sedang aktif di sesi atau perangkat lain.');
            err.status = 409;
            err.code = 'ACCOUNT_ALREADY_LOGGED_IN';
            err.data = { alreadyLoggedIn: true, employeeName: 'Tester' };
            throw err;
          }
          return { enabled: true, user: { employeeId: 'BT-99001', name: 'Tester' }, csrfToken: 'tok' };
        }
        throw new Error('Unknown path ' + path);
      }
    },
    './accountScope': { setAccountScope() {} },
    './summaryHistory': { clearSummarySession() {} },
    './pushNotifications': { disablePush: async () => {} },
    'lucide-react': { AlertCircle: () => null, Eye: () => null, EyeOff: () => null, Loader2: () => null, LockKeyhole: () => null, Mail: () => null }
  };
  const source = readFileSync(new URL('../src/AuthGate.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, name => dependencies[name] || {});

  let root;
  try {
    await act(async () => { root = create(React.createElement(exports.AuthGate)); });
    const inputs = root.root.findAllByType('input');
    const emailInput = inputs.find(i => i.props.type === 'email');
    const passInput = inputs.find(i => i.props.type === 'password');
    const form = root.root.findByType('form');

    // Enter credentials
    await act(async () => {
      emailInput.props.onChange({ target: { value: 'user@balitower.co.id' } });
      passInput.props.onChange({ target: { value: 'SecretPassword123' } });
    });

    // Submit form -> triggers 409 conflict
    await act(async () => {
      form.props.onSubmit({ preventDefault() {} });
    });

    assert.equal(loginPayloads.length, 1);
    assert.equal(loginPayloads[0].email, 'user@balitower.co.id');
    assert.equal(loginPayloads[0].force, undefined);

    // Popup modal should appear
    const dialog = root.root.findByProps({ role: 'dialog' });
    assert.ok(dialog, 'Conflict dialog must be rendered');
    assert.ok(dialog.props['aria-modal'], 'Should be a modal dialog');

    const forceBtn = root.root.findByProps({ className: 'login-conflict-force' });
    assert.ok(forceBtn, 'Force takeover button should be present');

    // Click force takeover button
    await act(async () => {
      await forceBtn.props.onClick();
    });

    assert.equal(loginPayloads.length, 2);
    assert.equal(loginPayloads[1].force, true);
  } finally {
    await act(async () => root?.unmount());
  }
});
