import test from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './harness.mjs';
function setup(){const h=harness();h.attach('A');h.emit('A');h.edit('merge-note');h.run('conflicted=true;setBase(6);');h.inject('remote',h.server.get('families/A/shared/state').data);h.run('mergePreview={fid:"A",revision:7,localSnapshot:JSON.stringify(readLocal()),plan:planNoteMerge(readLocal(),remote)};');return h;}
test('PR3 target: edits during merge remain persisted and pending after reload',async()=>{
 const h=setup();const op=h.run('commitNoteMerge()');h.edit('during-merge');await h.requests[0].finish();await op;assert.equal(h.state().data.notes.some(x=>x.id==='during-merge'),true);assert.equal(h.pending('u','A'),true);const r=h.reload();r.auth('u');r.emit('A');assert.equal(r.state().data.notes.some(x=>x.id==='during-merge'),true);assert.equal(r.state().conflicted,true);
});
test('PR3 guard: late merge error from A must not conflict B',async()=>{
 const h=setup();const op=h.run('commitNoteMerge()');h.attach('B');h.emit('B');await h.requests[0].finish(Error('old error'));await op;assert.equal(h.state().conflicted,false);
});
test('PR3 guard: older operation cannot release newer merge in B',async()=>{
 const h=setup();const a=h.run('commitNoteMerge()');h.attach('B');h.emit('B');h.edit('merge-B');h.run('conflicted=true;');h.inject('remoteB',h.server.get('families/B/shared/state').data);h.run('mergePreview={fid:"B",revision:7,localSnapshot:JSON.stringify(readLocal()),plan:planNoteMerge(readLocal(),remoteB)};');const b=h.run('commitNoteMerge()');await h.requests[0].finish();await a;const active=h.state().merging;await h.requests[1].finish();await b;assert.equal(active,true);
});
test('PR3 guard: same family after account switch cannot accept old merged payload',async()=>{
 const h=setup();const op=h.run('commitNoteMerge()');h.auth('v');h.attach('A');h.emit('A');h.edit('v-local');await h.requests[0].finish();await op;assert.equal(h.state().data.notes.some(x=>x.id==='v-local'),true);assert.equal(h.pending('v','A'),true);
});
