/**
 * Simple browser demo. NO Firebase access and no real pet data.
 * Importable from the experiment subdirectory on GitHub Pages.
 */
import { makeMigrationPlan, summarizeMigrationPlan } from './record-migration.js';
const root=document.getElementById('result');
const data=await (await fetch('./synthetic-family.json',{cache:'no-store'})).json();
const plan=makeMigrationPlan(data.state,data.revision);
if(!plan.canMigrate)throw Error(plan.errors.join('\n'));
const expected=new Map(plan.records.map(r=>[r.relativePath,JSON.stringify(r.payload)]));
const mirror=new Map();
for(const record of plan.records)mirror.set(record.relativePath,structuredClone(record.payload));
const equal=mirror.size===expected.size&&[...mirror.entries()].every(([p,v])=>JSON.stringify(v)===expected.get(p));
root.textContent=JSON.stringify({mode:'IN MEMORY ONLY — no Firebase',...summarizeMigrationPlan(plan),allRecordsMatch:equal,paths:[...mirror.keys()]},null,2);
if(!equal)root.textContent+='\nERROR: mirror does not match source';
