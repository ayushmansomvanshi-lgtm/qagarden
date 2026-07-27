# QAGarden v3

A role-based QA checklist and sign-off workspace with a polished animated interface.

## Highlights

- Role selection appears before login: **QA Manager** or **QA Tester**
- First manager selection creates the single protected manager account
- Manager login and tester login are validated separately
- Manager can create tester accounts by email, assign projects, test audits and reopen sign-offs
- Tester sees only assigned projects, checklist and sign-off
- 36 focused checks with 100% completion required before sign-off
- Server-side sessions and scrypt password hashing
- Animated 3D QA cube, floating audit cards, parallax and polished hover effects
- Responsive design and reduced-motion accessibility support

## Run

```bash
cd qagarden-auth-v3
npm start
```

Open `http://localhost:3001`.

No `npm install` is required. Data is stored locally in `data/qagarden.json`, which is ignored by Git.
