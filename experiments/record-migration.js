/**
 * Purrfect v1.5 EXPERIMENTAL — pure planning for per-record Firestore migration.
 * NO Firebase imports, writes, localStorage, user data, or production migration.
 * Plan documents before allowing a supervised shadow migration.
 *
 * Future layout:
 *   families/{fid}/pets/{id}
 *   families/{fid}/records/{kind}/items/{id} (Firestore nested collections)
 *   families/{fid}/meta/migration
 *
 * Current live sync remains families/{fid}/shared/state.
 */
export const COLLECTIONS = Object.freeze([
  "pets", "events", "weights", "notes", "vaccines",
  "foods", "shopping", "visits", "foodReactions"
]);
const PET_SCOPED = new Set(COLLECTIONS.filter(name => name !== "pets"));
export const SCHEMA_VERSION = 1;

export function makeMigrationPlan(state, revision) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("Семейные данные должны быть объектом");
  }
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("Для миграции нужна подтверждённая ревизия сервера");
  }
  const errors = [];
  const records = [];
  const pathKeys = new Set();
  const sourcePets = Array.isArray(state.pets) ? state.pets : [];
  const petIds = new Set(sourcePets.map(p => p?.id).filter(Boolean));

  for (const kind of COLLECTIONS) {
    if (state[kind] !== undefined && !Array.isArray(state[kind])) {
      errors.push(kind + ": ожидался массив");
      continue;
    }
    const items = state[kind] || [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        errors.push(kind + "[" + i + "]: некорректная запись");
        continue;
      }
      const id = item.id;
      // No slashes; doc IDs must be unambiguous and cannot cross paths.
      if (typeof id !== "string" || !id.trim() || id.includes("/") || id === "." || id === ".." || id.length > 500) {
        errors.push(kind + "[" + i + "]: неверный ID");
        continue;
      }
      if (PET_SCOPED.has(kind) && (typeof item.petId !== "string" || !petIds.has(item.petId))) {
        errors.push(kind + "[" + i + "]: не найден питомец");
        continue;
      }
      const relativePath = kind === "pets" ? "pets/" + id : "records/" + kind + "/items/" + id;
      if (pathKeys.has(relativePath)) {
        errors.push(kind + "[" + i + "]: повтор ID " + id);
        continue;
      }
      pathKeys.add(relativePath);
      records.push({
        kind, id, relativePath,
        // Deep-copy so a caller cannot change original local state via a plan.
        payload: JSON.parse(JSON.stringify(item))
      });
    }
  }

  const tombstones = Array.isArray(state.noteTombstones) ? state.noteTombstones : [];
  if (state.noteTombstones !== undefined && !Array.isArray(state.noteTombstones)) {
    errors.push("noteTombstones: ожидался массив");
  }
  const deleted = new Set();
  for (let i = 0; i < tombstones.length; i++) {
    const entry = tombstones[i];
    if (!entry || typeof entry.id !== "string" || !entry.id ||
        entry.id.includes("/") || !petIds.has(entry.petId)) {
      errors.push("noteTombstones[" + i + "]: неверная отметка");
      continue;
    }
    if (deleted.has(entry.id)) {
      errors.push("noteTombstones[" + i + "]: повтор ID удаления");
      continue;
    }
    deleted.add(entry.id);
    const relativePath = "records/noteTombstones/items/" + entry.id;
    pathKeys.add(relativePath);
    records.push({
      kind: "noteTombstones", id: entry.id, relativePath,
      payload: JSON.parse(JSON.stringify(entry))
    });
  }
  for (const item of state.notes || []) {
    if (deleted.has(item?.id)) errors.push("notes: активная и удалённая запись имеют один ID " + item.id);
  }

  const counts = Object.fromEntries([...COLLECTIONS, "noteTombstones"].map(kind => [
    kind, records.filter(r => r.kind === kind).length
  ]));
  return {
    schemaVersion: SCHEMA_VERSION,
    sourceRevision: revision,
    counts,
    totalDocuments: records.length,
    canMigrate: errors.length === 0,
    errors,
    records
  };
}

export function summarizeMigrationPlan(plan) {
  return {
    sourceRevision: plan.sourceRevision,
    schemaVersion: plan.schemaVersion,
    canMigrate: plan.canMigrate,
    totalDocuments: plan.totalDocuments,
    counts: { ...plan.counts },
    errors: [...plan.errors]
  };
}
