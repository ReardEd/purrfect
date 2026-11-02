import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {storage,family} from './harness.mjs';
let serial=0;
function make(ls=storage(),projectId='synthetic-project',extra={}){
 const context=vm.createContext({localStorage:ls,structuredClone,Date,console,crypto:{randomUUID:()=>`module-${++serial}`}});context.window=context;
 vm.runInContext(fs.readFileSync(new URL('../local-store.js',import.meta.url),'utf8'),context);
 const store=context.PurrfectStore.create({storage:ls,projectId,initial:family('empty'),writerId:`writer-${++serial}`,idGenerator:()=>`entry-${++serial}`,...extra});return {store,ls};
}
const append=(store,view,data,options={})=>store.append(view.scope,data,{parents:view.headIds,pending:true,baseRevision:7,reason:'synthetic-edit',sessionGeneration:3,...options});
test('atomic durable edit recovers data, pending, revision after new store instance',()=>{
 const {store,ls}=make();const initial=store.open('u','A');append(store,initial,family('saved'));const reloaded=make(ls).store.open('u','A');assert.equal(reloaded.data.pets[0].id,'saved');assert.equal(reloaded.pending,true);assert.equal(reloaded.baseRevision,7);
});
test('append never changes previously committed bytes',()=>{
 const {store,ls}=make();const view=append(store,store.open('u','A'),family('one'));const before=new Map(ls.values);append(store,view,family('two'));for(const [key,value]of before)assert.equal(ls.values.get(key),value);
});
test('concurrent children from same parent remain recoverable as a conflict',()=>{
 const {store,ls}=make();const root=append(store,store.open('u','A'),family('base'),{pending:false});const left=make(ls).store,right=make(ls).store;const a=left.open('u','A'),b=right.open('u','A');const originalSet=ls.setItem.bind(ls);let interleaved=false;ls.setItem=(key,value)=>{if(key.startsWith('purrfect_iron_v1:')&&!interleaved){interleaved=true;append(right,b,family('right'))}return originalSet(key,value)};append(left,a,family('left'));ls.setItem=originalSet;assert.equal(interleaved,true);const recovered=make(ls).store;const view=recovered.open('u','A');assert.equal(view.conflicted,true);assert.equal(view.pending,true);const backup=JSON.stringify(recovered.exportScope(view.scope));assert.match(backup,/left/);assert.match(backup,/right/);
});
test('stale clean snapshot cannot erase another tab pending record',()=>{
 const {store,ls}=make();append(store,store.open('u','A'),family('base'),{pending:false});const old=store.open('u','A');const other=make(ls).store;append(other,other.open('u','A'),family('unsent'));try{append(store,old,family('server'),{pending:false,baseRevision:8})}catch{}const reloaded=make(ls).store;const view=reloaded.open('u','A');assert.equal(view.pending,true);assert.match(JSON.stringify(reloaded.exportScope(view.scope)),/unsent/);
});
test('quota failure throws and leaves every prior immutable entry untouched',()=>{
 const {store,ls}=make();const view=append(store,store.open('u','A'),family('saved'));const before=new Map(ls.values);ls.failSet=()=>true;assert.throws(()=>append(store,view,family('must-not-be-acknowledged')));ls.failSet=null;assert.deepEqual(ls.values,before);assert.equal(make(ls).store.open('u','A').data.pets[0].id,'saved');
});
test('read failure is distinguishable from empty scope',()=>{
 const {store,ls}=make();append(store,store.open('u','A'),family('saved'));ls.failGet=()=>true;assert.throws(()=>store.open('u','A'));ls.failGet=null;assert.equal(store.open('u','A').data.pets[0].id,'saved');
});
test('malformed journal entry blocks opening rather than returning initial',()=>{
 const {store,ls}=make();append(store,store.open('u','A'),family('saved'));const entry=[...ls.values.keys()].find(k=>k.startsWith('purrfect_iron_v1:'));assert.ok(entry);ls.values.set(entry,'{broken');assert.throws(()=>store.open('u','A'));
});
test('scope namespace includes project as well as account and family',()=>{
 const {store,ls}=make();append(store,store.open('u','A'),family('project-one'));const other=make(ls,'another-project').store;assert.notEqual(other.open('u','A').data.pets[0]?.id,'project-one');append(other,other.open('u','A'),family('project-two'));assert.equal(store.open('u','A').data.pets[0].id,'project-one');
});
test('legacy export includes exact original raw and old pending/revision metadata',()=>{
 const ls=storage();const raw=' {"pets":[{"id":"legacy"}],"unknown":true} ';ls.setItem('purrfect_v01',raw);ls.setItem('purrfect_pending_A','1');ls.setItem('purrfect_revision_A','4');const {store}=make(ls);const backup=JSON.stringify(store.exportLegacy());assert.match(backup,/legacy/);assert.match(backup,/purrfect_pending_A/);assert.match(backup,/purrfect_revision_A/);assert.equal(ls.getItem('purrfect_v01'),raw);assert.ok(Object.values(store.exportLegacy()).some(v=>v===raw),'original raw must be directly included');
});
test('ID collision must not overwrite an existing immutable entry',()=>{
 const {store,ls}=make(storage(),'synthetic-project',{idGenerator:()=> 'constant-id'});const first=append(store,store.open('u','A'),family('one'));const before=new Map(ls.values);assert.throws(()=>append(store,first,family('two')));assert.deepEqual(ls.values,before);
});
test('uncertain readback after a successful write remains recoverable on reload',()=>{
 const {store,ls}=make();const view=append(store,store.open('u','A'),family('before'));const originalSet=ls.setItem.bind(ls);ls.setItem=(key,value)=>{originalSet(key,value);ls.failGet=k=>k===key};assert.throws(()=>append(store,view,family('uncertain')));ls.failGet=null;ls.setItem=originalSet;const reloaded=make(ls).store.open('u','A');assert.equal(reloaded.data.pets[0].id,'uncertain');assert.equal(reloaded.pending,true);
});
