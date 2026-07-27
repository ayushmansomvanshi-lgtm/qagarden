"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "qagarden.json");
const NAMESPACE = process.env.QAGARDEN_NAMESPACE || "qagarden";
const DB_KEY = `${NAMESPACE}:database`;
const SESSION_PREFIX = `${NAMESPACE}:session:`;
const RATE_PREFIX = `${NAMESPACE}:rate:`;
const IS_VERCEL = Boolean(process.env.VERCEL);

const localSessions = new Map();
const localRates = new Map();

const URL_VARIABLES = [
  "KV_REST_API_URL",
  "UPSTASH_REDIS_REST_URL",
  "VERCEL_KV_REST_API_URL",
  "REDIS_REST_URL"
];

const TOKEN_VARIABLES = [
  "KV_REST_API_TOKEN",
  "UPSTASH_REDIS_REST_TOKEN",
  "VERCEL_KV_REST_API_TOKEN",
  "REDIS_REST_TOKEN"
];

function cleanEnvValue(value) {
  let result = String(value || "").trim();
  if (
    result.length >= 2 &&
    ((result.startsWith('"') && result.endsWith('"')) ||
      (result.startsWith("'") && result.endsWith("'")))
  ) {
    result = result.slice(1, -1).trim();
  }
  return result;
}

function firstEnvironmentValue(names) {
  for (const name of names) {
    const value = cleanEnvValue(process.env[name]);
    if (value) return { name, value };
  }
  return { name: null, value: "" };
}

function getRedisConfig() {
  const urlEntry = firstEnvironmentValue(URL_VARIABLES);
  const tokenEntry = firstEnvironmentValue(TOKEN_VARIABLES);
  const url = urlEntry.value.replace(/\/+$/, "");
  return {
    configured: Boolean(url && tokenEntry.value),
    url,
    token: tokenEntry.value,
    urlVariable: urlEntry.name,
    tokenVariable: tokenEntry.name
  };
}

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
  const diagnostics = getDiagnostics();
  const error = new Error(
    "Persistent storage is unavailable in this deployment. QAGarden supports Vercel KV variables (KV_REST_API_URL and KV_REST_API_TOKEN) and Upstash variables (UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN). Connect the database to this exact Vercel project and redeploy the latest commit."
  );
  error.code = "STORAGE_NOT_CONFIGURED";
  error.diagnostics = diagnostics;
  return error;
}

async function redisCommand(command) {
  const config = getRedisConfig();
  if (!config.configured) throw storageNotConfigured();

  let response;
  try {
    response = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(8000)
    });
  } catch (cause) {
    const error = new Error("Could not connect to the configured Redis REST endpoint.");
    error.code = "STORAGE_ERROR";
    error.cause = cause;
    throw error;
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    const error = new Error(`Storage returned an invalid response (${response.status}).`);
    error.code = "STORAGE_ERROR";
    throw error;
  }

  if (!response.ok || payload.error) {
    const error = new Error(payload.error || `Storage request failed (${response.status}).`);
    error.code = "STORAGE_ERROR";
    throw error;
  }

  return payload.result;
}

async function testConnection() {
  const config = getRedisConfig();
  if (!config.configured) {
    return {
      ok: false,
      storage: IS_VERCEL ? "unconfigured" : "local-file",
      ...getDiagnostics()
    };
  }

  try {
    const result = await redisCommand(["PING"]);
    return {
      ok: result === "PONG" || result === true || result === "OK",
      storage: "upstash-redis",
      result: String(result || ""),
      ...getDiagnostics()
    };
  } catch (error) {
    return {
      ok: false,
      storage: "upstash-redis",
      error: error.message,
      ...getDiagnostics()
    };
  }
}

