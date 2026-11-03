import test from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './harness.mjs';
test('remote commit followed by failed local ACK retains pending recovery data',async()=>{
 const h=harness();h.attach('A');h.emit('A');h.edit('durable-local');const op=h.run('upload()');h.ls.failSet=()=>true;await h.requests[0].finish();await op;
 assert.equal(h.server.get('families/A/shared/state').data.notes.some(n=>n.id==='durable-local'),true);
 assert.equal(h.pending('u','A'),true);assert.equal(h.state().data.notes.some(n=>n.id==='durable-local'),true);
 h.ls.failSet=null;const reloaded=h.reload();reloaded.auth('u');reloaded.emit('A');assert.equal(reloaded.state().data.notes.some(n=>n.id==='durable-local'),true);assert.equal(reloaded.state().conflicted,true);
});
test('old upload completion cannot release a newer B upload',async()=>{
 const h=harness();h.attach('A');h.emit('A');h.edit('upload-A');const a=h.run('upload()');h.attach('B');h.emit('B');h.edit('upload-B');const b=h.run('upload()');assert.equal(h.requests.length,2);await h.requests[0].finish();await a;assert.equal(h.state().uploading,true);assert.equal(h.pending('u','B'),true);await h.requests[1].finish();await b;assert.equal(h.server.get('families/B/shared/state').data.notes[0].id,'upload-B');
});
test('late upload rejection cannot conflict or detach a newer clean B session',async()=>{
 const h=harness();h.attach('A');h.emit('A');h.edit('upload-A');const a=h.run('upload()');h.attach('B');h.emit('B');const before=h.state();await h.requests[0].finish(Error('old A transport rejection'));await a;assert.equal(h.state().familyId,before.familyId);assert.equal(h.state().enabled,true);assert.equal(h.state().conflicted,false);assert.equal(h.state().data.pets[0].id,'B');
});
test('transaction callback executing after A B A reattach cannot publish stale local payload',async()=>{
 const h=harness();h.attach('A');h.emit('A');h.edit('old-local-A');const a=h.run('upload()');h.attach('B');h.emit('B');h.attach('A');h.emit('A');await h.requests[0].finish();await a;assert.equal(h.writes.length,0,'callback began only after generation was obsolete');assert.equal(h.pending('u','A'),true);
});
test('late cloud-read completion after account change within same family cannot replace new account data',async()=>{
 const h=harness();h.attach('A');h.emit('A');h.run('conflicted=true;');const a=h.run('takeCloudVersion()');h.auth('v');h.attach('A');h.emit('A');h.edit('v-only');await h.requests[0].finish();await a;assert.equal(h.state().data.notes.some(n=>n.id==='v-only'),true);assert.equal(h.pending('v','A'),true);
});
test('stale UI edit rejects visibly and recovery export preserves both tab variants',()=>{
 const first=harness();first.attach('A');first.emit('A');const second=harness({ls:first.ls,server:first.server});second.attach('A');second.emit('A');second.edit('second-durable');assert.throws(()=>first.edit('first-unsaved'),/journal changed|правки|вкладк/i);const backup=first.run('window.purrfectExportRecovery()');assert.match(JSON.stringify(backup),/first-unsaved/);assert.match(JSON.stringify(backup),/second-durable/);assert.equal(first.pending('u','A'),true);
});
test('persistent storage read failure still permits RAM recovery export after failed save',()=>{
 const h=harness();h.attach('A');h.emit('A');h.edit('before-storage-denial');h.ls.failGet=()=>true;assert.throws(()=>h.edit('unsaved-during-denial'));const recovery=h.run('window.purrfectExportRecovery()');assert.match(JSON.stringify(recovery),/before-storage-denial/);assert.match(JSON.stringify(recovery),/unsaved-during-denial/);assert.ok(recovery.journalReadError,'must disclose incomplete durable-journal export');h.ls.failGet=null;assert.equal(h.pending('u','A'),true);
});
