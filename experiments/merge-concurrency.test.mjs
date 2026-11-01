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
 let calls=0, rejectTransaction;
 let transactionShouldReject=false;
 let live={pets:[{id:'p'}],notes:[{id:'new',petId:'p'}],weights:[]};
 const snapshot=JSON.stringify(live);
 const added={id:'new',petId:'p'};
 const preview={fid:'family-a',revision:7,localSnapshot:snapshot,plan:{changed:[],invalid:[],additions:[added],removed:[]}};
 let applied=null,notice='',pending=false;
 const account={uid:'test-user'};
 const context={
  mergePreview:preview,conflicted:true,enabled:true,account,familyId:'family-a',
  editSequence:3,dirty:true,merging:false,mergeOperation:null,sessionGeneration:0,timer:null,
  readLocal:()=>live,confirm:()=>true,clearTimeout:()=>{},
  docState:fid=>fid, pendingSet:value=>{pending=value},
  setBase:rev=>{context.baseRevision=rev},
  message:value=>{notice=value},renderPanel:()=>{},
  planNoteMerge:()=>preview.plan,
  sameRecord:(x,y)=>JSON.stringify(x)===JSON.stringify(y),
  window:{purrfectApplyCloud:data=>{applied=data;live=data}},
  api:{serverTimestamp:()=>0,runTransaction:async(_store,callback)=>{
    calls++;
    await new Promise((resolve,reject)=>{resolveTransaction=resolve;rejectTransaction=reject});
    if(transactionShouldReject)throw Error('emulated server failure');
    return callback({get:async()=>({exists:()=>true,data:()=>({revision:7,data:{pets:[{id:'p'}],notes:[],weights:[]}})}),update:()=>{}});
  }},
  store:{}
 };
 vm.runInNewContext(source.slice(start,end),context,{filename:'cloud.js'});
 return {
  context,run:()=>context.commitNoteMerge(),
  waitUntilBlocked:async()=>{for(let i=0;i<50&&!resolveTransaction;i++)await Promise.resolve();assert.ok(resolveTransaction)},
  release:()=>resolveTransaction(),
  reject:()=>{transactionShouldReject=true;resolveTransaction()},
  calls:()=>calls,
  switchSession:(family='family-b',user='other-user')=>{
    context.sessionGeneration++;context.mergeOperation=null;context.merging=false;
    context.familyId=family;context.account={uid:user};context.mergePreview=null;
    context.conflicted=false;context.dirty=false;context.editSequence++;
  },
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

test('second merge invocation cannot start a second transaction',async()=>{
 const h=makeHarness();const first=h.run();await h.waitUntilBlocked();
 await h.run();assert.equal(h.calls(),1);
 h.release();await first;
 assert.equal(h.context.conflicted,false);
 assert.equal(h.context.merging,false);
});
test('late transaction failure cannot poison another account',async()=>{
 const h=makeHarness();const first=h.run();await h.waitUntilBlocked();
 h.switchSession();h.reject();await first;
 assert.equal(h.context.conflicted,false);
 assert.equal(h.context.merging,false);
});
test('late success cannot overwrite another account',async()=>{
 const h=makeHarness();const first=h.run();await h.waitUntilBlocked();
 h.switchSession();h.release();await first;
 assert.equal(h.getState().applied,null);
 assert.equal(h.context.conflicted,false);
});
test('old transaction cannot clear merging owned by new session',async()=>{
 const h=makeHarness();const first=h.run();await h.waitUntilBlocked();
 h.switchSession();h.context.mergeOperation=Symbol('new-merge');
 h.context.merging=true;h.release();await first;
 assert.equal(h.context.merging,true);
 assert.ok(h.context.mergeOperation);
});
test('A to B to A session transition invalidates old successful merge',async()=>{
 const h=makeHarness();const first=h.run();await h.waitUntilBlocked();
 const original=h.context.account;
 h.switchSession();h.context.sessionGeneration++;h.context.familyId='family-a';
 h.context.account=original;h.context.mergeOperation=Symbol('new-merge');
 h.context.merging=true;h.release();await first;
 assert.equal(h.getState().applied,null);
 assert.equal(h.context.conflicted,false);
 assert.equal(h.context.merging,true);
});
