import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,family} from './harness.mjs';
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};}
function submit(h,id,values){h.ctx.FormData=class{constructor(form){this.values=form.values}entries(){return Object.entries(this.values)[Symbol.iterator]()}};const e={target:{id,values},preventDefault(){},submitter:{value:'login'}};return Promise.all((h.events.get('submit')||[]).map(f=>f(e)));}
function click(h,id,dataset={}){return Promise.all((h.events.get('click')||[]).map(f=>f({target:{closest:()=>({id,dataset})}})));}
function fixture(){const h=harness();h.attach('A');h.emit('A');h.server.set('families/C',{owner:'u',members:['u','v'],createdAt:0});h.server.set('families/C/shared/state',{data:family('C'),revision:7});return h;}
function delayedRead(h){const d=deferred(),paths=[];h.ctx.mockApi.getDoc=path=>{paths.push(path);return d.promise};return {...d,paths};}
function spyUpdates(h){const updates=[];h.ctx.mockApi.updateDoc=async(path,data)=>{updates.push({path,data});};h.ctx.mockApi.arrayRemove=(...uids)=>({remove:uids});h.ctx.mockApi.deleteField=()=>({delete:true});return updates;}
test('late familyJoin success after account switch cannot attach old target',async()=>{
 const h=fixture(),d=delayedRead(h);const op=submit(h,'familyJoin',{fid:'C'});h.auth('v');h.attach('B');h.emit('B');d.resolve(h.snapshot(h.server.get('families/C')));await op;assert.equal(h.state().uid,'v');assert.equal(h.state().familyId,'B');assert.equal(h.state().data.pets[0].id,'B');assert.deepEqual(d.paths,['families/C']);
});
test('late familyJoin rejection after family switch cannot poison new UI',async()=>{
 const h=fixture(),d=delayedRead(h);const op=submit(h,'familyJoin',{fid:'C'});h.attach('B');h.emit('B');const before=[...h.notices];d.reject(Error('old C lookup rejection'));await op;assert.equal(h.state().familyId,'B');assert.equal(h.state().conflicted,false);assert.deepEqual(h.notices,before);
});
test('familyJoin response after A B A transition is fenced by generation',async()=>{
 const h=fixture(),d=delayedRead(h);const op=submit(h,'familyJoin',{fid:'C'});h.attach('B');h.emit('B');h.attach('A');h.emit('A');d.resolve(h.snapshot(h.server.get('families/C')));await op;assert.equal(h.state().familyId,'A');assert.equal(h.state().data.pets[0].id,'A');
});
test('current-session successful familyJoin still attaches requested family',async()=>{
 const h=fixture(),d=delayedRead(h);const op=submit(h,'familyJoin',{fid:'C'});d.resolve(h.snapshot(h.server.get('families/C')));await op;assert.equal(h.state().familyId,'C');h.emit('C');assert.equal(h.state().data.pets[0].id,'C');
});
test('late remove-member authorization read cannot update any family after switching',async()=>{
 const h=fixture(),d=delayedRead(h),updates=spyUpdates(h);const op=click(h,'',{familyRemove:'v'});h.attach('B');h.emit('B');d.resolve(h.snapshot(h.server.get('families/A')));await op;assert.equal(updates.length,0);assert.equal(h.state().familyId,'B');
});
test('late accept-owner read after account change cannot write as new user',async()=>{
 const h=fixture();h.server.set('families/A',{owner:'v',members:['u','v'],pendingOwner:'u',createdAt:0});const d=delayedRead(h),updates=spyUpdates(h);const op=click(h,'familyAcceptTransfer');h.auth('v');h.attach('B');h.emit('B');d.resolve(h.snapshot(h.server.get('families/A')));await op;assert.equal(updates.length,0);assert.equal(h.state().uid,'v');assert.equal(h.state().familyId,'B');
});
test('already-issued role update stays bound to A and late success does not notify B',async()=>{
 const h=fixture();const d=deferred(),updates=[];h.ctx.mockApi.arrayRemove=(...uids)=>({remove:uids});h.ctx.mockApi.updateDoc=(path,data)=>{updates.push({path,data});return d.promise};const op=click(h,'',{familyRemove:'v'});for(let i=0;i<10&&!updates.length;i++)await Promise.resolve();assert.equal(updates.length,1);assert.equal(updates[0].path,'families/A');h.attach('B');h.emit('B');const before=[...h.notices];d.resolve();await op;assert.equal(h.state().familyId,'B');assert.deepEqual(h.notices,before);
});
test('already-issued owner acceptance rejection cannot notify or conflict another family',async()=>{
 const h=fixture();h.server.set('families/A',{owner:'v',members:['u','v'],pendingOwner:'u',createdAt:0});const d=deferred(),updates=[];h.ctx.mockApi.deleteField=()=>({delete:true});h.ctx.mockApi.updateDoc=(path,data)=>{updates.push({path,data});return d.promise};const op=click(h,'familyAcceptTransfer');for(let i=0;i<10&&!updates.length;i++)await Promise.resolve();assert.equal(updates[0]?.path,'families/A');h.attach('B');h.emit('B');const before=[...h.notices];d.reject(Error('old acceptance rejected'));await op;assert.equal(h.state().familyId,'B');assert.equal(h.state().conflicted,false);assert.deepEqual(h.notices,before);
});
