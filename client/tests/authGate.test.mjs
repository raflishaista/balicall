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
    'lucide-react':{Eye:()=>null,EyeOff:()=>null,Loader2:()=>null,LockKeyhole:()=>null,Mail:()=>null}};
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
