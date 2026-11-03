# Independent security review — Iron Storage local patch

**Result: PASS for the 16 executed local adversarial checks. This is not production/browser/Firebase acceptance.**

The security reviewer did not edit integration code. Findings were sent to architect/programmer, fixes were made by their owners, and the reviewer reran independent tests. No GitHub, Firebase, Pages, credentials, production data or external messages were used. All fixtures are synthetic.

## Executed evidence

Command:

```bash
node --test security/*.test.mjs
```

Run from iron-storage. `security/results.txt` records **16 PASS / 0 FAIL**. These are assertions of safe expected behavior; earlier failing states were reproduced before corresponding fixes.

### Store integrity (12 tests)

- Key/envelope scope tampering is rejected.
- Corrupt JSON cannot silently become an empty profile.
- Failed setItem preserves earlier acknowledged entries.
- A successful write followed by a failed readback leaves both original and uncertain new entry recoverable; no deletion occurs.
- A stale writer cannot retire another pending branch.
- A remote snapshot cannot consume pending local state.
- Project namespaces do not collide for the same uid/fid.
- Legacy export retains original raw bytes and pending/revision metadata without owner guessing.
- Two writers deliberately interleaved between preflight and setItem produce two retained tips. Reload retains both candidates; ordinary ACK is refused.
- Remote/local interleaving produces a conflict retaining the local pending branch.
- Missing parents and cycles are rejected without deleting records.
- Corrupted pending metadata is rejected rather than treated as clean.

### Integration and mixed-release integrity (4 tests)

- Failed auth context switch cannot copy the previous account's payload into a newly created family owned by the next account.
- The actual patched render function hides the previous pet after an auth-context read failure; save and capture are blocked, recovery export retains prior data, and a successful explicit context switch unlocks editing.
- New app + stale main cloud cannot upload guest payload into a remembered family with old pending/revision markers.
- Old app + new cloud explicitly refuses boot before Firebase SDK imports; localSnapshot rejects protocol mismatch; no SDK requests/writes occur.

## Findings discovered and closed during review

### SEC-I1 — P1/P0 integrity: invalid pending marker silently treated as false

Initial module used equality to `'1'` for v2/legacy markers, so `'garbage'` became clean. The independent test failed. The architect changed parsing to accept only null or `'1'`; invalid metadata now throws. Also an existing v2 scaffold no longer dismisses unknown old pending ambiguity. Final evidence: store-attacks test 12 PASS.

Relevant final code: patched/local-store.js:51–55. This is recovery integrity, not an authentication bypass.

### SEC-I2 — P0: cross-account create after failed auth scope switch

Initial integration could leave local u/A active when switching to v failed during guest read. familyCreate then used that source under owner v. The independent test reproduced u-private in the new family's cloud payload. The programmer added a source UID gate (guest or current account only), before the first await; source and operation intent are captured durably. Final evidence: async-security.test.mjs PASS.

Relevant final code: patched/cloud.js familyCreate source.view.scope.uid check; operation snapshot before setDoc. Export/recovery data remains in the original scope. No claim is made that browser localStorage is confidential against a user of the same browser profile.

### SEC-I3 — P0 rollout integrity: mixed releases bypass new scope switching

The network-first Service Worker can combine new app.js with stale main cloud.js. With retained old pending_A/revision_A, old watch(A) does not switch the new journal's guest scope, and unguarded readLocal previously uploaded guest B to A. This was reproduced by executing the actual stale main cloud with new app.

The programmer added a required storage protocol argument to the new read bridge, protocol checks before SDK boot and localSnapshot, and an immutable new-cloud capability. Old no-argument read calls now fail before transaction upload. Conversely old app/new cloud refuses initialization. Final evidence: both mixed-version tests PASS.

Relevant final code: patched/app.js LOCAL_PROTOCOL and purrfectLocalData protocol gate; patched/cloud.js STORAGE_PROTOCOL, localSnapshot/readLocal/begin checks.

## Static assessment of final safety properties

- local-store.js collect validates scope/ID, metadata types, known parents, graph cycles and stable enumeration before producing a view (lines 32–42).
- append checks expected tips before writing; a pending/conflicted state cannot be cleared by ordinary remote snapshots, and the old entry is never overwritten (63–81).
- Each single immutable entry includes payload, pending, baseline revision, ancestry and scope. No mutable head pointer or separate pending update is a correctness dependency.
- Session generation and operation ownership guard successful, failed and cleanup branches in merge/upload; transaction callbacks recheck session around tx.get. Source snapshots are captured before asynchronous creation.
- Current-scope apply uses expected parents. A concurrent edit cannot be marked synced by an ACK for an older capture.
- Storage failure does not become an empty profile. An unsaved working copy is retained in RAM and recovery export; automatic upload/switch is blocked rather than falsely acknowledged.

## Remaining limits and required rollout checks

1. **No linearizability claim:** localStorage is not a transactional multi-tab database. Races can create forks; all branches are retained and automatic sync stops. This trades availability for recoverability.
2. **No automatic GC:** full snapshots accumulate. Quota exhaustion must remain explicit fail-closed; a separately reviewed transactional compactor is needed for long-lived use. The patch is not evidence of indefinite storage capacity or bounded latency.
3. **Unsaved RAM on failure:** if storage refuses a write, closing the tab can lose that unacknowledged RAM-only edit. UI warns not to close and offers export. No code can promise durable storage when the browser refuses it.
4. **Failed auth context read:** the patch now renders a locked recovery screen hiding the previous pet and blocks editing/capture until a valid context switch succeeds. This was verified with the actual render function in a synthetic DOM, but real browser recovery-navigation UX still needs testing. This is not a same-browser confidentiality boundary against hostile JavaScript.
5. **Same-origin trust:** protocol handshakes prevent accidental stale clients, not hostile same-origin JavaScript. XSS or a privileged extension can read/modify localStorage. Firebase Rules remain the actual authorization boundary.
6. **Untested integration:** actual browser storage scheduling/events, private mode, disk persistence, Firebase Auth token changes, transaction retries, two real browser windows and Service Worker upgrade/cache behavior still need disposable-data testing. The tests use real client functions with SDK/DOM mocks, not the live SDK.
7. **Partial family creation:** operation intent preserves source and new fid if the server family document exists but state creation or session changes interrupt the workflow. Manual reconciliation/resume is required; no automatic orphan deletion is approved here.
8. **Bootstrap unavailable storage:** startup can intentionally refuse to render a writable app. Raw localStorage recovery may require a separate recovery screen/manual export; fail-closed is not equivalent to continuous availability.

Recommended decision: accept the local artifact as a tested candidate for further review; do not deploy or claim complete safety from these local results. Before rollout, use immutable/versioned asset releases if possible, verify the mixed-release guards with real Service Worker caches, export legacy/recovery data, and repeat the eight original regressions plus auth/fork/fault tests on disposable browser profiles.

## Whole-old-client and rollback deployment gate

A fully old app + fully old cloud already running in another tab/device never executes the new protocol guard. The local patch cannot remotely make that old client safe or revoke its ability to write. Real rollout therefore remains blocked until known old clients are closed/refreshed and a separately reviewed server-side minimum-client/schema fence is considered for offline/unknown clients. No Firebase Rules change was made or authorized in this local work.

Rollback is likewise not “load old app against untouched purrfect_v01.” New journal entries, pending branches and post-cutover server changes must be exported and reverse-projected under a write barrier before an old client can be allowed to write again. Otherwise the untouched legacy snapshot is merely a recovery artifact, not an up-to-date rollback database.
