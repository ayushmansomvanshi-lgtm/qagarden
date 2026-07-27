# QAGarden v3.3 — Vercel KV Detection Fix

This release fixes the persistent-storage warning when Vercel has connected an Upstash database using the current Vercel KV variable names.

## Supported environment-variable names

QAGarden now automatically accepts either pair:

```text
KV_REST_API_URL
KV_REST_API_TOKEN
```

or:

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

It also recognises `VERCEL_KV_REST_API_*` and `REDIS_REST_*` aliases.

## Deploy to the existing GitHub repository

Copy this release over the existing repository without copying local account data:

```bash
rsync -av --delete \
  --exclude=.git \
  --exclude=node_modules \
  --exclude=data/qagarden.json \
  /path/to/qagarden-v3.3-vercel-kv-fixed/ \
  /path/to/your/qagarden-repository/
```

Then:

```bash
git add .
git commit -m "Fix Vercel KV persistent storage detection"
git push origin main
```

Vercel should deploy the new commit automatically. If it does not, redeploy the latest commit manually.

## Verify

Open:

```text
https://YOUR-DOMAIN/api/health
```

Expected response:

```json
{
  "ok": true,
  "storage": "upstash-redis",
  "configured": true,
  "urlVariable": "KV_REST_API_URL",
  "tokenVariable": "KV_REST_API_TOKEN",
  "version": "3.3.0"
}
```

The endpoint never returns secret values.

## Local run

```bash
npm start
```

Open `http://localhost:3001`. Local data is saved in `data/qagarden.json`.
