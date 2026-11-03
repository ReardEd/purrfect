import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,storage,family} from './harness.mjs';
const key=(u,f)=>'purrfect_data_v2_'+encodeURIComponent(u)+':'+encodeURIComponent(f);
test('A B A after snapshots retains pending A and never uploads B into A',async()=>{
 const h=harness();h.attach('A');h.emit('A');h.edit('unsent-A');h.attach('B');h.emit('B');h.edit('unsent-B');h.attach('A');h.emit('A');assert.equal(h.state().data.pets[0].id,'A');assert.equal(h.state().data.notes[0].id,'unsent-A');
 const op=h.run('upload()');await h.requests[0].finish();await op;assert.equal(h.writes[0].path,'families/A/shared/state');assert.equal(h.writes[0].data.data.pets[0].id,'A');assert.equal(h.pending('u','B'),true);
});
test('two accounts same family preserve independent local payloads and pending',()=>{
 const h=harness();h.attach('A');h.emit('A');h.edit('u-edit');h.auth('v');h.attach('A');h.emit('A');assert.equal(h.state().data.notes.length,0);h.edit('v-edit');h.auth('u');h.emit('A');assert.equal(h.state().data.notes[0].id,'u-edit');assert.equal(h.pending('v','A'),true);
});
test('reload restores scoped unsent data',()=>{
 const h=harness();h.attach('A');h.emit('A');h.edit('pending');const r=h.reload();r.auth('u');r.emit('A');assert.equal(r.state().data.notes[0].id,'pending');assert.equal(r.pending('u','A'),true);
});
test('switch before initial snapshot preserves own local edits and blocks ambiguous upload',async()=>{
 const h=harness();h.attach('A');h.setData(family('local-A'));h.edit('before-snapshot');h.attach('B');h.emit('B');h.attach('A');h.emit('A');assert.equal(h.state().data.notes[0].id,'before-snapshot');assert.equal(h.state().conflicted,true);await h.run('upload()');assert.equal(h.requests.length,0);
});
test('two tabs in different families do not overwrite each other',()=>{
 const one=harness();one.attach('A');one.emit('A');one.edit('one-A');const two=harness({ls:one.ls,server:one.server});two.attach('B');two.emit('B');two.edit('two-B');const r=one.reload();r.attach('A');r.emit('A');assert.equal(r.state().data.notes[0].id,'one-A');assert.equal(one.readFamily('u','B').notes[0].id,'two-B');
});
test('legacy payload and pending/revision stay intact and block automatic upload',async()=>{
 const ls=storage();const raw=JSON.stringify(family('legacy'));ls.setItem('purrfect_v01',raw);ls.setItem('purrfect_pending_A','1');ls.setItem('purrfect_revision_A','3');const h=harness({ls});h.attach('A');h.emit('A');assert.equal(h.state().conflicted,true);await h.run('upload()');assert.equal(h.requests.length,0);assert.equal(ls.getItem('purrfect_v01'),raw);assert.equal(ls.getItem('purrfect_pending_A'),'1');assert.equal(ls.getItem('purrfect_revision_A'),'3');
});
test('SAFETY legacy conflict backup must export legacy unsent data',()=>{
 const ls=storage();ls.setItem('purrfect_v01',JSON.stringify(family('legacy')));ls.setItem('purrfect_pending_A','1');const h=harness({ls});h.attach('A');if(h.isJournal)h.run('saveLegacyBackup()');else h.run('saveLocalBackup()');const backup=JSON.parse(h.backups[0]);const exported=backup.raw!==undefined?JSON.parse(backup.raw):backup;assert.equal(exported.pets[0]?.id,'legacy','conflict backup exported empty scoped data, not preserved legacy');
});
test('SAFETY successful login then logout must not expose A to guest',()=>{
 const h=harness();h.attach('A');h.emit('A');h.edit('A-private');h.auth(null);assert.equal(h.isJournal?JSON.parse(h.state().key).uid:h.state().key,h.isJournal?null:'purrfect_data_v2_guest');assert.equal(h.state().data.pets.length,0);assert.equal(h.readFamily('u','A').notes[0].id,'A-private');
});
test('SAFETY failed departure followed by edit and reconnect cannot lose edit',()=>{
 const h=harness();h.attach('A');h.emit('A');h.run('db.notes.push({id:"unpersisted-before-switch",petId:"A"});');h.ls.failSet=()=>true;assert.throws(()=>h.attach('B'));assert.equal(h.state().data.pets[0].id,'A');h.ls.failSet=null;h.edit('after-switch-error');h.attach('A');h.emit('A');assert.equal(h.state().data.notes.some(n=>n.id==='after-switch-error'),true,'unsent edit was not marked pending while sync was stopped');
});
test('SAFETY pending marker write failure cannot lose saved edit after reload',()=>{
 const h=harness();h.attach('A');h.emit('A');let writes=0;h.ls.failSet=()=>++writes>1;h.edit('saved-but-unmarked');h.ls.failSet=null;const r=h.reload();r.auth('u');r.emit('A');assert.equal(r.state().data.notes[0]?.id,'saved-but-unmarked');
});
test('SAFETY read error on target scope cannot silently replace saved local data',()=>{
 const h=harness();h.attach('A');h.emit('A');h.edit('A-pending');h.attach('B');h.emit('B');h.ls.failGet=k=>{if(k===key('u','A'))return true;try{const r=JSON.parse(h.ls.values.get(k));return r.scope?.uid==='u'&&r.scope?.fid==='A'}catch{return false}};assert.throws(()=>h.attach('A'));h.ls.failGet=null;h.attach('B');assert.equal(h.readFamily('u','A').notes[0]?.id,'A-pending');
});
test('SAFETY two tabs same family must preserve pending edit through remote snapshot and reload',()=>{
 const one=harness();one.attach('A');one.emit('A');const two=harness({ls:one.ls,server:one.server});two.attach('A');two.emit('A');one.edit('one-unsent');one.server.set('families/A/shared/state',{data:family('A'),revision:8});two.emit('A');const r=one.reload();r.auth('u');r.emit('A');assert.equal(r.state().data.notes[0]?.id,'one-unsent');
});
test('SAFETY delayed takeCloudVersion B must never put B payload into A cloud',async()=>{
 const h=harness();h.attach('B','B',7);h.emit('B');h.edit('B-local-conflict');h.run('conflicted=true;setBase(6);');const old=h.run('takeCloudVersion()');h.attach('A','A',7);h.emit('A');await h.requests[0].finish();await old;h.edit('after-return');const op=h.run('upload()');if(h.requests[1])await h.requests[1].finish();await op;
 assert.notEqual(h.server.get('families/A/shared/state').data.pets[0].id,'B','B payload was uploaded to cloud A');
});
test('SAFETY create family must use source captured before first await',async()=>{
 const h=harness();h.setData(family('guest-intended'));const op=h.click('familyCreate');assert.match(h.requests[0].kind,/^set:families\/[^/]+$/);const createdFid=h.requests[0].kind.slice('set:families/'.length);h.attach('B');h.emit('B');await h.requests[0].finish();for(let i=0;i<5&&h.requests.length<2;i++)await Promise.resolve();if(h.requests[1])await h.requests[1].finish();await op;const created=h.server.get('families/'+createdFid+'/shared/state');if(created)assert.equal(created.data.pets[0].id,'guest-intended');else assert.equal(h.state().familyId,'B','safe abort must not attach empty new family');
});
test('stale other-family snapshot is ignored',()=>{
 const h=harness();h.attach('A');h.emit('A');h.attach('B');h.emit('B');h.emit('A',0);assert.equal(h.state().data.pets[0].id,'B');
});
test('normal creation keeps guest source through first family snapshot',async()=>{
 const h=harness();h.setData(family('guest-intended'));const op=h.click('familyCreate');const createdFid=h.requests[0].kind.slice('set:families/'.length);await h.requests[0].finish();for(let i=0;i<5&&h.requests.length<2;i++)await Promise.resolve();await h.requests[1].finish();await op;h.emit(createdFid);assert.equal(h.state().data.pets[0].id,'guest-intended');assert.equal(h.server.get('families/'+createdFid+'/shared/state').data.pets[0].id,'guest-intended');
});
test('disconnect retains pending family storage while guest edits remain separate',async()=>{
 const h=harness();h.attach('A');h.emit('A');h.edit('family-only');await h.click('disconnectFamily');assert.equal(h.isJournal?JSON.parse(h.state().key).uid:h.state().key,h.isJournal?null:'purrfect_data_v2_guest');h.setData(family('guest-only'));h.attach('A');h.emit('A');assert.equal(h.state().data.notes[0].id,'family-only');assert.equal(h.pending('u','A'),true);
});
test('SAFETY subscription failure then local edit must remain recoverable on reconnect',()=>{
 const h=harness();h.attach('A');h.emit('A');h.listeners.at(-1).error(Error('synthetic permission error'));h.edit('after-listener-error');h.attach('A');h.emit('A');assert.equal(h.state().data.notes[0]?.id,'after-listener-error');
});
