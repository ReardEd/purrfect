/* Purrfect family sync v1.4.1 (optimistic transactions): opt-in Firebase; requires configured project + Firestore rules. */
import { firebaseConfig } from './firebase-config.js';
let auth=null, store=null, api=null, account=null, familyId='', unsub=null, started=false, enabled=false, busy=false, timer=null, lastError='';
let sdk=null;
let dirty=false,conflicted=false,uploading=false,editSequence=0,baseRevision=null,baseKnown=false;
let sessionGeneration=0,mergeOperation=null;
const pendingKey=fid=>'purrfect_pending_'+fid;
const revisionKey=fid=>'purrfect_revision_'+fid;
function pendingSet(value){if(!familyId)return;try{value?localStorage.setItem(pendingKey(familyId),'1'):localStorage.removeItem(pendingKey(familyId))}catch(e){message('Недостаточно места для отметки несохранённых изменений.',true)}}
function setBase(rev){baseRevision=rev??null;baseKnown=true;if(familyId){try{localStorage.setItem(revisionKey(familyId),JSON.stringify(baseRevision))}catch{}}}
function conflictMessage(){message('⚠️ Конфликт: семейные данные изменились на другом устройстве. Ваши локальные изменения сохранены. Скачайте резервную копию и выберите облачную версию либо разберите изменения вручную.',true)}
function saveLocalBackup(){
const data=readLocal();if(!data)return;
const blob=new Blob([JSON.stringify({...data,format:'purrfect-backup',version:1},null,2)],{type:'application/json'});
const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='purrfect-local-conflict-'+new Date().toISOString().slice(0,10)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
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
const fid=familyId,local=readLocal();
const snap=await api.getDocFromServer(docState(fid));
if(fid!==familyId||!conflicted)return;
if(!snap.exists()||!snap.data()?.data)throw Error('Нет облачной версии.');
const record=snap.data(),plan=planNoteMerge(local,record.data);
mergePreview={fid,revision:record.revision??null,plan,localSnapshot:JSON.stringify(local)};
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
const preview=mergePreview,fid=familyId,uid=account.uid,accountAtStart=account,sequenceAtStart=editSequence,generationAtStart=sessionGeneration;
const ownsSession=()=>sessionGeneration===generationAtStart&&fid===familyId&&account===accountAtStart&&enabled;
const operation=Symbol('note-merge');
if(preview.fid!==fid||preview.plan.changed.length||preview.plan.invalid.length||!preview.plan.additions.length)throw Error('Проверка слияния не пройдена.');
if(JSON.stringify(readLocal())!==preview.localSnapshot){mergePreview=null;throw Error('Локальные данные изменились. Повторите предварительный просмотр.')}
if(!confirm('Добавить ТОЛЬКО '+preview.plan.additions.length+' новых заметок? Удалённые записи НЕ восстанавливаются. Все прочие локальные изменения, кроме этих заметок, НЕ переносятся. Обе резервные копии должны быть сохранены.'))return;
if(!ownsSession()||merging||mergeOperation)return;
mergeOperation=operation;merging=true;
try{
const committed=await api.runTransaction(store,async tx=>{
const ref=docState(fid),snap=await tx.get(ref);if(!snap.exists()||!snap.data()?.data)throw Error('База недоступна');
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
if(!ownsSession()||mergeOperation!==operation)return;
if(sequenceAtStart!==editSequence||JSON.stringify(readLocal())!==preview.localSnapshot){
 mergePreview=null;dirty=true;conflicted=true;pendingSet(true);
 message('Слияние добавило заметки в облако, но локальные данные изменились во время ожидания. Новые правки сохранены локально; облачная отправка заблокирована до повторной проверки конфликта. Скачайте резервную копию.',true);
 renderPanel();return;
}
clearTimeout(timer);editSequence++;dirty=false;conflicted=false;mergePreview=null;setBase(committed.revision);pendingSet(false);
window.purrfectApplyCloud?.(committed.data);message('Добавлены '+preview.plan.additions.length+' заметок. Проверьте обе учётные записи ☁️');renderPanel();
}catch(err){
if(ownsSession()&&mergeOperation===operation){
 mergePreview=null;conflicted=true;
 message('Слияние не выполнено: '+(err?.message||String(err))+' Локальные данные сохранены.',true);renderPanel();
}
}finally{
if(mergeOperation===operation){mergeOperation=null;merging=false}
}
}
async function takeCloudVersion(){
if(!familyId||!account)return;
if(!confirm('Заменить локальные записи текущей облачной версией? Сначала обязательно скачайте локальную резервную копию.'))return;
const snap=await api.getDocFromServer(docState(familyId));if(!snap.exists()||!snap.data()?.data)throw Error('Облачные данные недоступны');
const record=snap.data();dirty=false;conflicted=false;editSequence++;clearTimeout(timer);setBase(record.revision??null);pendingSet(false);
window.purrfectApplyCloud?.(record.data);message('Загружена актуальная облачная версия ☁️');renderPanel();
}
const familyKey=(uid)=>'purrfect_family_'+uid;
const inviteId=(()=>{try{return new URL(location.href).searchParams.get('invite')||''}catch{return ''}})();
const inviteUrl=fid=>`${location.origin}${location.pathname}?invite=${encodeURIComponent(fid)}`;
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function state(){return !firebaseConfig?'Облачный доступ требует настройки Firebase. Локальные данные сохранены.':!account?'Облако готово к входу. Локальные данные сохранены.':familyId&&enabled?'Общие данные подключены ☁️':`Вход: ${account.email}. Семья пока не подключена.`}
function message(msg,bad=false){lastError=msg;const e=$('familyMessage');if(e){e.className='familyState'+(bad?' familyError':'');e.textContent=msg}}
function fail(err){const code=err?.code||'';const friendly={ 'auth/invalid-email':'Проверьте адрес электронной почты.', 'auth/invalid-credential':'Неверная почта или пароль.', 'auth/email-already-in-use':'Этот адрес уже зарегистрирован.', 'auth/weak-password':'Выберите более надёжный пароль.', 'auth/too-many-requests':'Слишком много попыток. Повторите позже.', 'permission-denied':'Нет прав доступа к этой семье.'};message(friendly[code]||'Ошибка: '+(code||err?.message||String(err)),true)}
function stop(){sessionGeneration++;mergeOperation=null;mergePreview=null;merging=false;if(unsub)unsub();unsub=null;enabled=false;familyId='';clearTimeout(timer);dirty=false;conflicted=false;uploading=false;baseKnown=false;baseRevision=null;editSequence++}
function docState(fid){return api.doc(store,'families',fid,'shared','state')}
function readLocal(){return window.purrfectLocalData?.()}
async function upload(){
if(!enabled||!familyId||!account||uploading||merging||conflicted||!dirty)return;
if(!baseKnown){message('Ждём исходную версию семейных данных перед записью.',true);return}
const fid=familyId,uid=account.uid,sequence=editSequence,data=readLocal();
if(!data)return;
if(JSON.stringify(data).length>720000){message('Данные слишком велики для одного облачного документа. Скачайте резервную копию; синхронизация остановлена.',true);return}
uploading=true;
try{
const nextRevision=await api.runTransaction(store,async tx=>{
const snap=await tx.get(docState(fid));
if(!snap.exists())throw Error('Семейная база недоступна');
const current=snap.data(),actualRevision=current?.revision??null;
if(actualRevision!==baseRevision){const err=new Error('Конфликт ревизий');err.purrfectConflict=true;throw err}
const revision=(actualRevision??0)+1;
tx.update(docState(fid),{data,revision,updatedAt:api.serverTimestamp(),updatedBy:uid});
return revision;
});
if(fid!==familyId)return;
setBase(nextRevision);
if(sequence===editSequence){dirty=false;pendingSet(false);message('Изменения сохранены в облаке ☁️')}
else{dirty=true;pendingSet(true);message('Сохраняем новые изменения…')}
}catch(err){
if(fid!==familyId)return;
if(err.purrfectConflict){conflicted=true;conflictMessage();renderPanel()}
else fail(err);
}finally{
uploading=false;
if(fid===familyId&&dirty&&!conflicted&&sequence!==editSequence){clearTimeout(timer);timer=setTimeout(upload,400)}
}
}
function localChanged(){
if(!enabled||!familyId)return;
dirty=true;editSequence++;pendingSet(true);
if(conflicted){conflictMessage();return}
clearTimeout(timer);timer=setTimeout(upload,850);
}
function watch(fid){
stop();familyId=fid;enabled=true;localStorage.setItem(familyKey(account.uid),fid);
dirty=localStorage.getItem(pendingKey(fid))==='1';
try{const saved=localStorage.getItem(revisionKey(fid));baseRevision=saved===null?null:JSON.parse(saved);baseKnown=saved!==null}catch{baseRevision=null;baseKnown=false}
unsub=api.onSnapshot(docState(fid),snap=>{
if(!snap.exists()){message('Общая база ещё не содержит данных. Попросите владельца создать семейный профиль.');return}
if(snap.metadata.hasPendingWrites||merging)return;
if(snap.metadata.fromCache){message('Нет свежего подтверждения от сервера. Локальные записи сохранены; облачную версию проверим при подключении.',true);return}
const record=snap.data();
if(!record?.data)return;
const remoteRevision=record.revision??null;
if(dirty){
if(!baseKnown){conflicted=true;conflictMessage();renderPanel();return}
if(remoteRevision!==baseRevision&&!uploading){conflicted=true;conflictMessage();renderPanel();return}
if(!uploading&&!conflicted){clearTimeout(timer);timer=setTimeout(upload,850)}
}else{
setBase(remoteRevision);
const local=readLocal();if(JSON.stringify(local)!==JSON.stringify(record.data))window.purrfectApplyCloud?.(record.data);
}
renderPanel();
},e=>{stop();fail(e);renderPanel()});
renderPanel();
}
async function begin(){if(started||!firebaseConfig?.apiKey||!firebaseConfig?.projectId)return;started=true;try{const [app,authlib,fire]=await Promise.all([import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js'),import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js')]);const fb=app.initializeApp(firebaseConfig);auth=authlib.getAuth(fb);store=fire.getFirestore(fb);api={...authlib,...fire};authlib.onAuthStateChanged(auth,u=>{account=u;stop();if(u){const fid=localStorage.getItem(familyKey(u.uid));if(fid)watch(fid)}renderPanel()})}catch(e){started=false;fail(e);renderPanel()}}
function renderPanel(){const panel=$('family-panel');if(!panel)return;
if(!firebaseConfig){panel.innerHTML=`<div class="familyBox"><b>☁️ Настройка Firebase ещё не выполнена</b><p class="familyHint">Для реальной регистрации и обмена записями нужно создать бесплатный проект Firebase и вписать параметры в <code>firebase-config.js</code>. Инструкция лежит в SETUP-FIREBASE.md в архиве.</p><p class="familyHint">До подключения всё работает локально, как раньше.</p></div>`;return}
if(!started){panel.innerHTML='<div class="familyState">Подключаем облако…</div>';begin();return}
if(!account){panel.innerHTML=`<div class="familyBox"><b>❤️ Войти в Purrfect</b><p class="familyHint">Каждому участнику семейного пространства нужен отдельный аккаунт. Пароль минимум 6 символов, лучше длиннее.</p><form id="familyAuth"><label>E-mail</label><input name="email" type="email" required autocomplete="username"><label>Пароль</label><input name="password" type="password" minlength="6" required autocomplete="current-password"><div class="familyButtons"><button class="action" name="mode" value="login">Войти</button><button class="action ghost" name="mode" value="signup">Зарегистрироваться</button></div></form><button class="action ghost" id="familyResetPassword" type="button">Забыли пароль?</button><p class="familyHint">Для восстановления используйте постоянную почту, к которой есть доступ.</p></div><div id="familyMessage" class="familyState">${esc(lastError||'')}</div>`;return}
const header=`<div class="familyBox"><b>👤 ${esc(account.email)}</b><p class="familyHint">ID аккаунта (можно отправить владельцу семейного профиля):</p><code>${esc(account.uid)}</code><div class="familyButtons"><button class="action ghost" id="copyUid">📋 Скопировать мой ID</button><button class="action ghost" id="familyLogout">Выйти из аккаунта</button></div><p class="familyHint">Почта: ${account.emailVerified?'✅ подтверждена':'✉️ пока не подтверждена'}</p>${account.emailVerified?'':'<div class="familyButtons"><button class="action ghost" id="familyVerifyEmail">Отправить письмо подтверждения</button><button class="action ghost" id="familyCheckEmail">Проверить подтверждение</button></div>'}</div>`;
if(!familyId){panel.innerHTML=header+`<div class="familyBox"><b>🐾 Создать семью</b><p class="familyHint">Используйте это на основном устройстве, где уже есть записи питомца. Данные будут загружены в новый семейный профиль.</p><button class="action" id="familyCreate">Создать общий профиль и загрузить мои данные</button></div><div class="familyBox"><b>❤️ Подключиться к семье</b><p class="familyHint">Попросите владельца сначала добавить ваш ID аккаунта, затем введите семейный ID.</p><form id="familyJoin"><label>Семейный ID</label><input name="fid" required placeholder="ID семейного профиля" value="${esc(inviteId)}"><button class="action ghost">Подключить общий профиль</button></form></div><div id="familyMessage" class="familyState">${esc(lastError||'')}</div>`;return}
panel.innerHTML=header+`<div class="familyBox"><b>☁️ Общее пространство подключено</b><p class="familyHint">ID семьи:</p><code>${esc(familyId)}</code><button class="action ghost" id="copyFamily">📋 Скопировать ID семьи</button><button class="action ghost" id="copyFamilyInvite">🔗 Скопировать ссылку-приглашение</button><p class="familyHint">Ссылка только подставляет ID семьи. Владелец всё равно должен разрешить доступ по ID аккаунта участника.</p><p class="familyHint">Синхронизация использует проверку ревизии. При одновременных изменениях автоматическая запись останавливается, а локальные данные сохраняются для ручного разрешения конфликта.</p>${conflicted?`<div class="familyBox"><b>⚠️ Обнаружен конфликт изменений</b><p class="familyHint">Локальная версия не отправляется автоматически. Сначала сохраните её, затем при необходимости загрузите облачную.</p><button class="action" id="familyBackupConflict" type="button">📥 Скачать локальную резервную копию</button><button class="action ghost" id="familyUseCloud" type="button">☁️ Загрузить облачную версию</button><button class="action ghost" id="familyPreviewNoteMerge" type="button">🔀 Посмотреть слияние заметок (бета)</button><div id="familyMergePreview"></div></div>`:dirty?`<p class="familyHint">⏳ Есть ещё не отправленные изменения.</p>`:'' }<div id="ownerTools"></div><button class="action ghost" id="disconnectFamily">Отключить семью на этом устройстве</button></div><div id="familyMessage" class="familyState">${esc(lastError||'')}</div>`;
api.getDoc(api.doc(store,'families',familyId)).then(s=>{if(!s.exists())return;const f=s.data(),el=$('ownerTools');if(!el)return;
const isOwner=f.owner===account.uid;
const rows=(f.members||[]).map(uid=>`<div class="familyMember"><span><b>${uid===f.owner?'👑 Владелец':uid===account.uid?'👤 Вы':'👤 Участник'}</b><br><small>${esc(uid)}</small></span>${isOwner&&uid!==account.uid?`<button class="action ghost" data-family-remove="${esc(uid)}" type="button">Убрать</button>`:''}</div>`).join('');
el.innerHTML=`<div class="separator"></div><b>👥 Участники семьи (${f.members?.length||0}/5)</b>${rows}`+
(isOwner?`<div class="separator"></div><b>Добавить участника</b><p class="familyHint">Попросите участника создать аккаунт и передать свой ID.</p><form id="familyInvite"><label>ID участника</label><input name="uid" required placeholder="ID аккаунта участника"><button class="action">Разрешить доступ</button></form><div class="separator"></div><b>👑 Передача владельца</b><p class="familyHint">Выберите участника, которому предложить роль. Он должен подтвердить её в своём аккаунте.</p>${f.pendingOwner?`<p class="familyHint">Предложение отправлено: ${esc(f.pendingOwner)}</p><button class="action ghost" id="familyCancelTransfer" type="button">Отменить предложение</button>`:`<form id="familyOfferTransfer"><label>Новый владелец</label><select name="uid" required><option value="">Выберите участника</option>${f.members.filter(uid=>uid!==account.uid).map(uid=>`<option value="${esc(uid)}">${esc(uid)}</option>`).join('')}</select><button class="action ghost">Предложить роль владельца</button></form>`}`:f.pendingOwner===account.uid?`<div class="separator"></div><b>👑 Вам предлагают стать владельцем семьи</b><p class="familyHint">После подтверждения вы сможете управлять участниками, прежний владелец останется участником.</p><button class="action" id="familyAcceptTransfer" type="button">Принять роль владельца</button>`:f.pendingOwner?`<p class="familyHint">Ожидается подтверждение передачи роли другим участником.</p>`:'');
}).catch(fail)}
function formData(el){return Object.fromEntries(new FormData(el).entries())}
document.addEventListener('submit',async e=>{if(!['familyAuth','familyJoin','familyInvite','familyOfferTransfer'].includes(e.target.id))return;e.preventDefault();const form=e.target,values=formData(form);try{if(form.id==='familyAuth'){const mode=e.submitter?.value||'login';if(mode==='signup')await api.createUserWithEmailAndPassword(auth,values.email.trim(),values.password);else await api.signInWithEmailAndPassword(auth,values.email.trim(),values.password);message('Успешный вход ☁️');return}if(!account)throw Error('Сначала войдите в аккаунт');if(form.id==='familyJoin'){const fid=values.fid.trim();const m=await api.getDoc(api.doc(store,'families',fid));if(!m.exists())throw Error('Семья не найдена или нет доступа. Владелец должен добавить ваш ID.');if(!m.data().members.includes(account.uid))throw Error('Владелец пока не добавил этот аккаунт');watch(fid);return}if(form.id==='familyOfferTransfer'){if(!familyId)throw Error('Семья не выбрана');if(!confirm('Предложить передачу роли владельца выбранному участнику?'))return;const ref=api.doc(store,'families',familyId);const snap=await api.getDoc(ref);if(snap.data()?.owner!==account.uid)throw Error('Передавать роль может только текущий владелец');if(!snap.data().members.includes(values.uid)||values.uid===account.uid)throw Error('Выберите другого участника');await api.updateDoc(ref,{pendingOwner:values.uid});message('Предложение отправлено. Попросите участника открыть семейный доступ.');renderPanel();return}if(form.id==='familyInvite'){if(!familyId)throw Error('Семья не выбрана');const uid=values.uid.trim();if(!/^[\w-]{12,128}$/.test(uid))throw Error('Неверный ID участника');await api.updateDoc(api.doc(store,'families',familyId),{members:api.arrayUnion(uid)});message('Участник добавлен. Передайте ему ID семьи для подключения.');renderPanel()}}catch(err){fail(err)}});
document.addEventListener('click',async e=>{const t=e.target.closest('button');if(!t)return;try{if(t.id==='familyPreviewNoteMerge'){await prepareNoteMerge();return}if(t.id==='familyCommitNoteMerge'){await commitNoteMerge();return}if(t.id==='familyCancelNoteMerge'){mergePreview=null;renderPanel();return}if(t.id==='familyBackupConflict'){saveLocalBackup();message('Локальная резервная копия подготовлена.');return}if(t.id==='familyUseCloud'){await takeCloudVersion();return}if(t.dataset.familyRemove){if(!account||!familyId)return;const uid=t.dataset.familyRemove;if(!confirm('Отозвать доступ участника? Он больше не сможет читать и изменять семейные данные.'))return;const ref=api.doc(store,'families',familyId);const snap=await api.getDoc(ref);if(snap.data()?.owner!==account.uid||uid===account.uid)throw Error('Нельзя удалить владельца');if(snap.data()?.pendingOwner===uid)throw Error('Сначала отмените предложение передачи роли');await api.updateDoc(ref,{members:api.arrayRemove(uid)});message('Доступ участника отозван.');renderPanel();return}if(t.id==='familyCancelTransfer'){const ref=api.doc(store,'families',familyId);await api.updateDoc(ref,{pendingOwner:api.deleteField()});message('Предложение передачи роли отменено.');renderPanel();return}if(t.id==='familyAcceptTransfer'){if(!confirm('Принять роль владельца семьи?'))return;const ref=api.doc(store,'families',familyId);const snap=await api.getDoc(ref);if(snap.data()?.pendingOwner!==account.uid)throw Error('Предложение больше не активно');await api.updateDoc(ref,{owner:account.uid,pendingOwner:api.deleteField()});message('Теперь вы владелец семейного пространства 👑');renderPanel();return}if(t.id==='familyResetPassword'){const email=prompt('Укажите адрес электронной почты для восстановления пароля:');if(email===null)return;if(!email.trim())throw Error('Введите адрес электронной почты');await api.sendPasswordResetEmail(auth,email.trim());message('Если адрес зарегистрирован, на него придёт письмо для сброса пароля.');return}if(t.id==='familyVerifyEmail'){if(!account)return;await api.sendEmailVerification(account);message('Письмо подтверждения отправлено. Проверьте почту.');return}if(t.id==='familyCheckEmail'){if(!account)return;await account.reload();account=auth.currentUser;renderPanel();message(account.emailVerified?'Адрес электронной почты подтверждён ✅':'Почта ещё не подтверждена. Проверьте входящие и спам.');return}if(t.id==='familyLogout'){stop();await api.signOut(auth);return}if(t.id==='copyUid'){await navigator.clipboard.writeText(account.uid);message('ID аккаунта скопирован');return}if(t.id==='copyFamilyInvite'){await navigator.clipboard.writeText(inviteUrl(familyId));message('Ссылка-приглашение скопирована. Для входа владельцу нужно добавить ID аккаунта участника.');return}if(t.id==='copyFamily'){await navigator.clipboard.writeText(familyId);message('ID семьи скопирован');return}if(t.id==='disconnectFamily'){if(!confirm('Отключить синхронизацию на этом устройстве? Локальные данные останутся.'))return;stop();localStorage.removeItem(familyKey(account.uid));renderPanel();return}if(t.id==='familyCreate'){if(!confirm('Создать новый семейный профиль и загрузить текущие локальные записи? Сначала рекомендуется скачать резервную копию.'))return;const fid=crypto.randomUUID();busy=true;await api.setDoc(api.doc(store,'families',fid),{owner:account.uid,members:[account.uid],createdAt:api.serverTimestamp()});await api.setDoc(docState(fid),{data:readLocal(),revision:0,updatedAt:api.serverTimestamp(),updatedBy:account.uid});busy=false;watch(fid);message('Общий профиль создан! Добавьте других участников по их ID.')}}catch(err){busy=false;fail(err)}});
window.PurrfectCloud={renderPanel,statusText:state,localChanged};
begin();
