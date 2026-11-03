# Independent tester report — Iron Storage local patch

Date: 2026-11-01. Role: real subagent `/root/iron_tester`. All execution local on synthetic data, Node v24.22.1. No Firebase/browser/production assertions.

## Red before patch

The eight previously failing PR4 scenarios were copied into `regression.test.mjs` with PR4 app/cloud in `baseline/`. They were executed **before implementation**. `logs/baseline-regression.txt`: 18 cases, 10 PASS / 8 FAIL. The root, programmer and architect were notified only after that red execution.

Harness adapters were subsequently changed to load the new store module and consult actual journal views instead of obsolete v2 keys. `TEST_VARIANT=baseline node --test tests/regression.test.mjs` still produces the same 10 PASS / 8 FAIL (`logs/baseline-adapted.txt`). No failing case was skipped.

## Patched result

```bash
node --test tests/regression.test.mjs tests/compatibility.test.mjs tests/async-safety.test.mjs tests/store-safety.test.mjs tests/form-safety.test.mjs tests/pr3-extra.test.mjs
```

52 tests, 52 PASS, 0 FAIL. Log: `logs/independent-final.txt`.

- regression: 18 tests, including all 8 prior failures;
- PR3 compatibility: 4 tests;
- PR3 supplemental normal/reentrant/direct-RAM/ABA cases: 4 tests;
- asynchronous safety: 7 tests;
- form/role asynchronous safety: 8 tests;
- independent store safety: 11 tests.

The tests run real app load/save/context/remote bridges, cloud transaction callbacks and the actual Auth observer callback. DOM, SDK and scheduling are mocked. Two-tab simulation has two isolated JS VMs, shared storage/server, unique tab UUIDs and explicit remote snapshots. Module tests also force an actual synchronous interleaving between preflight and setItem; this is stronger than only sequentially testing stale parents.

## Traceability of the eight failures

| Old failure | Baseline | Patched assertion |
|---|---|---|
| Legacy conflict backup exports empty scoped data | FAIL | Explicit legacy export contains original legacy payload; original raw remains unchanged |
| Failed departure disables dirty tracking and loses next edit | FAIL | Failure aborts switch; live working copy can be saved, reconnect retains both original and following edit |
| Payload saved but pending marker fails | FAIL | One atomic journal write includes pending; simulated second write failure does not create acknowledged unmarked data |
| Target read error becomes empty and later overwrites saved data | FAIL | Read error aborts target adoption; original pending data remains recoverable |
| Same-family second tab snapshot overwrites pending first tab | FAIL | Second tab observes journal pending, cannot replace it; first tab reload retains its note |
| Old takeCloud B result enters A and uploads B into cloud A | FAIL | Old result ignored; follow-up A upload contains A |
| Create family reads B after starting from guest | FAIL | Uses captured source or safely aborts remaining writes after session change; never creates state from B |
| Subscription failure disables tracking of next local edit | FAIL | Local save persists pending independently of transport; reconnect retains note |

Adaptations are semantic, not reduced requirements: explicit legacy export is tested instead of demanding automatic assignment of ambiguous legacy to a family; safe abort of old creation is allowed instead of requiring an operation to complete after navigation. Family IDs are derived from actual requests rather than assuming deterministic `new-1`. Storage fault injection targets actual journal records or the atomic write boundary rather than requiring old marker keys to remain.

## Independently found and corrected during implementation

Initial patched integration had 26/27 PASS. Two tabs receiving the exact same remote snapshot caused a redundant clean journal head, so the original first-tab edit was rejected as stale before reaching the old loss scenario. This was reported without weakening the test. Programmer added canonical no-op remote commit handling. The unchanged scenario then passed.

## Additional verified properties

- Immutable records retain prior bytes; quota failure leaves prior committed records untouched.
- Concurrent writers interleaved after preflight create recoverable conflict candidates; both variants appear in recovery export.
- Stale clean remote writes cannot consume pending records.
- Corrupt entries and get failures throw instead of returning an empty profile.
- ID collisions refuse overwrite; project IDs namespace storage separately.
- Readback failure after an actual write reports uncertainty; a new store instance recovers the written pending entry.
- A remote transaction that succeeds before local ACK failure does not clear pending/recovery data.
- Old upload success/failure cannot release or poison a new session; callback starting after A→B→A does not publish stale local state.
- A stale UI edit is rejected visibly, while recovery export contains its live unsaved variant and the other tab's durable variant.

## Remaining scope and limitations

Local test PASS is not a production acceptance or browser integration PASS. Browser binary unavailable; real storage event scheduling, SDK retries and Firestore Rules not executed. Journal compaction/GC and automatic merge of fork variants are intentionally absent. Failed persistence cannot guarantee survival of unsaved in-memory edits if the user closes the tab; the requirement verified here is visible failure and recoverable export, not impossible persistence through total storage denial.

Static review additionally identified unfenced legacy form/role handlers. Programmer corrected their session fencing; eight new executable form-safety cases now verify late familyJoin success/rejection, A→B→A generation, current successful join, late remove/accept authorization reads, and already-issued role update completions. All eight pass. A persistent storage-read denial test additionally verifies RAM/live recovery export remains possible after a failed save and discloses journalReadError. The final combined verdict must include independent security review and must not treat this test count as proof of every application path.
