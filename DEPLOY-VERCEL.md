# Deploy QAGarden v3.7 to Vercel

1. Copy this release into the existing Git repository while preserving `.git` and `data/qagarden.json`.
2. Commit and push to the existing `main` branch.
3. Keep the current Vercel KV/Upstash environment variables connected.
4. Wait for Vercel to finish the production deployment.
5. Hard-refresh the site using `Command + Shift + R`.
6. Verify Manager login, Tester login, project assignment, checklist toggling and sign-off.

This release changes only HTML metadata and CSS presentation. API, authentication, data storage and application functions are unchanged.
