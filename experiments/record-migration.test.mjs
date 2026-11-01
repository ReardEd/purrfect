// Run in Node 18+: node experiments/record-migration.test.mjs
// The planner is an ES module with .js extension; import via data URL so
// the repository need not change its package type or production app.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const code = await readFile(new URL("./record-migration.js", import.meta.url), "utf8");
const { makeMigrationPlan, summarizeMigrationPlan } =
  await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
const pet = { id: "pet1", name: "Мурка" };
const note = { id: "n1", petId: "pet1", name: "Тест" };

const input = { pets: [pet], notes: [note],
  noteTombstones: [{ id: "deleted", petId: "pet1", deletedAt: "2026-11-01" }] };
const p = makeMigrationPlan(input, 4);
assert.equal(p.canMigrate, true);
assert.equal(p.totalDocuments, 3);
assert.equal(p.counts.noteTombstones, 1);
assert(p.records.some(r => r.relativePath === "records/notes/items/n1"));
assert(p.records.some(r => r.relativePath === "records/noteTombstones/items/deleted"));
p.records.find(r => r.kind === "pets").payload.name = "changed";
assert.equal(pet.name, "Мурка", "the planner must not mutate live state");

assert.equal(makeMigrationPlan({ pets: [pet], notes: [note, note] }, 4).canMigrate, false);
assert.equal(makeMigrationPlan({ pets: [pet], notes: [{ id: "n2", petId: "missing" }] }, 4).canMigrate, false);
assert.equal(makeMigrationPlan({ pets: [pet], notes: [note], noteTombstones: [{ id: "n1", petId: "pet1" }] }, 4).canMigrate, false);
assert.equal(makeMigrationPlan({ pets: [pet], notes: "broken" }, 4).canMigrate, false);
assert.throws(() => makeMigrationPlan(input, -1));
assert.throws(() => makeMigrationPlan(input, null));
assert.equal(summarizeMigrationPlan(p).records, undefined, "safe summary should not contain full pet details");
console.log("PASS: read-only migration planner; 9 checks");
