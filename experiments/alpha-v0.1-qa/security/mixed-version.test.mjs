import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const harnessUrl=new URL('../tests/harness.mjs',import.meta.url);
const mainCloud=fs.readFileSync(new URL('../reference-main/cloud.js',import.meta.url),'utf8');
let source=fs.readFileSync(harnessUrl,'utf8');
source=source.replace("const cloud=fs.readFileSync(new URL('../'+variant+'/cloud.js',import.meta.url),'utf8');",'const cloud='+JSON.stringify(mainCloud)+';');
source=source.replaceAll('import.meta.url',JSON.stringify(harnessUrl.href));
const {harness,storage,family}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

test('new app with stale main cloud must not upload guest data into remembered family',async()=>{
 const ls=storage();ls.setItem('purrfect_pending_A','1');ls.setItem('purrfect_revision_A','7');
 const h=harness({ls});h.setData(family('B-guest'));h.attach('A','A',7);h.emit('A');
 try{const op=h.run('upload()');if(h.requests[0])await h.requests[0].finish();await op}catch{}
 assert.notEqual(h.server.get('families/A/shared/state').data.pets[0].id,'B-guest','mixed-release old cloud uploaded new-app guest data into A');
});
test('old app with new cloud refuses boot before SDK import or transaction',async()=>{
 const oldApp=fs.readFileSync(new URL('../reference-main/app.js',import.meta.url),'utf8');
 let converse=fs.readFileSync(harnessUrl,'utf8');
 converse=converse.replace("const app=fs.readFileSync(new URL('../'+variant+'/app.js',import.meta.url),'utf8');",'const app='+JSON.stringify(oldApp)+';');
 converse=converse.replaceAll('firebaseConfig=null','firebaseConfig={apiKey:"synthetic",projectId:"purrfect-296c9"}');
 converse=converse.replaceAll('import.meta.url',JSON.stringify(harnessUrl.href));
 const oldHarness=await import('data:text/javascript;base64,'+Buffer.from(converse).toString('base64'));
 const h=oldHarness.harness();
 await h.run('begin()');
 assert.ok(h.notices.some(x=>String(x).includes('Несовместимые версии приложения и синхронизации')),'expected explicit protocol refusal before Firebase SDK imports');
 assert.equal(h.requests.length,0);assert.equal(h.writes.length,0);
 assert.throws(()=>h.run('localSnapshot()'),/Несовместимая версия локального хранилища/);
});
