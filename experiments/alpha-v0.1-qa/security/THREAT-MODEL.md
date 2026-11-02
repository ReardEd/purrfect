# Integrity review — model before implementation

The security objective here is integrity and recoverability of authorized family data under faulty client sequencing. It is not encryption or isolation against malicious same-origin JavaScript. Any XSS, compromised same-origin dependency, browser extension with access, or a user controlling DevTools can read/modify localStorage. Firebase Rules remain the authorization boundary; no local key or scope string substitutes for server membership.

## Required invariants

1. A local record binds project, Firebase UID, family ID, schema, data, pending status, base server revision and its ancestry in one durable append. No separate pending bit can become a false assertion of a clean payload.
2. Every successfully acknowledged local edit has at least one immutable recoverable record until explicitly resolved. Remote snapshots cannot erase or consume an unrelated unsynced branch.
3. Existing history remains unchanged on failed writes, failed verification reads, corrupt JSON, invalid metadata or unavailable storage. Missing context is different from unreadable context.
4. Switching is prepare/validate/commit. If prepare fails, current live state and durable ancestry stay attached to the original scope. Transport detach cannot stop recording local changes.
5. Every asynchronous operation captures uid/fid/project/session generation and source journal ID before await. Its success/error/finally mutates only state it still owns. Transaction callbacks may be retried and must not use newly selected mutable global data.
6. Closing a tab requires no lease cleanup to preserve its acknowledged edits. Another tab cannot assume that a branch is obsolete merely because its owner is not alive.
7. All concurrent tips are detected or at least retained. localStorage scan/append is not a CAS transaction; if two writers append from the same parent, both records survive, and neither may silently retire the other.
8. Recovery export includes original raw legacy payload and old pending/revision values without assigning them to a family. Unknown owner is an explicit unresolved state.
9. Automatic upload is allowed only for one validated local source whose scope matches target Firebase path and whose baseline agrees with the server revision. Completion cannot clean a newly-created descendant or sibling by accident.

## Tests needed beyond the eight regressions

- Two writers append from one parent before either observes the other; then close/reload each. Both payloads remain, conflict is explicit.
- A clean tab receives a remote update after another tab writes a pending branch: remote update does not retire that branch.
- Corrupt record, unknown schema, mismatched key/scope, missing parent, cross-scope parent, cycle, nonfinite number and unexpected metadata: fail closed before mutation/upload.
- setItem throws before write; readback throws after actual write; readback mismatch. Original acknowledged records remain. An uncertain new append must not be reported as safely committed or silently erased.
- Delayed old success, delayed rejection, old finally after a new session begins; same uid and fid ABA; transaction callback retry after session switch.
- Login/logout/transport error with edits still possible; no pending state depends on an active socket.
- Quota pressure: no automatic deletion of old recovery history; storage failure is visible, with explicit export recovery.

## Limits to report

A synchronous localStorage append journal can prioritize no silent deletion over availability. It is not a full linearizable database. navigator.locks can reduce duplicate network operations where available but cannot be the sole correctness mechanism or a crash recovery requirement. Firestore revision transactions still provide network serialization. No claim of production readiness follows from VM mocks alone; real browser multi-tab/storage-event behaviour and actual Firebase SDK retries need separate integration testing on disposable data.
