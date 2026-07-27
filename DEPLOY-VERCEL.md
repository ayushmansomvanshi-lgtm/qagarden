# Exact Vercel update steps

1. Confirm the Vercel project contains `KV_REST_API_URL` and `KV_REST_API_TOKEN` under Settings > Environment Variables.
2. Replace the repository files with this release.
3. Commit and push to the same GitHub branch connected to Vercel.
4. Wait for a new Vercel deployment or redeploy the latest commit.
5. Open `/api/health` and confirm `storage` is `upstash-redis`.
6. Hard-refresh the main website.

The app reads environment variables at request time, so both current Vercel KV names and older Upstash names are supported.


After deployment, hard refresh once so app.js?v=3.4.0 is loaded. Existing Redis manager/tester data is preserved because the namespace remains unchanged.
