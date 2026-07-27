# Deploy QAGarden v3.5

1. Replace the files in the existing Git repository with this release.
2. Preserve `.git`, and do not upload `data/qagarden.json`.
3. Commit and push to `main`.
4. Wait for the production Vercel deployment to finish.
5. Open `/api/health` and confirm version `3.5.0`.
6. Hard refresh with Command + Shift + R.
7. Manager: open Tester accounts, edit the tester, enter a new password, and Save tester.
8. Log out, choose QA Tester, and use that tester email and new password.

This release automatically reconciles data if old deployments wrote to `UPSTASH_*` while newer deployments read `KV_*`.
