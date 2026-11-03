import fs from 'node:fs';
import vm from 'node:vm';
export const family=tag=>({pets:[{id:tag,name:tag}],active:tag,notes:[],weights:[],events:[],vaccines:[],foods:[],shopping:[],visits:[],foodReactions:[],noteTombstones:[],settings:{onboard:false}});
export const clone=v=>structuredClone(v);
let harnessSerial=0;
export function storage(seed=new Map()){
 const s={values:seed,failGet:null,failSet:null,failRemove:null,getItem(k){if(s.failGet?.(k))throw Error('synthetic getItem failure');return seed.get(k)??null},setItem(k,v){if(s.failSet?.(k,v))throw Error('synthetic QuotaExceeded');seed.set(k,String(v))},removeItem(k){if(s.failRemove?.(k))throw Error('synthetic removeItem failure');seed.delete(k)},get length(){return seed.size},key(i){return [...seed.keys()][i]??null}};return s;
}
export function harness({ls=storage(),server=new Map(),variant=process.env.TEST_VARIANT||'patched'}={}){
 const app=fs.readFileSync(new URL('../'+variant+'/app.js',import.meta.url),'utf8');
 const cloud=fs.readFileSync(new URL('../'+variant+'/cloud.js',import.meta.url),'utf8');
 const listeners=[],events=new Map(),requests=[],writes=[],notices=[],backups=[];let serial=0;const tabId=++harnessSerial;
 const snapshot=d=>({exists:()=>d!==undefined,data:()=>clone(d),metadata:{hasPendingWrites:false,fromCache:false}});
 const ctx=vm.createContext({structuredClone,Date,URL,Blob:class extends Blob{constructor(parts,options){super(parts,options);backups.push(parts.join(""))}},console,crypto:{randomUUID:()=>`tab-${tabId}-new-${++serial}`},location:{href:'https://example.invalid/',origin:'https://example.invalid',pathname:'/'},document:{documentElement:{dataset:{}},querySelector:()=>null,getElementById:()=>null,createElement:()=>({click(){}}),addEventListener:(n,f)=>{if(!events.has(n))events.set(n,[]);events.get(n).push(f)}},localStorage:ls,window:{},confirm:()=>true,setTimeout:()=>1,clearTimeout(){},closeModal(){},render(){},toast(){}});
 const storePath=new URL(variant==='patched'?'../local-store.js':'../'+variant+'/local-store.js',import.meta.url);
 if(fs.existsSync(storePath))vm.runInContext(fs.readFileSync(storePath,'utf8'),ctx);
 vm.runInContext(app.slice(0,app.indexOf('function id()')),ctx);
 const bridge=app.slice(app.indexOf('window.purrfectApplyCloud='),app.indexOf(";render();if('serviceWorker'"));vm.runInContext(bridge+';',ctx);
 const queue=(kind,execute)=>new Promise((resolve,reject)=>requests.push({kind,finish:async error=>{if(error){reject(error);return}try{resolve(await execute())}catch(e){reject(e)}}}));
 const api={doc:(_, ...p)=>p.join('/'),serverTimestamp:()=>0,onSnapshot:(path,cb,error)=>{const item={path,cb,error,active:true};listeners.push(item);return()=>{item.active=false}},getDoc:async path=>snapshot(server.get(path)),getDocFromServer:path=>queue('getServer:'+path,()=>snapshot(server.get(path))),setDoc:(path,data)=>queue('set:'+path,()=>{server.set(path,clone(data));writes.push({path,data:clone(data),kind:'set'})}),signOut:async()=>{},runTransaction:(_,cb)=>queue('transaction',async()=>{const staged=[];const result=await cb({get:async path=>snapshot(server.get(path)),update:(path,data)=>staged.push({path,data:clone(data),kind:'transaction'})});for(const w of staged){server.set(w.path,w.data);writes.push(w)}return result})};
 vm.runInContext(cloud.replace(/^import .*\n/m,'const firebaseConfig=null;\n').replace(/\nbegin\(\);\s*$/,'\n'),ctx);
 ctx.mockApi=api;ctx.notice=m=>notices.push(m);vm.runInContext('api=mockApi;store={};account={uid:"u"};renderPanel=()=>{};message=notice;',ctx);
 // Execute the ACTUAL onAuthStateChanged callback, without loading the remote SDK.
 const a=cloud.indexOf('authlib.onAuthStateChanged(auth,');const b=cloud.indexOf('renderPanel()})',a)+'renderPanel()}'.length;
 vm.runInContext('globalThis.authChange='+cloud.slice(a+'authlib.onAuthStateChanged(auth,'.length,b)+';',ctx);
 const run=s=>vm.runInContext(s,ctx);
 const inject=(name,value)=>{ctx[name]=clone(value)};
 const emit=(fid,index)=>{const list=listeners.filter(l=>l.path===`families/${fid}/shared/state`&&(index!==undefined||l.active));const l=index===undefined?list.at(-1):list[index];if(!l)throw Error('No listener '+fid);l.cb(snapshot(server.get(l.path)));};
 const attach=(fid,tag=fid,revision=7)=>{if(!server.has('families/'+fid))server.set('families/'+fid,{owner:'u',members:['u','v'],createdAt:0});if(!server.has(`families/${fid}/shared/state`))server.set(`families/${fid}/shared/state`,{data:family(tag),revision});run(`watch(${JSON.stringify(fid)})`);};
 return {ctx,ls,server,events,listeners,requests,writes,notices,backups,run,inject,emit,attach,
 click:async id=>{for(const f of events.get('click')||[])await f({target:{closest:()=>({id,dataset:{}})}})},
 auth:uid=>ctx.authChange(uid?{uid}:null),
 setData:d=>{inject('newData',d);run('db=structuredClone(newData);save();')},
 edit:id=>{inject('noteId',id);run('db.notes.push({id:noteId,petId:db.pets[0]?.id||"unknown",name:"synthetic"});save();')},
 state:()=>clone(run('({data:readLocal(),key:window.purrfectActiveLocalContext(),familyId,uid:account?.uid,enabled,dirty,conflicted,baseKnown,baseRevision,uploading,merging})')),
 pending:(uid,fid)=>ctx.window.purrfectReadLocalScope?ctx.window.purrfectReadLocalScope(uid,fid).pending:ls.getItem('purrfect_pending_v2_'+encodeURIComponent(uid)+':'+encodeURIComponent(fid))==='1',
 readFamily:(uid,fid)=>ctx.window.purrfectReadLocalScope?clone(ctx.window.purrfectReadLocalScope(uid,fid).data):JSON.parse(ls.getItem('purrfect_data_v2_'+encodeURIComponent(uid)+':'+encodeURIComponent(fid))),
 isJournal:variant==='patched',
 reload:()=>harness({ls,server,variant}),snapshot};
}
