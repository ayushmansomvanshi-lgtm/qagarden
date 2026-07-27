"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "qagarden.json");
const DB_KEY = `${process.env.QAGARDEN_NAMESPACE || "qagarden"}:database`;
const SESSION_PREFIX = `${process.env.QAGARDEN_NAMESPACE || "qagarden"}:session:`;
const RATE_PREFIX = `${process.env.QAGARDEN_NAMESPACE || "qagarden"}:rate:`;

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
const USE_REDIS = Boolean(REDIS_URL && REDIS_TOKEN);
const IS_VERCEL = Boolean(process.env.VERCEL);

const localSessions = new Map();
const localRates = new Map();

function defaultDb() {
  return { version: 3, manager: null, testers: [], projects: [] };
}

function normaliseDb(parsed) {
  return {
    ...defaultDb(),
    ...(parsed && typeof parsed === "object" ? parsed : {}),
    testers: Array.isArray(parsed?.testers) ? parsed.testers : [],
    projects: Array.isArray(parsed?.projects) ? parsed.projects : []
  };
}

function storageNotConfigured() {
  const error = new Error(
    "Persistent storage is not configured. Connect an Upstash Redis database to this Vercel project, then redeploy."
  );
  error.code = "STORAGE_NOT_CONFIGURED";
  return error;
}

async function redisCommand(command) {
  if (!USE_REDIS) throw storageNotConfigured();
  const response = await fetch(REDIS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Storage returned an invalid response (${response.status}).`);
  }

  if (!response.ok || payload.error) {
    const error = new Error(payload.error || `Storage request failed (${response.status}).`);
    error.code = "STORAGE_ERROR";
    throw error;
  }
  return payload.result;
}

async function readDb() {
  if (USE_REDIS) {
    const raw = await redisCommand(["GET", DB_KEY]);
    if (!raw) return defaultDb();
    try {
      return normaliseDb(JSON.parse(raw));
    } catch {
      throw new Error("The cloud database contains invalid QAGarden data.");
    }
  }

  if (IS_VERCEL) throw storageNotConfigured();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) return defaultDb();
  try {
    return normaliseDb(JSON.parse(fs.readFileSync(DB_FILE, "utf8")));
  } catch (error) {
    console.error("Could not read local database:", error);
    return defaultDb();
  }
}

async function writeDb(db) {
  const serialised = JSON.stringify(normaliseDb(db));
  if (USE_REDIS) {
    await redisCommand(["SET", DB_KEY, serialised]);
    return;
  }

  if (IS_VERCEL) throw storageNotConfigured();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(normaliseDb(db), null, 2), "utf8");
  fs.renameSync(tmp, DB_FILE);
}

async function getSession(token) {
  if (!token) return null;
  if (USE_REDIS) {
    const raw = await redisCommand(["GET", `${SESSION_PREFIX}${token}`]);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  if (IS_VERCEL) throw storageNotConfigured();
  const value = localSessions.get(token);
  if (!value || value.expiresAt < Date.now()) {
    localSessions.delete(token);
    return null;
  }
  return value;
}

async function setSession(token, value, ttlSeconds) {
  if (USE_REDIS) {
    await redisCommand(["SET", `${SESSION_PREFIX}${token}`, JSON.stringify(value), "EX", ttlSeconds]);
    return;
  }

  if (IS_VERCEL) throw storageNotConfigured();
  localSessions.set(token, value);
}

async function refreshSession(token, ttlSeconds) {
  if (!token) return;
  if (USE_REDIS) {
    await redisCommand(["EXPIRE", `${SESSION_PREFIX}${token}`, ttlSeconds]);
    return;
  }

  const value = localSessions.get(token);
  if (value) value.expiresAt = Date.now() + ttlSeconds * 1000;
}

async function deleteSession(token) {
  if (!token) return;
  if (USE_REDIS) {
    await redisCommand(["DEL", `${SESSION_PREFIX}${token}`]);
    return;
  }

  if (IS_VERCEL) throw storageNotConfigured();
  localSessions.delete(token);
}

async function rateLimit(identifier, maxAttempts, windowSeconds) {
  const safeIdentifier = String(identifier || "unknown").replace(/[^a-zA-Z0-9:._-]/g, "_").slice(0, 180);
  if (USE_REDIS) {
    const key = `${RATE_PREFIX}${safeIdentifier}`;
    const count = Number(await redisCommand(["INCR", key]));
    if (count === 1) await redisCommand(["EXPIRE", key, windowSeconds]);
    return count <= maxAttempts;
  }

  if (IS_VERCEL) throw storageNotConfigured();
  const now = Date.now();
  let record = localRates.get(safeIdentifier);
  if (!record || record.resetAt <= now) record = { count: 0, resetAt: now + windowSeconds * 1000 };
  record.count += 1;
  localRates.set(safeIdentifier, record);
  return record.count <= maxAttempts;
}

function mode() {
  if (USE_REDIS) return "upstash-redis";
  if (IS_VERCEL) return "unconfigured";
  return "local-file";
}

module.exports = {
  defaultDb,
  readDb,
  writeDb,
  getSession,
  setSession,
  refreshSession,
  deleteSession,
  rateLimit,
  mode
};
