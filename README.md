# QAGarden v3.7 — Aurora Command UI

This release is a **UI-only redesign** built on the stable QAGarden v3.5 authentication and Redis/KV backend.

## Visual update

- Premium dark command-centre sidebar
- Aurora blue, violet and cyan gradient system
- Glass-style top bar, panels, dialogs and notifications
- Redesigned role selection and login screens
- Refined manager dashboard, tester panel, projects and tables
- Improved checklist cards, status controls and sign-off screens
- Stable hover, entrance and micro-interaction animations
- Responsive mobile, tablet and desktop layouts
- Light and dark theme support
- No generated images or external image assets

## Functionality preserved

The following files are unchanged from the stable functional release:

- `server.js`
- `api/index.js`
- `lib/storage.js`
- `public/app.js`

Therefore manager authentication, tester email/password accounts, project assignment, Redis/KV persistence, checklist completion and sign-off behaviour remain unchanged.

## Run locally

```bash
cd qagarden-v3.7-aurora-dashboard-ui
npm start
```

Open:

```text
http://localhost:3001
```

No external npm package installation is required.

## Vercel

The existing Vercel KV/Upstash variables remain compatible:

```text
KV_REST_API_URL
KV_REST_API_TOKEN
```

The legacy Upstash variable names are also supported by the unchanged storage layer.

See `GIT-UPDATE.md` for the exact update and deployment commands.