async function readDb() {
  const config = getRedisConfig();
  if (config.configured) {
    const raw = await redisCommand(["GET", DB_KEY]);
    if (!raw) return defaultDb();
    try {
      return normaliseDb(JSON.parse(raw));
    } catch {
      const error = new Error("The cloud database contains invalid QAGarden data.");
      error.code = "STORAGE_ERROR";
      throw error;
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
  if (getRedisConfig().configured) {
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
  if (getRedisConfig().configured) {
    const raw = await redisCommand(["GET", `${SESSION_PREFIX}${token}`]);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
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
  if (getRedisConfig().configured) {
    await redisCommand(["SET", `${SESSION_PREFIX}${token}`, JSON.stringify(value), "EX", ttlSeconds]);
    return;
  }

  if (IS_VERCEL) throw storageNotConfigured();
  localSessions.set(token, {
    ...value,
    expiresAt: Date.now() + ttlSeconds * 1000
  });
}

async function refreshSession(token, ttlSeconds) {
  if (!token) return;
  if (getRedisConfig().configured) {
    await redisCommand(["EXPIRE", `${SESSION_PREFIX}${token}`, ttlSeconds]);
    return;
  }

  if (IS_VERCEL) throw storageNotConfigured();
  const value = localSessions.get(token);
  if (value) value.expiresAt = Date.now() + ttlSeconds * 1000;
}

async function deleteSession(token) {
  if (!token) return;
  if (getRedisConfig().configured) {
    await redisCommand(["DEL", `${SESSION_PREFIX}${token}`]);
    return;
  }

  if (IS_VERCEL) throw storageNotConfigured();
  localSessions.delete(token);
}

async function rateLimit(identifier, maxAttempts, windowSeconds) {
  const safeIdentifier = String(identifier || "unknown")
    .replace(/[^a-zA-Z0-9:._-]/g, "_")
    .slice(0, 180);

  if (getRedisConfig().configured) {
    const key = `${RATE_PREFIX}${safeIdentifier}`;
    const count = Number(await redisCommand(["INCR", key]));
    if (count === 1) await redisCommand(["EXPIRE", key, windowSeconds]);
    return count <= maxAttempts;
  }

  if (IS_VERCEL) throw storageNotConfigured();
  const now = Date.now();
  let record = localRates.get(safeIdentifier);
  if (!record || record.resetAt <= now) {
    record = { count: 0, resetAt: now + windowSeconds * 1000 };
  }
  record.count += 1;
  localRates.set(safeIdentifier, record);
  return record.count <= maxAttempts;
}

function mode() {
  if (getRedisConfig().configured) return "upstash-redis";
  if (IS_VERCEL) return "unconfigured";
  return "local-file";
}

function getDiagnostics() {
  const config = getRedisConfig();
  return {
    configured: config.configured,
    isVercel: IS_VERCEL,
    urlVariable: config.urlVariable,
    tokenVariable: config.tokenVariable,
    detected: {
      KV_REST_API_URL: Boolean(cleanEnvValue(process.env.KV_REST_API_URL)),
      KV_REST_API_TOKEN: Boolean(cleanEnvValue(process.env.KV_REST_API_TOKEN)),
      UPSTASH_REDIS_REST_URL: Boolean(cleanEnvValue(process.env.UPSTASH_REDIS_REST_URL)),
      UPSTASH_REDIS_REST_TOKEN: Boolean(cleanEnvValue(process.env.UPSTASH_REDIS_REST_TOKEN)),
      VERCEL_KV_REST_API_URL: Boolean(cleanEnvValue(process.env.VERCEL_KV_REST_API_URL)),
      VERCEL_KV_REST_API_TOKEN: Boolean(cleanEnvValue(process.env.VERCEL_KV_REST_API_TOKEN)),
      REDIS_REST_URL: Boolean(cleanEnvValue(process.env.REDIS_REST_URL)),
      REDIS_REST_TOKEN: Boolean(cleanEnvValue(process.env.REDIS_REST_TOKEN)),
      REDIS_URL: Boolean(cleanEnvValue(process.env.REDIS_URL))
    }
  };
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
  mode,
  testConnection,
  getDiagnostics
};
