// Isolated regression tests: only function body is evaluated, Firebase is mocked.
// Run: node --test experiments/merge-concurrency.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../cloud.js',import.meta.url),'utf8');
const start=source.indexOf('async function commitNoteMerge(){');
const end=source.indexOf('\nasync function takeCloudVersion(){',start);
assert.ok(start>=0&&end>start,'Could not isolate commitNoteMerge');

function makeHarness() {
 let resolveTransaction;
 let live={pets:[{id:'p'}],notes:[{id:'new',petId:'p'}],weights:[]};
 const snapshot=JSON.stringify(live);
 const added={id:'new',petId:'p'};
 const preview={fid:'family-a',revision:7,localSnapshot:snapshot,plan:{changed:[],invalid:[],additions:[added],removed:[]}};
 let applied=null,notice='',pending=false;
 const account={uid:'test-user'};
 const context={
  mergePreview:preview,conflicted:true,enabled:true,account,familyId:'family-a',
  editSequence:3,dirty:true,merging:false,timer:null,
  readLocal:()=>live,confirm:()=>true,clearTimeout:()=>{},
  docState:fid=>fid, pendingSet:value=>{pending=value},
  setBase:rev=>{context.baseRevision=rev},
  message:value=>{notice=value},renderPanel:()=>{},
  planNoteMerge:()=>preview.plan,
  sameRecord:(x,y)=>JSON.stringify(x)===JSON.stringify(y),
  window:{purrfectApplyCloud:data=>{applied=data;live=data}},
  api:{serverTimestamp:()=>0,runTransaction:async(_store,callback)=>{
    await new Promise(resolve=>{resolveTransaction=resolve});
    return callback({get:async()=>({exists:()=>true,data:()=>({revision:7,data:{pets:[{id:'p'}],notes:[],weights:[]}})}),update:()=>{}});
  }},
  store:{}
 };
 vm.runInNewContext(source.slice(start,end),context,{filename:'cloud.js'});
 return {
  context,run:()=>context.commitNoteMerge(),
  waitUntilBlocked:async()=>{for(let i=0;i<50&&!resolveTransaction;i++)await Promise.resolve();assert.ok(resolveTransaction)},
  release:()=>resolveTransaction(),
  edit:()=>{live={...live,weights:[{id:'w-after',petId:'p',weight:3.5}]};context.editSequence++;context.dirty=true},
  getState:()=>({live,applied,notice,pending})
 };
}
test('edits during transaction are preserved and marked conflicting',async()=>{
 const h=makeHarness();const running=h.run();await h.waitUntilBlocked();h.edit();h.release();await running;
 const s=h.getState();
 assert.equal(s.live.weights[0].id,'w-after');
 assert.equal(s.applied,null);
 assert.equal(h.context.dirty,true);
 assert.equal(h.context.conflicted,true);
 assert.equal(s.pending,true);
 assert.match(s.notice,/изменились во время ожидания/);
});
test('unchanged local data allows successful merge',async()=>{
 const h=makeHarness();const running=h.run();await h.waitUntilBlocked();h.release();await running;
 const s=h.getState();
 assert.equal(s.live.notes[0].id,'new');
 assert.ok(s.applied);
 assert.equal(h.context.dirty,false);
 assert.equal(h.context.conflicted,false);
 assert.equal(s.pending,false);
 assert.equal(h.context.baseRevision,8);
});
test('snapshot change without editSequence increment also blocks replacement',async()=>{
 const h=makeHarness();const running=h.run();await h.waitUntilBlocked();
 h.getState().live.weights.push({id:'w-direct',petId:'p'});h.release();await running;
 assert.equal(h.getState().live.weights[0].id,'w-direct');
 assert.equal(h.context.conflicted,true);
});
