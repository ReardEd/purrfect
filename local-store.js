/* Purrfect Iron Storage: immutable local journal. No cloud/network access. */
(function (root) {
'use strict';
const PREFIX='purrfect_iron_v1:';
const copy=value=>JSON.parse(JSON.stringify(value));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sorted=items=>[...items].sort();
function error(code,message,details){const e=new Error(message);e.code=code;if(details)e.details=details;return e}
function jsonSafe(value,seen=new Set()){
 if(value===null||typeof value==='string'||typeof value==='boolean')return;
 if(typeof value==='number'){if(!Number.isFinite(value))throw error('IRON_INVALID','Non-finite JSON value');return}
 if(!value||typeof value!=='object'||seen.has(value))throw error('IRON_INVALID','Unsupported or cyclic JSON value');
 if(!Array.isArray(value)&&Object.prototype.toString.call(value)!=='[object Object]')throw error('IRON_INVALID','Only JSON objects are supported');
 if(Object.getOwnPropertySymbols(value).length)throw error('IRON_INVALID','Symbol properties cannot be preserved in JSON');
 if(Array.isArray(value)){for(let i=0;i<value.length;i++)if(!Object.prototype.hasOwnProperty.call(value,i))throw error('IRON_INVALID','Sparse arrays cannot be preserved');if(Object.keys(value).some(k=>!/^\d+$/.test(k)||Number(k)>=value.length||String(Number(k))!==k))throw error('IRON_INVALID','Custom array properties cannot be preserved');}
 seen.add(value);for(const k of Object.keys(value))jsonSafe(value[k],seen);seen.delete(value);
}
function create(options){
 const storage=options?.storage||root.localStorage;
 const projectId=String(options?.projectId||'');
 if(!projectId||projectId.length>200)throw error('IRON_SCOPE','A project ID is required');
 const initial=copy(options.initial);
 const random=options.idGenerator||(()=>{const c=root.crypto||globalThis.crypto;if(!c?.randomUUID)throw error('IRON_RANDOM','crypto.randomUUID is required');return c.randomUUID()});
 const writerId=String(options.writerId||random());
 const makeScope=(uid,fid)=>({projectId,uid:uid&&fid?String(uid):null,fid:uid&&fid?String(fid):null});
 function validateScope(scope){if(!scope||scope.projectId!==projectId||!((scope.uid===null&&scope.fid===null)||(typeof scope.uid==='string'&&scope.uid&&typeof scope.fid==='string'&&scope.fid)))throw error('IRON_SCOPE','Invalid storage scope');return makeScope(scope.uid,scope.fid)}
 const scopePrefix=scope=>PREFIX+encodeURIComponent(JSON.stringify([scope.projectId,scope.uid,scope.fid]))+':';
 function get(key){return storage.getItem(key)}
 function keys(prefix){const found=[];for(let i=0;i<storage.length;i++){const key=storage.key(i);if(typeof key==='string'&&key.startsWith(prefix))found.push(key)}return sorted(found)}
 function parse(raw,label){let value;try{value=JSON.parse(raw)}catch{throw error('IRON_CORRUPT','Cannot parse '+label)}jsonSafe(value);return value}
 function validateData(value){jsonSafe(value);if(!value||typeof value!=='object'||Array.isArray(value)||!Array.isArray(value.pets))throw error('IRON_CORRUPT','Dataset must contain pets array');for(const k of Object.keys(initial)){if(Array.isArray(initial[k])&&value[k]!==undefined&&!Array.isArray(value[k]))throw error('IRON_CORRUPT','Invalid collection '+k)}return copy(value)}
 function collect(scope){
  const prefix=scopePrefix(scope),names=keys(prefix),records=[];
  for(const key of names){const raw=get(key);if(raw===null)throw error('IRON_CONCURRENT','Journal changed while reading');const r=parse(raw,key);const id=key.slice(prefix.length);
   if(!/^[A-Za-z0-9_-]{1,160}$/.test(id)||r.version!==1||r.id!==id||!same(r.scope,scope)||!Array.isArray(r.parents)||new Set(r.parents).size!==r.parents.length||r.parents.some(p=>typeof p!=='string'||p===id)||typeof r.pending!=='boolean'||typeof r.conflicted!=='boolean'||typeof r.legacyPending!=='boolean'||typeof r.baseKnown!=='boolean'||!(r.baseRevision===null||Number.isSafeInteger(r.baseRevision)&&r.baseRevision>=0)||!Number.isSafeInteger(r.sessionGeneration)||r.sessionGeneration<0||!Number.isFinite(r.createdAt)||typeof r.reason!=='string'||typeof r.writer!=='string')throw error('IRON_CORRUPT','Invalid journal record '+key);
   validateData(r.data);records.push(r);
  }
  if(!same(names,keys(prefix)))throw error('IRON_CONCURRENT','Journal changed while reading');
  const byId=new Map(records.map(r=>[r.id,r]));
  for(const r of records)for(const p of r.parents)if(!byId.has(p))throw error('IRON_CORRUPT','Missing or foreign parent '+p);
  const checked=new Set(),checking=new Set();function visit(id){if(checking.has(id))throw error('IRON_CORRUPT','Cyclic journal');if(checked.has(id))return;checking.add(id);for(const p of byId.get(id).parents)visit(p);checking.delete(id);checked.add(id)}for(const r of records)visit(r.id);
  const consumed=new Set(records.flatMap(r=>r.parents));return {records,heads:records.filter(r=>!consumed.has(r.id)),names};
 }
 function legacy(scope){
  const guest=scope.uid===null;
  const rawKey=guest?'purrfect_data_v2_guest':'purrfect_data_v2_'+encodeURIComponent(scope.uid)+':'+encodeURIComponent(scope.fid);
  let raw=get(rawKey),source=raw===null?'empty':'v2';
  if(guest&&raw===null){raw=get('purrfect_v01');if(raw!==null)source='legacy-guest'}
  const data=raw===null?copy(initial):validateData(parse(raw,rawKey));
  let pending=false,legacyPending=false,baseRevision=null,baseKnown=false;
  if(!guest){const suffix=encodeURIComponent(scope.uid)+':'+encodeURIComponent(scope.fid);const pendingRaw=get('purrfect_pending_v2_'+suffix),legacyPendingRaw=get('purrfect_pending_'+scope.fid);
   if((pendingRaw!==null&&pendingRaw!=='1')||(legacyPendingRaw!==null&&legacyPendingRaw!=='1'))throw error('IRON_CORRUPT','Invalid legacy pending marker');
   pending=pendingRaw==='1';const rev=get('purrfect_revision_v2_'+suffix);if(rev!==null){baseRevision=parse(rev,'base revision');if(!(baseRevision===null||Number.isSafeInteger(baseRevision)&&baseRevision>=0))throw error('IRON_CORRUPT','Invalid base revision');baseKnown=true}
   // A v2 payload may merely be an empty scaffold. Only an explicit journal resolution dismisses old ambiguity.
   legacyPending=legacyPendingRaw==='1';if(legacyPending){pending=true;source=raw===null?'legacy-ambiguous':'v2-with-legacy-ambiguity'}
  }
  return {scope:copy(scope),data,pending,baseRevision,baseKnown,headIds:[],conflicted:legacyPending,legacyPending,hasRecords:false,candidates:[],source};
 }
 function read(input){const scope=validateScope(input),state=collect(scope);if(!state.heads.length)return legacy(scope);
  const heads=state.heads.sort((a,b)=>Number(b.pending)-Number(a.pending)||b.createdAt-a.createdAt||a.id.localeCompare(b.id));const selected=heads[0],fork=heads.length>1;
  return {scope:copy(scope),data:copy(selected.data),pending:fork||heads.some(h=>h.pending),baseRevision:selected.baseRevision,baseKnown:!fork&&selected.baseKnown,headIds:sorted(heads.map(h=>h.id)),conflicted:fork||heads.some(h=>h.conflicted),legacyPending:heads.some(h=>h.legacyPending),hasRecords:true,candidates:copy(heads),source:'journal'};
 }
 function append(input,data,meta={}){
  const scope=validateScope(input);validateData(data);
  for(const field of ['pending','baseKnown','conflicted','legacyPending'])if(meta[field]!==undefined&&typeof meta[field]!=='boolean')throw error('IRON_INVALID','Invalid boolean metadata '+field);
  if(meta.parents!==undefined&&(!Array.isArray(meta.parents)||meta.parents.some(p=>typeof p!=='string')))throw error('IRON_INVALID','Invalid parent IDs');
  const current=read(scope),parents=sorted(meta.parents||[]);
  if(new Set(parents).size!==parents.length||!same(parents,current.headIds))throw error('IRON_CONFLICT','Local journal changed; preserve working copy and review before saving',{current});
  const reason=String(meta.reason||'local');
  if(current.conflicted&&meta.conflicted===false&&reason!=='resolve')throw error('IRON_CONFLICT','Only explicit resolution may clear local conflict',{current});
  if(reason==='remote'&&(current.pending||current.conflicted||current.legacyPending))throw error('IRON_CONFLICT','Remote snapshot cannot replace pending local data',{current});
  if(meta.pending===false&&current.conflicted&&reason!=='resolve')throw error('IRON_CONFLICT','Explicit resolution required for local conflict',{current});
  const id=String(random());if(!/^[A-Za-z0-9_-]{1,160}$/.test(id))throw error('IRON_RANDOM','Invalid journal ID');
  const key=scopePrefix(scope)+id;if(get(key)!==null)throw error('IRON_COLLISION','Refusing to overwrite immutable journal entry');
  const baseRevision=meta.baseRevision===undefined?current.baseRevision:meta.baseRevision;
  if(!(baseRevision===null||Number.isSafeInteger(baseRevision)&&baseRevision>=0))throw error('IRON_INVALID','Invalid base revision');
  const entry={version:1,id,scope:copy(scope),writer:writerId,createdAt:Date.now(),parents,data:copy(data),pending:meta.pending===undefined?true:!!meta.pending,baseRevision,baseKnown:meta.baseKnown===undefined?(meta.baseRevision===undefined?current.baseKnown:baseRevision!==null):!!meta.baseKnown,conflicted:meta.conflicted===undefined?current.conflicted:!!meta.conflicted,legacyPending:meta.legacyPending===undefined?current.legacyPending:!!meta.legacyPending,sessionGeneration:meta.sessionGeneration||0,reason};
  jsonSafe(entry);if(!Number.isSafeInteger(entry.sessionGeneration)||entry.sessionGeneration<0)throw error('IRON_INVALID','Invalid session generation');
  const raw=JSON.stringify(entry);if(raw.length>4*1024*1024)throw error('IRON_LIMIT','Journal entry exceeds local safety limit');
  storage.setItem(key,raw);if(get(key)!==raw)throw error('IRON_UNCERTAIN','Journal write could not be verified');
  return read(scope);
 }
 function exportLegacy(){const metadata={};for(const prefix of ['purrfect_pending_','purrfect_revision_'])for(const key of keys(prefix))metadata[key]=get(key);return {format:'purrfect-legacy-recovery',version:1,raw:get('purrfect_v01'),metadata};}
 function exportScope(input){const scope=validateScope(input),entries={};for(const key of keys(scopePrefix(scope)))entries[key]=get(key);const guest=scope.uid===null,sourceKey=guest?'purrfect_data_v2_guest':'purrfect_data_v2_'+encodeURIComponent(scope.uid)+':'+encodeURIComponent(scope.fid),source={key:sourceKey,raw:get(sourceKey)};if(!guest){const suffix=encodeURIComponent(scope.uid)+':'+encodeURIComponent(scope.fid);source.pending=get('purrfect_pending_v2_'+suffix);source.revision=get('purrfect_revision_v2_'+suffix);source.unscopedPending=get('purrfect_pending_'+scope.fid);source.unscopedRevision=get('purrfect_revision_'+scope.fid)}return {format:'purrfect-journal-recovery',version:1,scope:copy(scope),entries,source};}
 return Object.freeze({open:(uid,fid)=>read(makeScope(uid,fid)),read,append,exportLegacy,exportScope,scope:(uid,fid)=>makeScope(uid,fid),prefix:PREFIX});
}
root.PurrfectStore=Object.freeze({create,PREFIX});
})(typeof window!=='undefined'?window:globalThis);
