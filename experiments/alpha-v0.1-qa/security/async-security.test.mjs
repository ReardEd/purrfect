import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {harness} from '../tests/harness.mjs';

test('failed auth target-context read must not permit cross-account family creation',async()=>{
 const h=harness();h.attach('A');h.emit('A');h.edit('u-private');h.ls.failGet=k=>k==='purrfect_data_v2_guest';h.auth('v');
 assert.equal(h.state().uid,'v');
 const op=h.click('familyCreate');
 for(let i=0;i<5;i++){
  for(const request of h.requests.filter(r=>!r.securityFinished)){request.securityFinished=true;await request.finish()}
  await Promise.resolve();
 }
 await op;
 const leaked=h.writes.some(w=>w.path.endsWith('/shared/state')&&w.data.data?.notes.some(n=>n.id==='u-private'));
 assert.equal(leaked,false,'old UID u payload was copied into a new family owned by UID v');
});
test('auth context read failure hides previous pet using actual render and locks editing until recovery',()=>{
 const h=harness();h.attach('A','PRIVATE-PET-ALPHA');h.emit('A');h.edit('u-private');
 const app=fs.readFileSync(new URL('../patched/app.js',import.meta.url),'utf8');
 const renderLine=app.split('\n').find(line=>line.startsWith('function render(){'));
 const escapeLine=app.split('\n').find(line=>line.startsWith('function E(s)'));
 assert.ok(renderLine&&escapeLine);
 const display={innerHTML:'PRIVATE-PET-ALPHA'};h.ctx.document.getElementById=id=>id==='app'?display:null;
 h.run(escapeLine+'\n'+renderLine);
 h.ls.failGet=k=>k==='purrfect_data_v2_guest';h.auth('v');
 assert.match(display.innerHTML,/Локальный профиль заблокирован/);assert.equal(display.innerHTML.includes('PRIVATE-PET-ALPHA'),false);
 assert.throws(()=>h.run('save()'),/заблокирован/);assert.throws(()=>h.run('window.purrfectCaptureLocal()'),/заблокирован/);
 const recovery=h.run('window.purrfectExportRecovery()');assert.equal(recovery.live.pets[0].id,'PRIVATE-PET-ALPHA');
 h.ls.failGet=null;h.run('render=()=>{};window.purrfectSwitchLocalContext(null,null);');
 assert.equal(h.run('window.purrfectLocalContextLocked()'),false);assert.equal(h.run('window.purrfectCaptureLocal().data.pets.length'),0);assert.doesNotThrow(()=>h.run('save()'));
 assert.ok(h.readFamily('u','A').notes.some(n=>n.id==='u-private'));
});
