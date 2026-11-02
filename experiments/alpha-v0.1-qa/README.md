# Purrfect Alpha.v0.1 — release candidate (NOT DEPLOYED)

This is the reviewed local candidate for **five changed site files** in app-files/.
It is NOT a standalone website. The remaining site assets, including styles, manifest and Firebase config, must come from the actual Purrfect repository.

## Source
Work order 004 Iron Storage archive `Purrfect-Iron-Storage-Order004-2026-11-02.zip`, verified here on 2026-11-02.
Expected repository baseline commit from the report: 98104578fcfa095f0aa817c7a6c92f60cdf41d00.

## Local result
Node.js v22.16.0: 73/73 PASS using `node --test tests/*.test.mjs security/*.test.mjs store-smoke.test.mjs` (run from this archive's root).
An independent browser smoke test was attempted but blocked by this environment's navigation restrictions. It is **not** passed or completed.
Firebase/Rules integration and real device checks are NOT completed.

## Next required steps (do not skip)
1. Create a new isolated Git branch from the verified main SHA; apply ONLY the five files in `app-files/` and the tests.
2. Verify the source hashes and re-run Node tests in the branch.
3. Use a disposable browser profile/origin; check new account, edits, reload, two tabs, A/B account/family switching and offline failures.
4. In the **separate authorized test Firebase project**, validate two accounts, delayed transactions and real rules, not production data.
5. Export and VERIFY backups of existing accounts and the legacy local data before any production publication.
6. Address old PWA tabs/clients. The new client cannot fence already running wholly old code without backend changes. Plan a controlled rollout.
7. Only after approval publish Alpha.v0.1 to production. Do not roll back to old JS after new journal entries without migration.

DO NOT copy this release candidate over production/main or modify production Firebase directly.
