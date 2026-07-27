# QAGarden v2

QAGarden is a manager/tester website QA checklist with server-side authentication.

## Features

- One manager account created during first-time setup
- Testers created by name, email address and temporary password
- Email/password login for manager and testers
- Manager can assign an audit to a tester or to themselves
- Manager can open and complete any audit checklist
- Tester can only see audits assigned to their email account
- Simple Checked / Not checked workflow
- Records who checked each item and when
- All 36 checks required before sign-off
- Manager can reopen signed audits
- Data saved on the server in `data/qagarden.json`

## Run

```bash
npm start
```

No package installation is required. On macOS, you can also double-click `start-qagarden.command`.

Open:

```text
http://localhost:3001
```

To use another port:

```bash
PORT=4000 npm start
```

## Important

Tester email is used as the login ID. No npm install is required. This version does not send email invitations. Share the temporary password securely with the tester.
# QAGarden
# QAGarden
# QAGarden
# QAGarden
