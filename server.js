"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3001);
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "qagarden.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const TOTAL_CHECKS = 36;
const SESSION_TTL = 12 * 60 * 60 * 1000;
const sessions = new Map();
const authAttempts = new Map();

fs.mkdirSync(DATA_DIR, { recursive: true });

function defaultDb() {
  return { version: 2, manager: null, testers: [], projects: [] };
}

function readDb() {
  try {
    if (!fs.existsSync(DB_FILE)) return defaultDb();
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    return {
      ...defaultDb(),
      ...parsed,
      testers: Array.isArray(parsed.testers) ? parsed.testers : [],
      projects: Array.isArray(parsed.projects) ? parsed.projects : []
    };
  } catch (error) {
    console.error("Could not read database:", error);
    return defaultDb();
  }
}

function writeDb(db) {
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(tmp, DB_FILE);
}

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}`;
}

function normaliseEmail(value = "") {
  return String(value).trim().toLowerCase();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function safeUser(user) {
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt };
}

function buildChecks() {
  const checks = {};
  const categorySizes = [5, 7, 5, 6, 5, 4, 4];
  let count = 0;
  categorySizes.forEach((size, categoryIndex) => {
    for (let itemIndex = 0; itemIndex < size; itemIndex += 1) {
      checks[`c${categoryIndex}_i${itemIndex}`] = false;
      count += 1;
    }
  });
  if (count !== TOTAL_CHECKS) throw new Error("Checklist count mismatch");
  return checks;
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index >= 0 ? [part.slice(0, index), decodeURIComponent(part.slice(index + 1))] : [part, ""];
      })
  );
}

function sessionUser(req, db) {
  const token = parseCookies(req)["qagarden.sid"];
  if (!token) return null;
  const entry = sessions.get(token);
  if (!entry || entry.expiresAt < Date.now()) {
    if (entry) sessions.delete(token);
    return null;
  }
  entry.expiresAt = Date.now() + SESSION_TTL;
  if (entry.role === "manager") {
    return db.manager?.id === entry.userId ? { ...db.manager, role: "manager" } : null;
  }
  const tester = db.testers.find((item) => item.id === entry.userId && item.active !== false);
  return tester ? { ...tester, role: "tester" } : null;
}

function createSession(res, user) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { userId: user.id, role: user.role, expiresAt: Date.now() + SESSION_TTL });
  res.setHeader("Set-Cookie", `qagarden.sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`);
}

function clearSession(req, res) {
  const token = parseCookies(req)["qagarden.sid"];
  if (token) sessions.delete(token);
  res.setHeader("Set-Cookie", "qagarden.sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}

function canAccessProject(user, project) {
  return user.role === "manager" || (project.assigneeType === "tester" && project.testerId === user.id);
}

function publicProject(project) {
  return { ...project, checks: project.checks || buildChecks(), checkMeta: project.checkMeta || {} };
}

function applyHeaders(res, contentType = "application/json; charset=utf-8") {
  res.setHeader("Content-Type", contentType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cache-Control", contentType.startsWith("text/html") ? "no-store" : "no-cache");
}

function json(res, status, payload) {
  applyHeaders(res);
  res.statusCode = status;
  res.end(JSON.stringify(payload));
}

function noContent(res) {
  applyHeaders(res);
  res.statusCode = 204;
  res.end();
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error("Invalid JSON.")); }
    });
    req.on("error", reject);
  });
}

function authAllowed(req) {
  const key = req.socket.remoteAddress || "local";
  const now = Date.now();
  const record = authAttempts.get(key) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (record.resetAt < now) {
    record.count = 0;
    record.resetAt = now + 15 * 60 * 1000;
  }
  record.count += 1;
  authAttempts.set(key, record);
  return record.count <= 40;
}

function matchPath(pathname, pattern) {
  const match = pathname.match(pattern);
  return match ? match.slice(1).map(decodeURIComponent) : null;
}

async function handleApi(req, res, url) {
  const db = readDb();
  const user = sessionUser(req, db);
  const method = req.method || "GET";
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/bootstrap") {
    return json(res, 200, { setupRequired: !db.manager, user: safeUser(user) });
  }

  if (method === "POST" && pathname === "/api/setup") {
    if (!authAllowed(req)) return json(res, 429, { error: "Too many attempts. Try again later." });
    if (db.manager) return json(res, 409, { error: "The manager account has already been created." });
    const body = await readJson(req);
    const name = String(body.name || "").trim();
    const email = normaliseEmail(body.email);
    const password = String(body.password || "");
    if (name.length < 2) return json(res, 400, { error: "Enter your full name." });
    if (!validEmail(email)) return json(res, 400, { error: "Enter a valid manager email address." });
    if (password.length < 8) return json(res, 400, { error: "Password must contain at least 8 characters." });
    const passwordData = hashPassword(password);
    const now = new Date().toISOString();
    db.manager = { id: id("manager"), name, email, passwordSalt: passwordData.salt, passwordHash: passwordData.hash, createdAt: now, updatedAt: now };
    writeDb(db);
    const account = { ...db.manager, role: "manager" };
    createSession(res, account);
    return json(res, 201, { user: safeUser(account) });
  }

  if (method === "POST" && pathname === "/api/login") {
    if (!authAllowed(req)) return json(res, 429, { error: "Too many attempts. Try again later." });
    const body = await readJson(req);
    const email = normaliseEmail(body.email);
    const password = String(body.password || "");
    const manager = db.manager?.email === email ? { ...db.manager, role: "manager" } : null;
    const tester = db.testers.find((item) => item.email === email && item.active !== false);
    const account = manager || (tester ? { ...tester, role: "tester" } : null);
    if (!account || !verifyPassword(password, account.passwordSalt, account.passwordHash)) {
      return json(res, 401, { error: "Incorrect email address or password." });
    }
    createSession(res, account);
    return json(res, 200, { user: safeUser(account) });
  }

  if (method === "POST" && pathname === "/api/logout") {
    clearSession(req, res);
    return noContent(res);
  }

  if (!user) return json(res, 401, { error: "Authentication required." });

  if (method === "GET" && pathname === "/api/workspace") {
    const projects = user.role === "manager"
      ? db.projects
      : db.projects.filter((project) => project.assigneeType === "tester" && project.testerId === user.id);
    return json(res, 200, {
      user: safeUser(user),
      manager: db.manager ? { id: db.manager.id, name: db.manager.name, email: db.manager.email } : null,
      testers: user.role === "manager"
        ? db.testers.filter((tester) => tester.active !== false).map((tester) => ({ id: tester.id, name: tester.name, email: tester.email, createdAt: tester.createdAt, updatedAt: tester.updatedAt }))
        : [],
      projects: projects.map(publicProject)
    });
  }

  const testerId = matchPath(pathname, /^\/api\/testers\/([^/]+)$/);
  if (pathname === "/api/testers" || testerId) {
    if (user.role !== "manager") return json(res, 403, { error: "Manager access required." });

    if (method === "POST" && pathname === "/api/testers") {
      const body = await readJson(req);
      const name = String(body.name || "").trim();
      const email = normaliseEmail(body.email);
      const password = String(body.password || "");
      if (name.length < 2) return json(res, 400, { error: "Enter the tester's full name." });
      if (!validEmail(email)) return json(res, 400, { error: "Enter a valid tester email address." });
      if (password.length < 8) return json(res, 400, { error: "Temporary password must contain at least 8 characters." });
      if (db.manager?.email === email || db.testers.some((tester) => tester.email === email && tester.active !== false)) {
        return json(res, 409, { error: "That email address is already in use." });
      }
      const passwordData = hashPassword(password);
      const now = new Date().toISOString();
      const tester = { id: id("tester"), name, email, passwordSalt: passwordData.salt, passwordHash: passwordData.hash, active: true, createdAt: now, updatedAt: now };
      db.testers.push(tester);
      writeDb(db);
      return json(res, 201, { tester: { id: tester.id, name: tester.name, email: tester.email, createdAt: tester.createdAt, updatedAt: tester.updatedAt } });
    }

    if (testerId && method === "PUT") {
      const tester = db.testers.find((item) => item.id === testerId[0] && item.active !== false);
      if (!tester) return json(res, 404, { error: "Tester not found." });
      const body = await readJson(req);
      const name = String(body.name || "").trim();
      const email = normaliseEmail(body.email);
      const password = String(body.password || "");
      if (name.length < 2) return json(res, 400, { error: "Enter the tester's full name." });
      if (!validEmail(email)) return json(res, 400, { error: "Enter a valid tester email address." });
      if (password && password.length < 8) return json(res, 400, { error: "New password must contain at least 8 characters." });
      if (db.manager?.email === email || db.testers.some((item) => item.id !== tester.id && item.email === email && item.active !== false)) {
        return json(res, 409, { error: "That email address is already in use." });
      }
      tester.name = name;
      tester.email = email;
      tester.updatedAt = new Date().toISOString();
      if (password) {
        const passwordData = hashPassword(password);
        tester.passwordSalt = passwordData.salt;
        tester.passwordHash = passwordData.hash;
      }
      writeDb(db);
      return json(res, 200, { tester: { id: tester.id, name: tester.name, email: tester.email, createdAt: tester.createdAt, updatedAt: tester.updatedAt } });
    }

    if (testerId && method === "DELETE") {
      const tester = db.testers.find((item) => item.id === testerId[0] && item.active !== false);
      if (!tester) return json(res, 404, { error: "Tester not found." });
      const assigned = db.projects.filter((project) => project.assigneeType === "tester" && project.testerId === tester.id);
      if (assigned.length) return json(res, 409, { error: `Reassign or delete ${assigned.length} audit${assigned.length === 1 ? "" : "s"} before deleting this tester.` });
      tester.active = false;
      tester.updatedAt = new Date().toISOString();
      writeDb(db);
      return noContent(res);
    }
  }

  const projectId = matchPath(pathname, /^\/api\/projects\/([^/]+)$/);
  const checkPath = matchPath(pathname, /^\/api\/projects\/([^/]+)\/checks\/([^/]+)$/);
  const signoffPath = matchPath(pathname, /^\/api\/projects\/([^/]+)\/signoff$/);
  const reopenPath = matchPath(pathname, /^\/api\/projects\/([^/]+)\/reopen$/);

  if (method === "POST" && pathname === "/api/projects") {
    if (user.role !== "manager") return json(res, 403, { error: "Manager access required." });
    const body = await readJson(req);
    const name = String(body.name || "").trim();
    const websiteUrl = String(body.url || "").trim();
    const dueDate = String(body.dueDate || "").trim();
    const notes = String(body.notes || "").trim();
    const assigneeType = body.assigneeType === "manager" ? "manager" : "tester";
    const testerIdValue = assigneeType === "tester" ? String(body.testerId || "") : null;
    if (!name || !websiteUrl || !dueDate) return json(res, 400, { error: "Project name, website URL and due date are required." });
    try { new URL(websiteUrl); } catch { return json(res, 400, { error: "Enter a valid website URL." }); }
    if (assigneeType === "tester" && !db.testers.some((tester) => tester.id === testerIdValue && tester.active !== false)) {
      return json(res, 400, { error: "Choose a valid tester account." });
    }
    const now = new Date().toISOString();
    const project = { id: id("project"), name, url: websiteUrl, dueDate, notes, assigneeType, testerId: testerIdValue, checks: buildChecks(), checkMeta: {}, signoff: null, createdAt: now, updatedAt: now };
    db.projects.unshift(project);
    writeDb(db);
    return json(res, 201, { project: publicProject(project) });
  }

  if (projectId && method === "PUT") {
    if (user.role !== "manager") return json(res, 403, { error: "Manager access required." });
    const project = db.projects.find((item) => item.id === projectId[0]);
    if (!project) return json(res, 404, { error: "Audit not found." });
    const body = await readJson(req);
    const name = String(body.name || "").trim();
    const websiteUrl = String(body.url || "").trim();
    const dueDate = String(body.dueDate || "").trim();
    const notes = String(body.notes || "").trim();
    const assigneeType = body.assigneeType === "manager" ? "manager" : "tester";
    const testerIdValue = assigneeType === "tester" ? String(body.testerId || "") : null;
    if (!name || !websiteUrl || !dueDate) return json(res, 400, { error: "Project name, website URL and due date are required." });
    try { new URL(websiteUrl); } catch { return json(res, 400, { error: "Enter a valid website URL." }); }
    if (assigneeType === "tester" && !db.testers.some((tester) => tester.id === testerIdValue && tester.active !== false)) {
      return json(res, 400, { error: "Choose a valid tester account." });
    }
    Object.assign(project, { name, url: websiteUrl, dueDate, notes, assigneeType, testerId: testerIdValue, updatedAt: new Date().toISOString() });
    writeDb(db);
    return json(res, 200, { project: publicProject(project) });
  }

  if (projectId && method === "DELETE") {
    if (user.role !== "manager") return json(res, 403, { error: "Manager access required." });
    const before = db.projects.length;
    db.projects = db.projects.filter((item) => item.id !== projectId[0]);
    if (before === db.projects.length) return json(res, 404, { error: "Audit not found." });
    writeDb(db);
    return noContent(res);
  }

  if (checkPath && method === "PATCH") {
    const project = db.projects.find((item) => item.id === checkPath[0]);
    if (!project) return json(res, 404, { error: "Audit not found." });
    if (!canAccessProject(user, project)) return json(res, 403, { error: "You cannot access this audit." });
    if (project.signoff) return json(res, 409, { error: "This audit is signed off and locked." });
    if (!Object.prototype.hasOwnProperty.call(project.checks || {}, checkPath[1])) return json(res, 400, { error: "Invalid checklist item." });
    const body = await readJson(req);
    const checked = Boolean(body.checked);
    project.checks[checkPath[1]] = checked;
    project.checkMeta = project.checkMeta || {};
    if (checked) project.checkMeta[checkPath[1]] = { userId: user.id, name: user.name, role: user.role, checkedAt: new Date().toISOString() };
    else delete project.checkMeta[checkPath[1]];
    project.updatedAt = new Date().toISOString();
    writeDb(db);
    return json(res, 200, { project: publicProject(project) });
  }

  if (signoffPath && method === "POST") {
    const project = db.projects.find((item) => item.id === signoffPath[0]);
    if (!project) return json(res, 404, { error: "Audit not found." });
    if (!canAccessProject(user, project)) return json(res, 403, { error: "You cannot sign off this audit." });
    if (project.signoff) return json(res, 409, { error: "This audit is already signed off." });
    const checks = Object.values(project.checks || {});
    if (checks.length !== TOTAL_CHECKS || !checks.every(Boolean)) return json(res, 409, { error: "Complete every checklist point before sign-off." });
    const body = await readJson(req);
    project.signoff = { signedById: user.id, signedByName: user.name, signedByRole: user.role, signedAt: new Date().toISOString(), note: String(body.note || "").trim() };
    project.updatedAt = new Date().toISOString();
    writeDb(db);
    return json(res, 200, { project: publicProject(project) });
  }

  if (reopenPath && method === "POST") {
    if (user.role !== "manager") return json(res, 403, { error: "Manager access required." });
    const project = db.projects.find((item) => item.id === reopenPath[0]);
    if (!project) return json(res, 404, { error: "Audit not found." });
    project.signoff = null;
    project.updatedAt = new Date().toISOString();
    writeDb(db);
    return json(res, 200, { project: publicProject(project) });
  }

  return json(res, 404, { error: "API route not found." });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

function serveStatic(res, pathname) {
  let requestPath = pathname === "/" ? "/index.html" : pathname;
  requestPath = decodeURIComponent(requestPath);
  const candidate = path.normalize(path.join(PUBLIC_DIR, requestPath));
  if (!candidate.startsWith(PUBLIC_DIR)) return json(res, 403, { error: "Forbidden." });
  let filePath = candidate;
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) filePath = path.join(PUBLIC_DIR, "index.html");
  const contentType = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  applyHeaders(res, contentType);
  res.statusCode = 200;
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
    else if (req.method === "GET" || req.method === "HEAD") serveStatic(res, url.pathname);
    else json(res, 405, { error: "Method not allowed." });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) json(res, 500, { error: error.message === "Request too large." ? error.message : "Unexpected server error." });
    else res.end();
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of sessions) if (entry.expiresAt < now) sessions.delete(token);
}, 30 * 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`QAGarden is running at http://localhost:${PORT}`);
});
