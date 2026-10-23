import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const source=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const effects=[];
function visit(node) {
  if(ts.isCallExpression(node) && node.expression.getText(tree)==='useEffect') effects.push(node.getText(tree));
  ts.forEachChild(node,visit);
}
visit(tree);
function fixture(confirmed) {
  const state={view:'in-call',cleanupCalls:0,pushes:0};
  let listener;
  const scope={useEffect:fn=>fn(),currentRouteRef:{current:{view:'in-call'}},meetingIdRef:{current:'qc-room'},
    handleEndMeetingRef:{current:undefined},handleEndMeeting:async()=>{state.cleanupCalls++;},isGuest:false,
    window:{confirm:()=>confirmed,location:{hash:'#/home'},history:{pushState:()=>{state.pushes++;}},
      addEventListener:(_type,fn)=>{listener=fn;},removeEventListener(){}},
    sanitizeRouteForGuest:r=>r,hashToRoute:()=>({view:'home'}),routeToHash:()=> '#/call/qc-room',
    setView:v=>{state.view=v;},summaryHistory:[],readSummarySession:()=>null,saveSummarySession:()=>{},summaryTokenFor:()=>null};
  for(const expression of effects.filter(text=>text.includes('const handlePopState') || /handleEndMeetingRef\.current\s*=/.test(text))) {
    const code=ts.transpileModule(expression,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
    new Function('scope',`with(scope){${code}}`)(scope);
  }
  return {state,back:()=>listener({state:{view:'home'}})};
}
test('confirmed browser Back closes the first active meeting',()=>{
  const f=fixture(true); f.back(); assert.equal(f.state.cleanupCalls,1); assert.equal(f.state.view,'home');
});
test('cancelled browser Back preserves the active meeting',()=>{
  const f=fixture(false); f.back(); assert.equal(f.state.cleanupCalls,0); assert.equal(f.state.view,'in-call'); assert.equal(f.state.pushes,1);
});
