import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const cloud=fs.readFileSync(new URL('../cloud.js',import.meta.url),'utf8');
function storage(){const values=new Map();return {getItem:k=>values.has(k)?values.get(k):null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k),values}}
function harness(localStorage){
 const ctx={localStorage,window:{},document:{documentElement:{dataset:{}},querySelector:()=>null},structuredClone,Date,closeModal:()=>{},render:()=>{},toast:()=>{}};
 const end=app.indexOf('function id()');assert.ok(end>0);
 vm.runInNewContext(app.slice(0,end)+';globalThis.__test={getDb:()=>db,setDb:x=>{db=x},save,getKey:()=>currentStorageKey}',ctx);
 return {...ctx.__test,switch:(uid,fid)=>ctx.window.purrfectSwitchLocalContext(uid,fid)};
}
test('same account: family payloads remain separate',()=>{
 const ls=storage(),h=harness(ls);h.switch('u','A');h.setDb({pets:[{id:'A'}]});h.save();
 h.switch('u','B');assert.equal(h.getDb().pets.length,0);h.setDb({pets:[{id:'B'}]});h.save();
 h.switch('u','A');assert.equal(h.getDb().pets[0].id,'A');
});
test('same family: account payloads remain separate',()=>{
 const ls=storage(),h=harness(ls);h.switch('u1','A');h.setDb({pets:[{id:'one'}]});h.save();
 h.switch('u2','A');assert.equal(h.getDb().pets.length,0);h.setDb({pets:[{id:'two'}]});h.save();
 h.switch('u1','A');assert.equal(h.getDb().pets[0].id,'one');
});
test('legacy records remain untouched on family switch',()=>{
 const ls=storage(),legacy=JSON.stringify({pets:[{id:'old'}]});ls.setItem('purrfect_v01',legacy);
 const h=harness(ls);assert.equal(h.getDb().pets[0].id,'old');h.switch('u','A');
 assert.equal(h.getDb().pets.length,0);assert.equal(ls.getItem('purrfect_v01'),legacy);
 h.switch(null,null);assert.equal(h.getDb().pets[0].id,'old');
});
test('reload restores only scoped payloads',()=>{
 const ls=storage(),h=harness(ls);h.switch('u','A');h.setDb({pets:[{id:'A'}]});h.save();
 const reload=harness(ls);reload.switch('u','A');assert.equal(reload.getDb().pets[0].id,'A');
 reload.switch('u','B');assert.equal(reload.getDb().pets.length,0);
});
test('storage error blocks switch without losing live data',()=>{
 const ls=storage(),h=harness(ls);h.switch('u','A');h.setDb({pets:[{id:'unsaved'}]});
 ls.setItem=()=>{throw Error('QuotaExceeded')};
 assert.throws(()=>h.switch('u','B'),/QuotaExceeded/);
 assert.equal(h.getDb().pets[0].id,'unsaved');assert.equal(h.getKey(),'purrfect_data_v2_u:A');
});
test('cloud pending/revision metadata is account-scoped and legacy pending stops sync',()=>{
 assert.match(cloud,/purrfect_pending_v2_/);assert.match(cloud,/purrfect_revision_v2_/);
 assert.match(cloud,/if\(unscopedPending&&!hasScopedData\)/);
 assert.match(cloud,/dirty=true;conflicted=true;pendingSet\(true\)/);
});