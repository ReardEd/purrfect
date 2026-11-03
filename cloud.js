/* Purrfect family sync v1.4.1 (optimistic transactions): opt-in Firebase; requires configured project + Firestore rules. */
import { firebaseConfig } from './firebase-config.js';
let auth=null, store=null, api=null, account=null, familyId='', unsub=null, started=false, enabled=false, busy=false, timer=null, lastError='';
let sdk=null;
let dirty=false,conflicted=false,uploading=false,editSequence=0,baseRevision=null,baseKnown=false;
let sessionGeneration=0,mergeOperation=null;
const STORAGE_PROTOCOL='purrfect-iron-v1';
let uploadOperation=null,createOperation=null,localConflict=false;
// Data/pending/revision live together in the journal, never in separate keys.
function pendingSet(value){dirty=!!value}
function setBase(rev){baseRevision=rev??null;baseKnown=true}
function localSnapshot(){if(window.purrfectStorageProtocol?.()!==STORAGE_PROTOCOL)throw Error('Несовместимая версия локального хранилища. Синхронизация запрещена.');const capture=window.purrfectCaptureLocal();const v=capture.view;dirty=v.pending;baseRevision=v.baseRevision;baseKnown=v.baseKnown;conflicted=localConflict||v.conflicted||v.legacyPending;return capture}
function captureSession(){return {generation:sessionGeneration,account,uid:account?.uid||null,fid:familyId,context:window.purrfectActiveLocalContext()}}
function ownsSession(s){return s.generation===sessionGeneration&&s.account===account&&s.uid===(account?.uid||null)&&s.fid===familyId&&s.context===window.purrfectActiveLocalContext()}
function validFamilyCapture(c,s){return !!s.uid&&!!s.fid&&c.view.scope.uid===s.uid&&c.view.scope.fid===s.fid&&(!firebaseConfig?.projectId||c.view.scope.projectId===firebaseConfig.projectId)}
function sameHeadIds(a,b){return JSON.stringify([...a].sort())===JSON.stringify([...b].sort())}
function exportJSON(data,name){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function saveLegacyBackup(){exportJSON(window.purrfectExportLegacy(),'purrfect-legacy-recovery.json')}
function conflictMessage(){message('⚠️ Конфликт: семейные данные изменились на другом устройстве. Ваши локальные изменения сохранены. Скачайте резервную копию и выберите облачную версию либо разберите изменения вручную.',true)}
function saveLocalBackup(){
exportJSON(window.purrfectExportRecovery(),'purrfect-local-recovery-'+new Date().toISOString().slice(0,10)+'.json');
}

/* Merge beta: review and commit ONLY local-only notes, never overwrite an existing record. */
let mergePreview=null,merging=false;
function canonicalRecord(value){
if(Array.isArray(value))return value.map(canonicalRecord);
if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalRecord(value[key])]));
return value;
}
const sameRecord=(a,b)=>JSON.stringify(canonicalRecord(a))===JSON.stringify(canonicalRecord(b));
function planNoteMerge(local,remote){
const localNotes=Array.isArray(local?.notes)?local.notes:[];
const remoteNotes=Array.isArray(remote?.notes)?remote.notes:[];
const remotePets=new Set(Array.isArray(remote?.pets)?remote.pets.map(x=>x.id):[]);
const remoteById=new Map(remoteNotes.map(n=>[n.id,n]));
const localDeleted=new Set((Array.isArray(local?.noteTombstones)?local.noteTombstones:[]).map(x=>x.id));
const remoteDeleted=new Set((Array.isArray(remote?.noteTombstones)?remote.noteTombstones:[]).map(x=>x.id));
const additions=[],changed=[],invalid=[],removed=[];
for(const note of localNotes){
if(!note||typeof note.id!=='string'||!note.id||typeof note.petId!=='string'||!remotePets.has(note.petId)){invalid.push(note);continue}
if(remoteDeleted.has(note.id)||localDeleted.has(note.id)){removed.push(note);continue}
if(remoteById.has(note.id)){if(!sameRecord(remoteById.get(note.id),note))changed.push(note);continue}
additions.push(note);
}
for(const marker of Array.isArray(local?.noteTombstones)?local.noteTombstones:[]){if(marker?.id&&remoteById.has(marker.id))removed.push({id:marker.id,name:'Удалённая локально заметка'})}
return {additions,changed,invalid,removed,remoteCount:remoteNotes.length,localCount:localNotes.length};
}
async function prepareNoteMerge(){
if(!conflicted||!enabled||!familyId)return message('Слияние доступно только при конфликте.',true);
const session=captureSession(),capture=localSnapshot(),fid=familyId,local=capture.data;
if(!validFamilyCapture(capture,session))throw Error('Локальный профиль не принадлежит этой семье.');
const snap=await api.getDocFromServer(docState(fid));
if(!ownsSession(session)||!conflicted)return;
const fresh=localSnapshot();if(!sameHeadIds(fresh.view.headIds,capture.view.headIds)){message('Локальные данные изменились. Повторите просмотр.',true);return;}
if(!snap.exists()||!snap.data()?.data)throw Error('Нет облачной версии.');
const record=snap.data(),plan=planNoteMerge(local,record.data);
mergePreview={fid,revision:record.revision??null,plan,localSnapshot:JSON.stringify(local),heads:capture.view.headIds,sessionGeneration};
renderPanel();
const el=$('familyMergePreview');if(!el)return;
const safeNames=plan.additions.slice(0,20).map(n=>'<li>'+esc(String(n.name||'Заметка').slice(0,120))+' · '+esc(String(n.date||'').slice(0,20))+'</li>').join('');
el.innerHTML='<div class="familyBox"><b>📋 Предварительный просмотр слияния</b>'+
'<p class="familyHint">Новых локальных заметок для добавления: <b>'+plan.additions.length+'</b>. Различающихся записей с одинаковым ID: <b>'+plan.changed.length+'</b>. Записей с неизвестным питомцем/ошибкой ID: <b>'+plan.invalid.length+'</b>. Удалённых или помеченных для удаления: <b>'+plan.removed.length+'</b>.</p>'+
(plan.additions.length?'<ul>'+safeNames+'</ul>':'<p class="familyHint">Нет новых заметок для добавления.</p>')+
'<p class="familyHint">Только новые заметки; удаления не объединяются. Заметки с отметками удаления исключены из добавления. При разногласиях об удалении можно явно добавить ТОЛЬКО независимые новые заметки; удалённые не восстанавливаются. Локальную копию обязательно сохраните.</p>'+
(plan.additions.length&&!plan.changed.length&&!plan.invalid.length?'<button id="familyCommitNoteMerge" class="action" type="button">✅ '+(plan.removed.length?'Добавить только безопасные новые заметки ('+plan.additions.length+'), НЕ восстанавливая удалённые':'Подтвердить добавление '+plan.additions.length+' заметок')+'</button>':'<p class="familyHint">Слияние заблокировано из-за неоднозначных записей или отсутствия новых заметок.</p>')+
'<button id="familyCancelNoteMerge" class="action ghost" type="button">Отмена</button></div>';
}
async function commitNoteMerge(){
if(merging||mergeOperation||!mergePreview||!conflicted||!enabled||!account)return;
const preview=mergePreview,fid=familyId,uid=account.uid,sequenceAtStart=editSequence,session=captureSession(),capture=localSnapshot();
const ownsMerge=()=>ownsSession(session)&&enabled;
if(!validFamilyCapture(capture,session))throw Error('Неверный локальный контекст семьи.');
if(preview.heads&&!sameHeadIds(preview.heads,capture.view.headIds))throw Error('Локальный журнал изменился; повторите просмотр.');
const operation=Symbol('note-merge');
if(preview.fid!==fid||preview.plan.changed.length||preview.plan.invalid.length||!preview.plan.additions.length)throw Error('Проверка слияния не пройдена.');
if(JSON.stringify(readLocal())!==preview.localSnapshot){mergePreview=null;throw Error('Локальные данные изменились. Повторите предварительный просмотр.')}
if(!confirm('Добавить ТОЛЬКО '+preview.plan.additions.length+' новых заметок? Удалённые записи НЕ восстанавливаются. Все прочие локальные изменения, кроме этих заметок, НЕ переносятся. Обе резервные копии должны быть сохранены.'))return;
if(!ownsMerge()||merging||mergeOperation)return;
mergeOperation=operation;merging=true;
try{
const committed=await api.runTransaction(store,async tx=>{
if(!ownsMerge())throw Error('Сессия слияния завершена.');
const ref=docState(fid),snap=await tx.get(ref);if(!ownsMerge())throw Error('Сессия слияния завершена.');if(!snap.exists()||!snap.data()?.data)throw Error('База недоступна');
const current=snap.data(),rev=current.revision??null;
if(rev!==preview.revision){const e=new Error('Облачная база изменилась. Повторите просмотр.');e.purrfectConflict=true;throw e}
const freshPlan=planNoteMerge(JSON.parse(preview.localSnapshot),current.data);
if(freshPlan.changed.length||freshPlan.invalid.length||freshPlan.additions.length!==preview.plan.additions.length
  ||freshPlan.additions.some(n=>!preview.plan.additions.some(p=>sameRecord(p,n)))
  ||freshPlan.removed.length!==preview.plan.removed.length){
 throw Error('Состав слияния изменился. Повторите предварительный просмотр.');
}
const tombstones=new Set((current.data.noteTombstones||[]).map(x=>x.id));
if(preview.plan.additions.some(n=>tombstones.has(n.id)||(current.data.notes||[]).some(x=>x.id===n.id)))
 throw Error('Обнаружена повторная или удалённая заметка. Запись отменена.');
const updated={...current.data,notes:[...(current.data.notes||[]),...preview.plan.additions]};
if(JSON.stringify(updated).length>720000)throw Error('Слишком большой документ для синхронизации.');
tx.update(ref,{data:updated,revision:(rev??0)+1,updatedAt:api.serverTimestamp(),updatedBy:uid});
return {data:updated,revision:(rev??0)+1};
});
// A successful server transaction is not permission to replace local edits made while it awaited Firestore.
if(!ownsMerge()||mergeOperation!==operation)return;
if(sequenceAtStart!==editSequence||!sameHeadIds(localSnapshot().view.headIds,capture.view.headIds)||JSON.stringify(readLocal())!==preview.localSnapshot){
 mergePreview=null;dirty=true;conflicted=true;localConflict=true;
 message('Слияние добавило заметки в облако, но локальные данные изменились во время ожидания. Новые правки сохранены локально; облачная отправка заблокирована до повторной проверки конфликта. Скачайте резервную копию.',true);
 renderPanel();return;
}
window.purrfectCommitRemote(committed.data,{revision:committed.revision,parents:capture.view.headIds,reason:'resolve',sessionGeneration});
clearTimeout(timer);editSequence++;localConflict=false;mergePreview=null;localSnapshot();message('Добавлены '+preview.plan.additions.length+' заметок. Проверьте обе учётные записи ☁️');renderPanel();
}catch(err){
if(ownsMerge()&&mergeOperation===operation){
 mergePreview=null;conflicted=true;localConflict=true;
 message('Сервер мог уже сохранить слияние. Локальная версия сохранена; повторите проверку:  '+(err?.message||String(err))+' Локальные данные сохранены.',true);renderPanel();
}
}finally{
if(mergeOperation===operation){mergeOperation=null;merging=false}
}
}
async function takeCloudVersion(){
if(!familyId||!account)return;
const session=captureSession(),capture=localSnapshot(),sequence=editSequence;
if(!validFamilyCapture(capture,session))throw Error('Неверный локальный профиль.');
if(!confirm('Заменить локальные записи облачной версией? Исходные записи останутся в восстановительном журнале.'))return;
const snap=await api.getDocFromServer(docState(session.fid));
if(!ownsSession(session))return;
const latest=localSnapshot();
if(sequence!==editSequence||!sameHeadIds(latest.view.headIds,capture.view.headIds)){localConflict=true;conflicted=true;message('За время ожидания появились локальные правки. Облачная версия не применена.',true);return}
if(!snap.exists()||!snap.data()?.data)throw Error('Облачные данные недоступны');
const record=snap.data();window.purrfectCommitRemote(record.data,{revision:record.revision??null,parents:capture.view.headIds,reason:'resolve',sessionGeneration});
localConflict=false;mergePreview=null;editSequence++;clearTimeout(timer);localSnapshot();message('Загружена актуальная облачная версия ☁️');renderPanel();
}
const familyKey=(uid)=>'purrfect_family_'+uid;
const inviteId=(()=>{try{return new URL(location.href).searchParams.get('invite')||''}catch{return ''}})();
const inviteUrl=fid=>`${location.origin}${location.pathname}?invite=${encodeURIComponent(fid)}`;
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function state(){return !firebaseConfig?'Облачный доступ требует настройки Firebase. Локальные данные сохранены.':!account?'Облако готово к входу. Локальные данные сохранены.':familyId&&enabled?'Общие данные подключены ☁️':`Вход: ${account.email}. Семья пока не подключена.`}
function message(msg,bad=false){lastError=msg;const e=$('familyMessage');if(e){e.className='familyState'+(bad?' familyError':'');e.textContent=msg}}
function fail(err){const code=err?.code||'';const friendly={ 'auth/invalid-email':'Проверьте адрес электронной почты.', 'auth/invalid-credential':'Неверная почта или пароль.', 'auth/email-already-in-use':'Этот адрес уже зарегистрирован.', 'auth/weak-password':'Выберите более надёжный пароль.', 'auth/too-many-requests':'Слишком много попыток. Повторите позже.', 'permission-denied':'Нет прав доступа к этой семье.'};message(friendly[code]||'Ошибка: '+(code||err?.message||String(err)),true)}
function stop(){sessionGeneration++;mergeOperation=null;uploadOperation=null;createOperation=null;mergePreview=null;merging=false;if(unsub)unsub();unsub=null;enabled=false;familyId='';clearTimeout(timer);dirty=false;conflicted=false;localConflict=false;uploading=false;busy=false;baseKnown=false;baseRevision=null;editSequence++}
function docState(fid){return api.doc(store,'families',fid,'shared','state')}
function readLocal(){return window.purrfectLocalData?.(STORAGE_PROTOCOL)}
async function upload(){
if(!enabled||!familyId||!account||uploadOperation||merging)return;
const session=captureSession(),capture=localSnapshot();
if(!validFamilyCapture(capture,session))throw Error('Локальные данные принадлежат другому контексту.');
if(conflicted||!dirty)return;
if(!baseKnown){message('Ждём подтверждённую исходную ревизию. Локальные изменения сохранены.',true);return}
const data=capture.data,base=capture.view.baseRevision,operation=Symbol('upload');
if(JSON.stringify(data).length>720000){message('Облачный документ слишком велик. Локальные записи сохранены.',true);return}
uploadOperation=operation;uploading=true;let serverCommitted=false;
try{
 const revision=await api.runTransaction(store,async tx=>{
  if(!ownsSession(session))throw Error('Сессия отправки завершена.');
  const ref=docState(session.fid),snap=await tx.get(ref);
  if(!ownsSession(session))throw Error('Сессия отправки завершена.');
  if(!snap.exists())throw Error('Семейная база недоступна');
  const actual=snap.data().revision??null;
  if(actual!==base){const e=Error('Конфликт ревизий');e.purrfectConflict=true;throw e}
  tx.update(ref,{data,revision:(actual??0)+1,updatedAt:api.serverTimestamp(),updatedBy:session.uid});return (actual??0)+1;
 });
 serverCommitted=true;
 if(!ownsSession(session)||uploadOperation!==operation)return;
 // Exact parents: a new edit in any tab can never be marked synced by this ack.
 window.purrfectCommitRemote(data,{revision,parents:capture.view.headIds,reason:'ack',sessionGeneration});
 localConflict=false;localSnapshot();message('Изменения сохранены в облаке ☁️');
}catch(err){
 if(!ownsSession(session)||uploadOperation!==operation)return;
 localConflict=true;conflicted=true;
 message((serverCommitted?'Сервер уже мог сохранить изменения; локальная очередь не снята. ':'Отправка остановлена; локальная очередь сохранена. ')+(err.message||err),true);
}finally{if(uploadOperation===operation){uploadOperation=null;uploading=false}}
}
function localChanged(){
 editSequence++;
 // Local queue is saved by app.save even when disconnected or after a subscription error.
 try{localSnapshot()}catch(err){fail(err);return}
 if(!enabled||!account||!familyId||conflicted)return;
 const session=captureSession();clearTimeout(timer);timer=setTimeout(()=>{if(ownsSession(session))upload().catch(err=>{if(ownsSession(session))fail(err)})},850);
}
function watch(fid){
if(!account)throw Error('Для семейной синхронизации нужен аккаунт.');
const uid=account.uid;
// Validate and read the target before tearing down the current transport/context.
window.purrfectSwitchLocalContext(uid,fid);
stop();familyId=fid;enabled=true;
try{localStorage.setItem(familyKey(uid),fid)}catch(err){stop();throw err}
const capture=localSnapshot(),session=captureSession();
if(!validFamilyCapture(capture,session)){stop();throw Error('Проект или локальная семья не совпадают.');}
if(capture.view.legacyPending)message('Есть неизвестные старые pending. Скачайте отдельную legacy-копию; автоматическая отправка запрещена.',true);
unsub=api.onSnapshot(docState(fid),snap=>{
 if(!ownsSession(session)||!enabled)return;
 try{
  if(!snap.exists()){message('Семейная база пока не содержит записей.');return}
  if(snap.metadata.hasPendingWrites||merging)return;
  if(snap.metadata.fromCache){message('Ждём подтверждённый снимок сервера. Локальные записи сохранены.',true);return}
  const record=snap.data();if(!record?.data)return;
  const current=localSnapshot();
  if(dirty||conflicted){
   if(!baseKnown||record.revision!==baseRevision){localConflict=true;conflicted=true;conflictMessage();renderPanel();return}
   if(!uploading&&!conflicted){clearTimeout(timer);timer=setTimeout(()=>{if(ownsSession(session))upload().catch(err=>{if(ownsSession(session))fail(err)})},850)}
  }else{
   window.purrfectCommitRemote(record.data,{revision:record.revision??null,parents:current.view.headIds,reason:'remote',sessionGeneration});localSnapshot();
  }
  renderPanel();
 }catch(err){localConflict=true;conflicted=true;fail(err);renderPanel()}
},err=>{if(!ownsSession(session))return;stop();fail(err);renderPanel()});
renderPanel();
}
async function begin(){if(started||!firebaseConfig?.apiKey||!firebaseConfig?.projectId)return;started=true;try{if(window.purrfectStorageProtocol?.()!==STORAGE_PROTOCOL)throw Error('Несовместимые версии приложения и синхронизации; требуется полная перезагрузка.');if(window.purrfectLocalProject()!==firebaseConfig.projectId)throw Error('Проект локального хранилища не совпадает с Firebase. Синхронизация заблокирована.');const [app,authlib,fire]=await Promise.all([import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js'),import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js')]);const fb=app.initializeApp(firebaseConfig);auth=authlib.getAuth(fb);store=fire.getFirestore(fb);api={...authlib,...fire};authlib.onAuthStateChanged(auth,u=>{stop();account=u;try{if(u){const fid=localStorage.getItem(familyKey(u.uid));if(fid)watch(fid);else window.purrfectSwitchLocalContext?.(null,null)}else window.purrfectSwitchLocalContext?.(null,null)}catch(e){window.purrfectLockLocalContext?.(e);fail(e)}renderPanel()})}catch(e){started=false;fail(e);renderPanel()}}
function renderPanel(){const panel=$('family-panel');if(!panel)return;const recoveryButtons='<div class="familyBox"><button class="action ghost" id="familyBackupRecovery">📥 Скачать восстановительный журнал</button><button class="action ghost" id="familyBackupLegacy">📥 Скачать исходные legacy-данные</button></div>';
if(!firebaseConfig){panel.innerHTML=recoveryButtons+`<div class="familyBox"><b>☁️ Настройка Firebase ещё не выполнена</b><p class="familyHint">Для реальной регистрации и обмена записями нужно создать бесплатный проект Firebase и вписать параметры в <code>firebase-config.js</code>. Инструкция лежит в SETUP-FIREBASE.md в архиве.</p><p class="familyHint">До подключения всё работает локально, как раньше.</p></div>`;return}
if(!started){panel.innerHTML=recoveryButtons+'<div class="familyState">Подключаем облако…</div>';begin();return}
if(!account){panel.innerHTML=recoveryButtons+`<div class="familyBox"><b>❤️ Войти в Purrfect</b><p class="familyHint">Каждому участнику семейного пространства нужен отдельный аккаунт. Пароль минимум 6 символов, лучше длиннее.</p><form id="familyAuth"><label>E-mail</label><input name="email" type="email" required autocomplete="username"><label>Пароль</label><input name="password" type="password" minlength="6" required autocomplete="current-password"><div class="familyButtons"><button class="action" name="mode" value="login">Войти</button><button class="action ghost" name="mode" value="signup">Зарегистрироваться</button></div></form><button class="action ghost" id="familyResetPassword" type="button">Забыли пароль?</button><p class="familyHint">Для восстановления используйте постоянную почту, к которой есть доступ.</p></div><div id="familyMessage" class="familyState">${esc(lastError||'')}</div>`;return}
const header=`<div class="familyBox"><b>👤 ${esc(account.email)}</b><p class="familyHint">ID аккаунта (можно отправить владельцу семейного профиля):</p><code>${esc(account.uid)}</code><div class="familyButtons"><button class="action ghost" id="copyUid">📋 Скопировать мой ID</button><button class="action ghost" id="familyLogout">Выйти из аккаунта</button></div><p class="familyHint">Почта: ${account.emailVerified?'✅ подтверждена':'✉️ пока не подтверждена'}</p>${account.emailVerified?'':'<div class="familyButtons"><button class="action ghost" id="familyVerifyEmail">Отправить письмо подтверждения</button><button class="action ghost" id="familyCheckEmail">Проверить подтверждение</button></div>'}</div>`;
if(!familyId){panel.innerHTML=recoveryButtons+header+`<div class="familyBox"><b>🐾 Создать семью</b><p class="familyHint">Используйте это на основном устройстве, где уже есть записи питомца. Данные будут загружены в новый семейный профиль.</p><button class="action" id="familyCreate">Создать общий профиль и загрузить мои данные</button></div><div class="familyBox"><b>❤️ Подключиться к семье</b><p class="familyHint">Попросите владельца сначала добавить ваш ID аккаунта, затем введите семейный ID.</p><form id="familyJoin"><label>Семейный ID</label><input name="fid" required placeholder="ID семейного профиля" value="${esc(inviteId)}"><button class="action ghost">Подключить общий профиль</button></form></div><div id="familyMessage" class="familyState">${esc(lastError||'')}</div>`;return}
panel.innerHTML=recoveryButtons+header+`<div class="familyBox"><b>☁️ Общее пространство подключено</b><p class="familyHint">ID семьи:</p><code>${esc(familyId)}</code><button class="action ghost" id="copyFamily">📋 Скопировать ID семьи</button><button class="action ghost" id="copyFamilyInvite">🔗 Скопировать ссылку-приглашение</button><p class="familyHint">Ссылка только подставляет ID семьи. Владелец всё равно должен разрешить доступ по ID аккаунта участника.</p><p class="familyHint">Синхронизация использует проверку ревизии. При одновременных изменениях автоматическая запись останавливается, а локальные данные сохраняются для ручного разрешения конфликта.</p>${conflicted?`<div class="familyBox"><b>⚠️ Обнаружен конфликт изменений</b><p class="familyHint">Локальная версия не отправляется автоматически. Сначала сохраните её, затем при необходимости загрузите облачную.</p><button class="action" id="familyBackupConflict" type="button">📥 Скачать локальную резервную копию</button><button class="action ghost" id="familyUseCloud" type="button">☁️ Загрузить облачную версию</button><button class="action ghost" id="familyPreviewNoteMerge" type="button">🔀 Посмотреть слияние заметок (бета)</button><div id="familyMergePreview"></div></div>`:dirty?`<p class="familyHint">⏳ Есть ещё не отправленные изменения.</p>`:'' }<div id="ownerTools"></div><button class="action ghost" id="disconnectFamily">Отключить семью на этом устройстве</button></div><div id="familyMessage" class="familyState">${esc(lastError||'')}</div>`;
const panelSession=captureSession();api.getDoc(api.doc(store,'families',familyId)).then(s=>{if(!ownsSession(panelSession)||!s.exists())return;const f=s.data(),el=$('ownerTools');if(!el)return;
const isOwner=f.owner===account.uid;
const rows=(f.members||[]).map(uid=>`<div class="familyMember"><span><b>${uid===f.owner?'👑 Владелец':uid===account.uid?'👤 Вы':'👤 Участник'}</b><br><small>${esc(uid)}</small></span>${isOwner&&uid!==account.uid?`<button class="action ghost" data-family-remove="${esc(uid)}" type="button">Убрать</button>`:''}</div>`).join('');
el.innerHTML=`<div class="separator"></div><b>👥 Участники семьи (${f.members?.length||0}/5)</b>${rows}`+
(isOwner?`<div class="separator"></div><b>Добавить участника</b><p class="familyHint">Попросите участника создать аккаунт и передать свой ID.</p><form id="familyInvite"><label>ID участника</label><input name="uid" required placeholder="ID аккаунта участника"><button class="action">Разрешить доступ</button></form><div class="separator"></div><b>👑 Передача владельца</b><p class="familyHint">Выберите участника, которому предложить роль. Он должен подтвердить её в своём аккаунте.</p>${f.pendingOwner?`<p class="familyHint">Предложение отправлено: ${esc(f.pendingOwner)}</p><button class="action ghost" id="familyCancelTransfer" type="button">Отменить предложение</button>`:`<form id="familyOfferTransfer"><label>Новый владелец</label><select name="uid" required><option value="">Выберите участника</option>${f.members.filter(uid=>uid!==account.uid).map(uid=>`<option value="${esc(uid)}">${esc(uid)}</option>`).join('')}</select><button class="action ghost">Предложить роль владельца</button></form>`}`:f.pendingOwner===account.uid?`<div class="separator"></div><b>👑 Вам предлагают стать владельцем семьи</b><p class="familyHint">После подтверждения вы сможете управлять участниками, прежний владелец останется участником.</p><button class="action" id="familyAcceptTransfer" type="button">Принять роль владельца</button>`:f.pendingOwner?`<p class="familyHint">Ожидается подтверждение передачи роли другим участником.</p>`:'');
}).catch(err=>{if(ownsSession(panelSession))fail(err)})}
function formData(el){return Object.fromEntries(new FormData(el).entries())}
document.addEventListener('submit',async e=>{if(!['familyAuth','familyJoin','familyInvite','familyOfferTransfer'].includes(e.target.id))return;e.preventDefault();const form=e.target,values=formData(form),actionSession=captureSession();try{if(form.id==='familyAuth'){const mode=e.submitter?.value||'login';if(mode==='signup'){await api.createUserWithEmailAndPassword(auth,values.email.trim(),values.password)}else{await api.signInWithEmailAndPassword(auth,values.email.trim(),values.password)}if(!ownsSession(actionSession))return;message('Успешный вход ☁️');return}if(!account)throw Error('Сначала войдите в аккаунт');if(form.id==='familyJoin'){const fid=values.fid.trim();const m=await api.getDoc(api.doc(store,'families',fid));if(!ownsSession(actionSession))return;if(!m.exists())throw Error('Семья не найдена или нет доступа. Владелец должен добавить ваш ID.');if(!m.data().members.includes(account.uid))throw Error('Владелец пока не добавил этот аккаунт');watch(fid);return}if(form.id==='familyOfferTransfer'){if(!familyId)throw Error('Семья не выбрана');if(!confirm('Предложить передачу роли владельца выбранному участнику?'))return;const ref=api.doc(store,'families',actionSession.fid);const snap=await api.getDoc(ref);if(!ownsSession(actionSession))return;if(snap.data()?.owner!==account.uid)throw Error('Передавать роль может только текущий владелец');if(!snap.data().members.includes(values.uid)||values.uid===account.uid)throw Error('Выберите другого участника');await api.updateDoc(ref,{pendingOwner:values.uid});if(!ownsSession(actionSession))return;message('Предложение отправлено. Попросите участника открыть семейный доступ.');renderPanel();return}if(form.id==='familyInvite'){if(!familyId)throw Error('Семья не выбрана');const uid=values.uid.trim();if(!/^[\w-]{12,128}$/.test(uid))throw Error('Неверный ID участника');await api.updateDoc(api.doc(store,'families',actionSession.fid),{members:api.arrayUnion(uid)});if(!ownsSession(actionSession))return;message('Участник добавлен. Передайте ему ID семьи для подключения.');renderPanel()}}catch(err){if(ownsSession(actionSession))fail(err)}});
document.addEventListener('click',async e=>{const t=e.target.closest('button');if(!t)return;const actionSession=captureSession();try{if(t.id==='familyPreviewNoteMerge'){await prepareNoteMerge();return}if(t.id==='familyCommitNoteMerge'){await commitNoteMerge();return}if(t.id==='familyCancelNoteMerge'){mergePreview=null;renderPanel();return}if(t.id==='familyBackupLegacy'){saveLegacyBackup();message('Исходная legacy-копия подготовлена.');return}if(t.id==='familyBackupConflict'||t.id==='familyBackupRecovery'){saveLocalBackup();message('Локальная резервная копия подготовлена.');return}if(t.id==='familyUseCloud'){await takeCloudVersion();return}if(t.dataset.familyRemove){if(!account||!familyId)return;const uid=t.dataset.familyRemove;if(!confirm('Отозвать доступ участника? Он больше не сможет читать и изменять семейные данные.'))return;const ref=api.doc(store,'families',actionSession.fid);const snap=await api.getDoc(ref);if(!ownsSession(actionSession))return;if(snap.data()?.owner!==account.uid||uid===account.uid)throw Error('Нельзя удалить владельца');if(snap.data()?.pendingOwner===uid)throw Error('Сначала отмените предложение передачи роли');await api.updateDoc(ref,{members:api.arrayRemove(uid)});if(!ownsSession(actionSession))return;message('Доступ участника отозван.');renderPanel();return}if(t.id==='familyCancelTransfer'){const ref=api.doc(store,'families',actionSession.fid);await api.updateDoc(ref,{pendingOwner:api.deleteField()});if(!ownsSession(actionSession))return;message('Предложение передачи роли отменено.');renderPanel();return}if(t.id==='familyAcceptTransfer'){if(!confirm('Принять роль владельца семьи?'))return;const ref=api.doc(store,'families',actionSession.fid);const snap=await api.getDoc(ref);if(!ownsSession(actionSession))return;if(snap.data()?.pendingOwner!==account.uid)throw Error('Предложение больше не активно');await api.updateDoc(ref,{owner:account.uid,pendingOwner:api.deleteField()});if(!ownsSession(actionSession))return;message('Теперь вы владелец семейного пространства 👑');renderPanel();return}if(t.id==='familyResetPassword'){const email=prompt('Укажите адрес электронной почты для восстановления пароля:');if(email===null)return;if(!email.trim())throw Error('Введите адрес электронной почты');await api.sendPasswordResetEmail(auth,email.trim());if(!ownsSession(actionSession))return;message('Если адрес зарегистрирован, на него придёт письмо для сброса пароля.');return}if(t.id==='familyVerifyEmail'){if(!account)return;await api.sendEmailVerification(account);if(!ownsSession(actionSession))return;message('Письмо подтверждения отправлено. Проверьте почту.');return}if(t.id==='familyCheckEmail'){if(!account)return;await account.reload();if(!ownsSession(actionSession))return;account=auth.currentUser;renderPanel();message(account.emailVerified?'Адрес электронной почты подтверждён ✅':'Почта ещё не подтверждена. Проверьте входящие и спам.');return}if(t.id==='familyLogout'){await api.signOut(auth);if(ownsSession(actionSession)){window.purrfectSwitchLocalContext(null,null);stop();account=null;renderPanel()}return}if(t.id==='copyUid'){await navigator.clipboard.writeText(account.uid);if(!ownsSession(actionSession))return;message('ID аккаунта скопирован');return}if(t.id==='copyFamilyInvite'){await navigator.clipboard.writeText(inviteUrl(familyId));if(!ownsSession(actionSession))return;message('Ссылка-приглашение скопирована. Для входа владельцу нужно добавить ID аккаунта участника.');return}if(t.id==='copyFamily'){await navigator.clipboard.writeText(familyId);if(!ownsSession(actionSession))return;message('ID семьи скопирован');return}if(t.id==='disconnectFamily'){if(!confirm('Отключить синхронизацию на этом устройстве? Локальные данные останутся.'))return;window.purrfectSwitchLocalContext(null,null);stop();localStorage.removeItem(familyKey(account.uid));renderPanel();return}if(t.id==='familyCreate'){
if(busy||createOperation||!account)return;
const session=captureSession();let source=window.purrfectCaptureLocal();
if(source.view.scope.uid!==null&&source.view.scope.uid!==session.uid)throw Error('Исходный локальный профиль принадлежит другому аккаунту. Переключите контекст или экспортируйте восстановительную копию.');
if(!confirm('Создать семью из текущего сохранённого снимка?'))return;
const fid=crypto.randomUUID(),uid=account.uid,operation=Symbol('create-family');
source=window.purrfectRecordOperation({kind:'create-family',fid,uid,source:source.view.scope},source.view.headIds);
const detached=()=>window.purrfectDetachedNotice?.('Создание семьи '+fid+' остановлено после смены сессии. Исходный снимок и ID сохранены в восстановительном журнале.');
createOperation=operation;busy=true;
try{
 await api.setDoc(api.doc(store,'families',fid),{owner:uid,members:[uid],createdAt:api.serverTimestamp()});
 if(!ownsSession(session)||createOperation!==operation){detached();return;}
 await api.setDoc(docState(fid),{data:source.data,revision:0,updatedAt:api.serverTimestamp(),updatedBy:uid});
 if(!ownsSession(session)||createOperation!==operation){detached();return;}
 watch(fid);message('Общий профиль создан из выбранного снимка.');
}finally{if(createOperation===operation){createOperation=null;busy=false}}
}}catch(err){if(ownsSession(actionSession))fail(err)}});
window.PurrfectCloud=Object.freeze({storageProtocol:STORAGE_PROTOCOL,renderPanel,statusText:state,localChanged});
begin();
