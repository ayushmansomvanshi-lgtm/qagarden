# QAGarden v3.5 — Tester Login & Redis Sync Fix

This release fixes the case where a tester exists in the Manager dashboard but the Tester login still says the workspace/account is not ready.

## What was fixed

- Tester login no longer incorrectly depends on a separate `manager exists` pre-check.
- QAGarden detects all supported Vercel KV and Upstash REST variable pairs.
- When both `KV_*` and `UPSTASH_*` variables exist, QAGarden reads and merges the existing QAGarden data instead of silently choosing an empty database.
- Manager, tester, project and session data are synchronized across configured Redis aliases/databases.
- Existing manager/tester data is self-healed on the first request after deployment.
- Tester login gives a precise password/account error rather than a misleading setup error.

## Deploy

Copy these files over the existing Git repository, commit, push, and let Vercel redeploy. Then hard refresh the production URL.

Verify:

`/api/health`

The response should show version `3.5.0`, `configured: true`, and one or more configured stores.
