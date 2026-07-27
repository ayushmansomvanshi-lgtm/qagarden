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

const REDIS_ENV_PAIRS = [
  ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
  ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
  ["VERCEL_KV_REST_API_URL", "VERCEL_KV_REST_API_TOKEN"],
  ["REDIS_REST_URL", "REDIS_REST_TOKEN"]
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

function getRedisConfigs() {
  const configs = [];
  const seen = new Set();

  for (const [urlVariable, tokenVariable] of REDIS_ENV_PAIRS) {
    const url = cleanEnvValue(process.env[urlVariable]).replace(/\/+$/, "");
    const token = cleanEnvValue(process.env[tokenVariable]);
    if (!url || !token) continue;
    const fingerprint = `${url}\n${token}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    configs.push({ url, token, urlVariable, tokenVariable });
  }

  return configs;
}

function defaultDb() {
  return { version: 4, manager: null, testers: [], projects: [] };
}

function normaliseDb(parsed) {
  return {
    ...defaultDb(),
    ...(parsed && typeof parsed === "object" ? parsed : {}),
    testers: Array.isArray(parsed?.testers) ? parsed.testers : [],
    projects: Array.isArray(parsed?.projects) ? parsed.projects : []
  };
}

function timestamp(record) {
  const value = Date.parse(record?.updatedAt || record?.createdAt || "");
  return Number.isFinite(value) ? value : 0;
}

function databaseScore(db) {
  return (db.manager ? 1000000 : 0) + db.testers.length * 1000 + db.projects.length * 10 + timestamp(db.manager);
}

function mergeRecords(databases, field, keyFor) {
  const records = new Map();
  for (const db of databases) {
    for (const item of db[field] || []) {
      const key = keyFor(item);
      if (!key) continue;
      const existing = records.get(key);
      if (!existing || timestamp(item) >= timestamp(existing)) records.set(key, item);
    }
  }
  return Array.from(records.values());
}

function mergeDatabases(databases) {
  if (!databases.length) return defaultDb();
  const ordered = [...databases].sort((a, b) => databaseScore(b) - databaseScore(a));
  const manager = ordered.map((db) => db.manager).filter(Boolean).sort((a, b) => timestamp(b) - timestamp(a))[0] || null;
  return normaliseDb({
    version: Math.max(4, ...ordered.map((db) => Number(db.version || 0))),
    manager,
    testers: mergeRecords(ordered, "testers", (item) => String(item.email || item.id || "").trim().toLowerCase()),
    projects: mergeRecords(ordered, "projects", (item) => String(item.id || ""))
  });
}

function storageNotConfigured() {
  const diagnostics = getDiagnostics();
  const error = new Error(
    "Persistent storage is unavailable in this deployment. Connect Vercel KV or Upstash Redis to this exact project and redeploy the latest commit."
  );
  error.code = "STORAGE_NOT_CONFIGURED";
  error.diagnostics = diagnostics;
  return error;
}

async function redisCommandFor(config, command) {
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
    const error = new Error(`Could not connect through ${config.urlVariable}.`);
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

async function runAcrossStores(command, { requireOne = true } = {}) {
  const configs = getRedisConfigs();
  if (!configs.length) throw storageNotConfigured();
  const results = await Promise.allSettled(configs.map((config) => redisCommandFor(config, command)));
  const fulfilled = results
    .map((result, index) => ({ result, config: configs[index] }))
    .filter(({ result }) => result.status === "fulfilled");
  if (requireOne && !fulfilled.length) {
    const firstError = results.find((result) => result.status === "rejected");
    throw firstError?.reason || Object.assign(new Error("Cloud storage is unavailable."), { code: "STORAGE_ERROR" });
  }
  return { configs, results, fulfilled };
}

async function testConnection() {
  const configs = getRedisConfigs();
  if (!configs.length) {
    return {
      ok: false,
      storage: IS_VERCEL ? "unconfigured" : "local-file",
      ...getDiagnostics()
    };
  }

  const outcomes = await Promise.allSettled(configs.map(async (config) => ({
    variable: config.urlVariable,
    result: await redisCommandFor(config, ["PING"])
  })));
  const stores = outcomes.map((outcome, index) => ({
    urlVariable: configs[index].urlVariable,
    tokenVariable: configs[index].tokenVariable,
    ok: outcome.status === "fulfilled" && ["PONG", "OK", true].includes(outcome.value.result),
    result: outcome.status === "fulfilled" ? String(outcome.value.result || "") : "",
    error: outcome.status === "rejected" ? outcome.reason.message : undefined
  }));
  return {
    ok: stores.some((store) => store.ok),
    storage: "upstash-redis",
    stores,
    ...getDiagnostics()
  };
}

async function readCloudDatabases() {
  const configs = getRedisConfigs();
  if (!configs.length) throw storageNotConfigured();
  const results = await Promise.allSettled(configs.map(async (config) => ({
    config,
    raw: await redisCommandFor(config, ["GET", DB_KEY])
  })));
  const readable = [];
  let firstError = null;
  for (const result of results) {
    if (result.status === "rejected") {
      firstError ||= result.reason;
      continue;
    }
    if (!result.value.raw) {
      readable.push({ config: result.value.config, db: defaultDb(), raw: "" });
      continue;
    }
    try {
      readable.push({ config: result.value.config, db: normaliseDb(JSON.parse(result.value.raw)), raw: result.value.raw });
    } catch {
      // Ignore one damaged/legacy store if another configured store is healthy.
    }
  }
  if (!readable.length) throw firstError || Object.assign(new Error("The cloud database could not be read."), { code: "STORAGE_ERROR" });
  return readable;
}

async function readDb() {
  const configs = getRedisConfigs();
  if (configs.length) {
    const readable = await readCloudDatabases();
    const merged = mergeDatabases(readable.map((entry) => entry.db));
    const serialised = JSON.stringify(merged);

    // Best-effort self-healing: old deployments may have written data to the
    // UPSTASH_* pair while a newer deployment reads KV_* first. Keep every
    // configured alias/database synchronized so manager and tester logins see
    // the same accounts on every Vercel deployment URL.
    const needsRepair = readable.some((entry) => entry.raw !== serialised);
    if (needsRepair) {
      await Promise.allSettled(configs.map((config) => redisCommandFor(config, ["SET", DB_KEY, serialised])));
    }
    return merged;
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
  const configs = getRedisConfigs();
  if (configs.length) {
    const { fulfilled } = await runAcrossStores(["SET", DB_KEY, serialised]);
    if (!fulfilled.length) throw Object.assign(new Error("The cloud database could not be updated."), { code: "STORAGE_ERROR" });
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
  const configs = getRedisConfigs();
  if (configs.length) {
    const results = await Promise.allSettled(configs.map((config) => redisCommandFor(config, ["GET", `${SESSION_PREFIX}${token}`])));
    for (const result of results) {
      if (result.status !== "fulfilled" || !result.value) continue;
      try { return JSON.parse(result.value); } catch { /* try next store */ }
    }
    return null;
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
  const configs = getRedisConfigs();
  if (configs.length) {
    await runAcrossStores(["SET", `${SESSION_PREFIX}${token}`, JSON.stringify(value), "EX", ttlSeconds]);
    return;
  }
  if (IS_VERCEL) throw storageNotConfigured();
  localSessions.set(token, { ...value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

async function refreshSession(token, ttlSeconds) {
  if (!token) return;
  const configs = getRedisConfigs();
  if (configs.length) {
    await runAcrossStores(["EXPIRE", `${SESSION_PREFIX}${token}`, ttlSeconds], { requireOne: false });
    return;
  }
  if (IS_VERCEL) throw storageNotConfigured();
  const value = localSessions.get(token);
  if (value) value.expiresAt = Date.now() + ttlSeconds * 1000;
}

async function deleteSession(token) {
  if (!token) return;
  const configs = getRedisConfigs();
  if (configs.length) {
    await runAcrossStores(["DEL", `${SESSION_PREFIX}${token}`], { requireOne: false });
    return;
  }
  if (IS_VERCEL) throw storageNotConfigured();
  localSessions.delete(token);
}

async function rateLimit(identifier, maxAttempts, windowSeconds) {
  const safeIdentifier = String(identifier || "unknown")
    .replace(/[^a-zA-Z0-9:._-]/g, "_")
    .slice(0, 180);
  const configs = getRedisConfigs();
  if (configs.length) {
    const key = `${RATE_PREFIX}${safeIdentifier}`;
    const config = configs[0];
    const count = Number(await redisCommandFor(config, ["INCR", key]));
    if (count === 1) await redisCommandFor(config, ["EXPIRE", key, windowSeconds]);
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
  if (getRedisConfigs().length) return "upstash-redis";
  if (IS_VERCEL) return "unconfigured";
  return "local-file";
}

function getDiagnostics() {
  const configs = getRedisConfigs();
  return {
    configured: configs.length > 0,
    configuredStoreCount: configs.length,
    isVercel: IS_VERCEL,
    stores: configs.map(({ urlVariable, tokenVariable }) => ({ urlVariable, tokenVariable })),
    detected: Object.fromEntries(
      REDIS_ENV_PAIRS.flat().concat(["REDIS_URL"]).map((name) => [name, Boolean(cleanEnvValue(process.env[name]))])
    )
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
