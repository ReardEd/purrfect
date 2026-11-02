import test from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './harness.mjs';
function setup(){const h=harness();h.attach('A');h.emit('A');h.edit('merge-note');h.run('conflicted=true;localConflict=true;setBase(6);');h.inject('remote',h.server.get('families/A/shared/state').data);h.run('mergePreview={fid:"A",revision:7,localSnapshot:JSON.stringify(readLocal()),plan:planNoteMerge(readLocal(),remote)};');return h;}
test('PR3 normal successful merge clears pending and survives reload',async()=>{
 const h=setup();const op=h.run('commitNoteMerge()');await h.requests[0].finish();await op;assert.equal(h.server.get('families/A/shared/state').data.notes.some(n=>n.id==='merge-note'),true);assert.equal(h.state().dirty,false);assert.equal(h.state().conflicted,false);assert.equal(h.state().merging,false);assert.equal(h.pending('u','A'),false);const r=h.reload();r.auth('u');r.emit('A');assert.equal(r.state().data.notes.some(n=>n.id==='merge-note'),true);assert.equal(r.pending('u','A'),false);
});
test('PR3 duplicate invocation starts exactly one transaction and leaves clean result',async()=>{
 const h=setup();const first=h.run('commitNoteMerge()');await h.run('commitNoteMerge()');assert.equal(h.requests.length,1);await h.requests[0].finish();await first;assert.equal(h.writes.length,1);assert.equal(h.state().conflicted,false);assert.equal(h.state().merging,false);assert.equal(h.run('mergeOperation'),null);assert.equal(h.pending('u','A'),false);
});
test('PR3 direct RAM mutation during merge without editSequence is not overwritten',async()=>{
 const h=setup();const op=h.run('commitNoteMerge()');const sequence=h.run('editSequence');h.run('db.weights.push({id:"ram-direct",petId:"A",weight:3.5});');assert.equal(h.run('editSequence'),sequence);await h.requests[0].finish();await op;assert.equal(h.state().data.weights.some(w=>w.id==='ram-direct'),true);assert.equal(h.pending('u','A'),true);assert.equal(h.state().conflicted,true);const recovery=h.run('window.purrfectExportRecovery()');assert.match(JSON.stringify(recovery),/ram-direct/);
});
test('PR3 A B A makes obsolete merge result inert without false pending or conflict',async()=>{
 const h=setup();const op=h.run('commitNoteMerge()');h.attach('B');h.emit('B');h.attach('A');h.emit('A');const read=h.run('takeCloudVersion()');assert.equal(h.requests.length,2);await h.requests[1].finish();await read;const before=h.state();assert.equal(h.pending('u','A'),false);await h.requests[0].finish();await op;assert.deepEqual(h.state(),before);assert.equal(h.pending('u','A'),false);assert.equal(h.run('mergeOperation'),null);
});
