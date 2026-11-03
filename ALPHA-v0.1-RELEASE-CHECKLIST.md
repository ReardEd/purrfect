# Purrfect Alpha.v0.1 — controlled personal release

Status: **PRE-RELEASE; do not merge until the human go/no-go gate below**.

## Evidence available
- 73/73 local Node tests passed on Windows for Iron Storage Order #004.
- Isolated browser-origin smoke reported PASS: onboarding, persistence after F5, two tabs, offline save, reopening.
- Test Firebase project `purrfect-lab`: two email/password accounts, owner/member access, shared family, notes synchronized both directions after aligning laboratory Firestore rules.
- These are scenario tests, **not** exhaustive security or production migration certification.
- The cloud lab site was manually reconfigured; its Firebase configuration MUST NOT be copied into the production repo.
- Existing live project is `purrfect-296c9`, not `purrfect-lab`.

## Release decision for this rollout (confirmed with Reard)
- **Clean personal alpha**: production user data is currently test-only; Sveta has never used the live app and has no device data to migrate.
- Save **one final copy of Reard's existing old-version data** for rollback/audit even if disposable. No backup from Sveta is needed because she has no old profile.
- Do NOT automatically delete production Firestore test families or browser localStorage. A clean user onboarding should be done through a fresh browser profile/session or reviewed reset procedure; production cloud cleanup is a **separate destructive action** that needs explicit consent and known target IDs.
- Give Sveta a **new individual login**, then connect to the intended family, with no existing family data imported from the laboratory.

## Hard gates BEFORE merge
1. In **production site** `https://rearded.github.io/purrfect/`, Reard downloads an app-provided backup while still on the OLD version; keep originals safely; confirm files contain expected pets and records, not just nonzero file size. Save copies away from the browser. If an app backup feature cannot produce verifiable data, STOP.
2. Protect existing Firebase family: note current family ID and accounts (private); confirm the cloud state matches live app and has not diverged due to pending local changes. For cloud backups, use an authenticated, non-destructive export method; **do not** substitute a lab export.
3. Coordinate an edit freeze for both users. Close **ALL** old Purrfect tabs/PWA installations on both devices. Old clients do not know the new journal protocol; a stale old client can still publish after rollout.
4. Review open draft PR #5; verify base `main` and head `release/alpha-v0.1-candidate`, including all five live site files `app.js`, `cloud.js`, `local-store.js`, `index.html`, `sw.js` and their protocol compatibility. Do not deploy the archived `experiments/alpha-v0.1-qa/patched/` files as separate site.
5. Ensure actual production Firestore rules permit `families/{fid}/shared/state` under membership and revision checks. Do NOT blindly install lab rules or edit production rules without review.
6. Check production site load and session transition in a throwaway browser context first. Preserve Reard's legacy raw local data: no automatic ownership inference or destructive cleanup; if migration/permissions prompt conflict or export, STOP and triage.
7. Merge/deploy **only after explicit Reard approval** and verified backups. Monitor first family connect from both accounts in sequence, no simultaneous edits; confirm previous pet data plus fresh note propagation A→B and B→A and reload persistence. If uncertain, stop edits and preserve journal exports.

## Important release boundaries
- The test lab ran on 127.0.0.1:8766 with `purrfect-lab` config; it is not the public website. Port 8765 was a separate offline-only local origin.
- Chromium tab title mojibake was observed on a **locally PowerShell-edited** `index.html`; GitHub branch file is UTF-8 and contains the correct Cyrillic title. Do not copy the edited local lab file into the release.
- Existing old `purrfect_v01` data is preserved as legacy, and current release journal has a recovery export, but this **does not** imply fully automatic, lossless migration of every existing device/family. Use backups and a controlled transition.
- The old lab Firestore experimental per-record rules were incompatible with the monolithic `shared/state` client. This was a lab mismatch, not evidence that production rules should be changed blindly.
- Do not force-push/reset, erase browser data, merge old PR #4, or roll back to old app JS after journal writes without a migration plan.
- Production **Google Play / Apple App Store** releases are separate future projects; this gate is for private web/PWA Alpha.v0.1 only.

## Human go/no-go checklist
- [ ] Reard's single production test-data backup verified (Sveta has no prior data)
- [ ] Cloud state/family ownership checked and backed up
- [ ] Both devices' old tabs closed; short edit freeze agreed
- [ ] Production rules reviewed, existing account flows understood
- [ ] Reard expressly approves merge/deployment
- [ ] Post-deploy two-account smoke + recovery journal download verified

If any box fails: **NO-GO**, keep `main` and production unchanged.
