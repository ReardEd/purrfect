import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { makeMigrationPlan } from './record-migration.js';

const $=id=>document.getElementById(id);
const status=(message,failed=false)=>{const e=$('status');e.textContent=message;e.className=failed?'error':'success'};
const actionButtons=['login','prepare','write','verify'];
let auth=null, db=null, signedIn=null, plan=null, fid=null, expected=null;
const allowedProject='purrfect-lab';
function buttons(){ $('prepare').disabled=!signedIn; $('write').disabled=!signedIn||!plan?.canMigrate; $('verify').disabled=!signedIn||!plan?.canMigrate; }
const errorMessage=e=>e?.code?e.code+': '+(e.message||''):String(e);
$('login').addEventListener('click',async()=>{
 $('login').disabled=true;
 try {
   const apiKey=$('apiKey').value.trim(),appId=$('appId').value.trim();
   const email=$('email').value.trim(),password=$('password').value;
   if(!apiKey||!appId||!email||!password)throw Error('Заполните API key, App ID, email и пароль.');
   if(!appId.startsWith('1:')||!appId.includes(':web:'))throw Error('Проверьте Web App ID.');
   const app=initializeApp({apiKey,appId,authDomain:allowedProject+'.firebaseapp.com',projectId:allowedProject},'purrfect-lab-isolated');
   auth=getAuth(app);db=getFirestore(app);
   const result=await signInWithEmailAndPassword(auth,email,password);
   signedIn=result.user;fid='mirror-'+signedIn.uid;
   $('password').value='';
   $('email').value='';
   $('loginPanel').hidden=true;$('actions').hidden=false;
   $('who').textContent='Тестовый пользователь вошёл; ID скрыт. Семья: mirror-<UID>';
   status('Авторизация прошла. Прежде чем записывать, подготовьте план искусственных данных.');
 }catch(e){status('Ошибка входа: '+errorMessage(e),true)}
 finally{$('login').disabled=false;buttons()}
});
$('prepare').addEventListener('click',async()=>{
 try{
   const data=await (await fetch('./synthetic-family.json',{cache:'no-store'})).json();
   plan=makeMigrationPlan(data.state,data.revision);
   if(!plan.canMigrate)throw Error(plan.errors.join('; '));
   expected=data;
   $('preview').textContent=JSON.stringify({family:'mirror-<UID>',source:'synthetic-family.json',documents:plan.totalDocuments,counts:plan.counts,paths:plan.records.map(x=>x.relativePath)},null,2);
   status('План готов: '+plan.totalDocuments+' искусственных документов. Никакие данные пока не записаны.');
 }catch(e){plan=null;status(errorMessage(e),true)}buttons();
});
$('write').addEventListener('click',async()=>{
 if(!signedIn||!plan?.canMigrate||!fid)return;
 if(!confirm('Создать ТОЛЬКО искусственные документы в purrfect-lab? Операция не затронет Purrfect. Существующие документы не перезаписываются.'))return;
 $('write').disabled=true;
 try{
   const familyRef=doc(db,'families',fid);
   const family=await getDoc(familyRef);
   if(!family.exists()){
     await setDoc(familyRef,{owner:signedIn.uid,members:[signedIn.uid],createdAt:serverTimestamp()});
   }else if(family.data().owner!==signedIn.uid){
     throw Error('Семья уже существует, но текущий пользователь не владелец.');
   }
   let created=0,identical=0;
   for(const record of plan.records){
     const ref=doc(db,'families',fid,...record.relativePath.split('/'));
     const existing=await getDoc(ref);
     if(existing.exists()){
       if(stable(existing.data())!==stable(record.payload))throw Error('Документ '+record.relativePath+' уже существует с ДРУГИМ содержимым. Остановлено.');
       identical++;continue;
     }
     await setDoc(ref,record.payload);
     created++;
   }
   status('Зеркальные записи созданы: '+created+'. Уже совпали: '+identical+'. Теперь нажмите «Проверить».');
 }catch(e){status('Запись остановлена: '+errorMessage(e)+'. Возможна частичная запись; повторный запуск не перезаписывает документы.',true)}
 finally{buttons()}
});
function stable(v){if(Array.isArray(v))return JSON.stringify(v.map(x=>JSON.parse(stable(x))));if(v&&typeof v==='object')return JSON.stringify(Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(stable(v[k]))])));return JSON.stringify(v)}
$('verify').addEventListener('click',async()=>{
 if(!signedIn||!plan)return;
 $('verify').disabled=true;
 try{
   const missing=[],changed=[];
   for(const record of plan.records){
     const ref=doc(db,'families',fid,...record.relativePath.split('/'));
     const snap=await getDoc(ref);
     if(!snap.exists())missing.push(record.relativePath);
     else if(stable(snap.data())!==stable(record.payload))changed.push(record.relativePath);
   }
   const report={project:allowedProject,expected:plan.totalDocuments,missing,changed,allRecordsMatch:!missing.length&&!changed.length};
   $('verifyResult').textContent=JSON.stringify(report,null,2);
   status(report.allRecordsMatch?'Победа! Все '+plan.totalDocuments+' документов совпадают в тестовом Firestore.':'Проверка нашла отличия — см. отчёт.',!report.allRecordsMatch);
 }catch(e){status('Ошибка проверки: '+errorMessage(e),true)}finally{buttons()}
});
$('logout').addEventListener('click',async()=>{if(auth)await signOut(auth);signedIn=null;plan=null;fid=null;db=null;$('actions').hidden=true;$('loginPanel').hidden=false;status('Выход выполнен');buttons()});
buttons();