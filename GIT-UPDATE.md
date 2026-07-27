# Update the existing QAGarden Git repository

These commands preserve `.git`, `node_modules` and local `data/qagarden.json`.

## 1. Extract the ZIP

```bash
cd ~/Desktop
rm -rf qagarden-v3.7-aurora-dashboard-ui
unzip -o ~/Downloads/qagarden-v3.7-aurora-dashboard-ui.zip -d ~/Desktop
```

## 2. Copy the UI release into the existing repository

```bash
rsync -av --delete \
  --exclude=".git" \
  --exclude="node_modules" \
  --exclude="data/qagarden.json" \
  ~/Desktop/qagarden-v3.7-aurora-dashboard-ui/ \
  ~/Desktop/qagarden-auth-v2/
```

## 3. Test locally

```bash
cd ~/Desktop/qagarden-auth-v2
npm start
```

Open `http://localhost:3001` and check Manager and Tester login.

## 4. Commit and push

Stop the server with `Control + C`, then run:

```bash
cd ~/Desktop/qagarden-auth-v2
git status
git add .
git commit -m "Upgrade QAGarden to v3.7 Aurora Command UI"
git push origin main
```

Vercel should deploy the pushed commit automatically.

## 5. Production check

After deployment, hard-refresh with `Command + Shift + R` and open:

```text
https://qagarden-test.vercel.app/api/health
```

The backend health version can still report `3.5.0` because this release intentionally does not change backend logic.
