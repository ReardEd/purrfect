import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';

const patched=new URL('../patched/local-store.js',import.meta.url);
const filename=fs.existsSync(patched)?patched:new URL('../local-store.js',import.meta.url);
function storage(){
 const values=new Map();const s={values,throwGet:null,throwSet:null,onSet:null,get length(){return values.size},key(i){return [...values.keys()][i]??null},getItem(k){if(s.throwGet?.(k))throw Error('read failure');return values.get(k)??null},setItem(k,v){if(s.throwSet?.(k))throw Error('write failure');if(s.onSet)s.onSet(k,String(v));values.set(k,String(v))},removeItem:k=>values.delete(k)};return s;
}
const initial={pets:[],active:null,notes:[],events:[],weights:[],vaccines:[],foods:[],shopping:[],visits:[],foodReactions:[],noteTombstones:[],settings:{onboard:false}};
const data=name=>({...structuredClone(initial),pets:[{id:name,name}]});
function setup(ls=storage(),projectId='synthetic-project'){
 const ctx={window:{},globalThis:null,structuredClone,crypto:{randomUUID},Date,console};ctx.globalThis=ctx;
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),ctx,{filename:'local-store.js'});
 const api=ctx.window.PurrfectStore||ctx.PurrfectStore;
 assert.ok(api?.create,'Store must expose create');
 return {ls,store:api.create({storage:ls,projectId,initial,writerId:randomUUID()})};
}
function append(store,view,name,extra={}){
 return store.append(view.scope,data(name),{parents:view.headIds,pending:true,baseRevision:7,reason:'edit',conflicted:false,sessionGeneration:1,...extra});
}
function records(ls){return [...ls.values].map(([key,raw])=>{try{return {key,raw,entry:JSON.parse(raw)}}catch{return {key,raw}}}).filter(x=>x.entry?.parents&&x.entry?.scope)}

test('storage key/envelope scope tampering is rejected before upload view',()=>{
 const {ls,store}=setup();let a=store.open('u','A');a=append(store,a,'A');const item=records(ls)[0];assert.ok(item);item.entry.scope=store.open('u','B').scope;ls.values.set(item.key,JSON.stringify(item.entry));assert.throws(()=>store.open('u','A'));
});
test('unknown/corrupt JSON in scope never becomes an empty profile',()=>{
 const {ls,store}=setup();const a=append(store,store.open('u','A'),'A');const item=records(ls)[0];ls.values.set(item.key,'{broken');assert.throws(()=>store.read(a.scope));assert.equal(ls.values.get(item.key),'{broken');
});
test('failed write preserves all earlier acknowledged entries',()=>{
 const {ls,store}=setup();let a=append(store,store.open('u','A'),'first');const before=new Map(ls.values);ls.throwSet=()=>true;assert.throws(()=>append(store,a,'second'));assert.deepEqual(ls.values,before);ls.throwSet=null;assert.equal(store.read(a.scope).data.pets[0].id,'first');
});
test('failure after actual write/readback keeps recoverable original and never deletes',()=>{
 const {ls,store}=setup();const a=append(store,store.open('u','A'),'first');const oldKeys=[...ls.values.keys()];ls.onSet=(k)=>{ls.throwGet=x=>x===k};assert.throws(()=>append(store,a,'second'));for(const k of oldKeys)assert.ok(ls.values.has(k));ls.onSet=null;ls.throwGet=null;const exported=store.exportScope(a.scope);assert.ok(JSON.stringify(exported).includes('first'));assert.ok(JSON.stringify(exported).includes('second'));
});
test('stale writer cannot silently retire acknowledged pending branch',()=>{
 const {ls,store}=setup();const base=store.open('u','A');const second=setup(ls).store;const stale=second.open('u','A');append(store,base,'first');assert.throws(()=>append(second,stale,'second'));assert.equal(store.read(base.scope).data.pets[0].id,'first');
});
test('pending branch cannot be consumed by a remote snapshot',()=>{
 const {store}=setup();const a=append(store,store.open('u','A'),'unsent');assert.throws(()=>append(store,a,'remote',{pending:false,reason:'remote',baseRevision:8}));assert.equal(store.read(a.scope).data.pets[0].id,'unsent');
});
test('cross-project contexts do not collide',()=>{
 const {ls,store}=setup();append(store,store.open('u','A'),'project-one');const other=setup(ls,'other-project').store;assert.equal(other.open('u','A').data.pets.length,0);assert.equal(store.open('u','A').data.pets[0].id,'project-one');
});
test('legacy export preserves raw bytes and pending/revision without guessing',()=>{
 const ls=storage();const raw=' { "pets": [{"id":"legacy"}] } ';ls.values.set('purrfect_v01',raw);ls.values.set('purrfect_pending_A','1');ls.values.set('purrfect_revision_A','3');const {store}=setup(ls);const out=store.exportLegacy();const rendered=JSON.stringify(out);assert.ok(rendered.includes(JSON.stringify(raw).slice(1,-1)));assert.ok(rendered.includes('purrfect_pending_A'));assert.ok(rendered.includes('purrfect_revision_A'));assert.equal(ls.values.get('purrfect_v01'),raw);
});
test('interleaved writers retain both forks through close/reload and block ACK',()=>{
 const {ls,store}=setup();const base=store.open('u','A');const second=setup(ls).store;const stale=second.open('u','A');let injected=false;
 ls.onSet=()=>{if(injected)return;injected=true;append(second,stale,'other-tab')};
 const result=append(store,base,'first-tab');ls.onSet=null;assert.equal(result.conflicted,true);assert.equal(result.pending,true);assert.equal(result.headIds.length,2);
 const reloaded=setup(ls).store;const view=reloaded.open('u','A');assert.equal(view.headIds.length,2);assert.deepEqual(new Set(view.candidates.map(x=>x.data.pets[0].id)),new Set(['first-tab','other-tab']));
 assert.throws(()=>append(reloaded,view,'server',{pending:false,reason:'ack',baseRevision:8}));
});
test('remote snapshot racing new local write retains pending branch and forces conflict',()=>{
 const {ls,store}=setup();const base=store.open('u','A');const second=setup(ls).store;const stale=second.open('u','A');let injected=false;
 ls.onSet=()=>{if(injected)return;injected=true;append(second,stale,'local-race')};
 const result=append(store,base,'remote-race',{pending:false,reason:'remote',baseRevision:8});ls.onSet=null;
 assert.equal(result.conflicted,true);assert.equal(result.pending,true);assert.equal(result.headIds.length,2);assert.ok(result.candidates.some(x=>x.data.pets[0].id==='local-race'));
});
test('missing parents and cycles are rejected without deleting raw entries',()=>{
 const {ls,store}=setup();let view=append(store,store.open('u','A'),'first');const first=records(ls)[0];view=append(store,view,'second');const second=records(ls).find(x=>x.entry.id!==first.entry.id);
 const original=ls.values.get(second.key);second.entry.parents=['missing'];ls.values.set(second.key,JSON.stringify(second.entry));assert.throws(()=>store.read(view.scope));ls.values.set(second.key,original);
 first.entry.parents=[second.entry.id];ls.values.set(first.key,JSON.stringify(first.entry));assert.throws(()=>store.read(view.scope));assert.equal(records(ls).length,2);
});
test('corrupted pending metadata never authorizes a clean legacy scoped payload',()=>{
 const ls=storage();ls.values.set('purrfect_data_v2_u:A',JSON.stringify(data('unsent')));ls.values.set('purrfect_pending_v2_u:A','garbage');const {store}=setup(ls);assert.throws(()=>store.open('u','A'));
});
