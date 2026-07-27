# QAGarden v3.2 — Vercel Storage Fix

This release fixes the `/api/setup` 500 error on Vercel.

## Why the earlier deployment failed

The previous server stored users, projects, checklist progress and sessions in `data/qagarden.json`. That works locally, but a Vercel Function cannot persist writes inside the deployed project directory. This release uses Upstash Redis in Vercel and keeps the JSON-file fallback only for local development.

## Local run

```bash
npm start
```

Open `http://localhost:3001`.

Local data is saved in `data/qagarden.json`.

## Required Vercel setup

1. Open the QAGarden project in Vercel.
2. Open **Storage / Marketplace**.
3. Add **Upstash Redis** and connect it to this project.
4. Confirm these environment variables exist in the Vercel project:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
5. Redeploy the latest Git commit.
6. Open `/api/health`. It should return:

```json
{"ok":true,"storage":"upstash-redis"}
```

If storage is missing, the API now returns a readable `503` message instead of an unexplained `500`.

## Git update

```bash
git add .
git commit -m "Fix Vercel persistence with Upstash Redis"
git push origin main
```

## Security

- Passwords are hashed with scrypt.
- Sessions are server-side and stored in Redis.
- Authentication cookies are HttpOnly, SameSite=Lax and Secure on Vercel.
- Never commit `.env` or Redis tokens.
