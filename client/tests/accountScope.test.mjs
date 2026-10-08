import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scopedSummaryStorage} from '../src/summaryHistory.ts';
import {setAccountScope} from '../src/accountScope.ts';
test('summary/session storage stays bound to its user even after account switches',t=>{
  const original=globalThis.window;const local=new Map(),session=new Map();
  const storage=map=>({getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value)});
  globalThis.window={localStorage:storage(local),sessionStorage:storage(session)};
  t.after(()=>{globalThis.window=original;setAccountScope(null);});
  const a=scopedSummaryStorage('BT-99001'),b=scopedSummaryStorage('BT-99002'),legacy=scopedSummaryStorage(null);
  a.saveActiveView('summary');a.saveSummarySession({meetingId:'one',roomName:'room',token:'private-token',transcripts:[],open:true});
  setAccountScope('BT-99002');
  assert.equal(b.readActiveView(),null);assert.equal(b.summaryTokenFor('one'),'');assert.equal(legacy.readSummarySession(),null);
  a.saveActiveView('settings');assert.equal(a.readActiveView(),'settings');assert.equal(b.readActiveView(),null);
  assert.equal(a.summaryTokenFor('one'),'private-token');
});
