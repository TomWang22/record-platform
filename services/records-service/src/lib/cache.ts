// src/lib/cache.ts
import Redis from "ioredis";
import { readFileSync } from "fs";
import { join } from "path";
import crypto from "crypto";
import { Client as PgClient, Notification } from "pg";

// Toggle extra logging with: kubectl -n record-platform set env deploy/records-service DEBUG_CACHE=1
const DBG = process.env.DEBUG_CACHE === "1";
const MAX_BYTES = Number(process.env.CACHE_MAX_BYTES ?? 524_288);
const SF_STALE_MS = Number(process.env.CACHE_SINGLEFLIGHT_STALE_MS ?? 2000);
const SF_SLEEP_MS = Number(process.env.CACHE_SINGLEFLIGHT_SLEEP_MS ?? 75);
const DOC_TTL_MS_DEFAULT = Number(process.env.CACHE_DOC_TTL_MS ?? 120_000);

// ---------- singleflight script (your file) ----------
const SINGLEFLIGHT_SCRIPT = readFileSync(
  join(__dirname, "singleflight_cache.lua"),
  "utf8"
);
let singleflightSha: string | undefined;

async function ensureSingleflightScript(r: Redis): Promise<string> {
  if (singleflightSha) return singleflightSha;
  const sha = (await (r as any).script("LOAD", SINGLEFLIGHT_SCRIPT)) as string;
  singleflightSha = sha;
  return sha;
}

// ---------- helpers ----------
const sha1 = (s: string) => crypto.createHash("sha1").update(s).digest("hex");

function jitter(ms: number) {
  const low = ms * 0.9;
  const high = ms * 1.1;
  return Math.round(low + Math.random() * (high - low));
}

/** Normalize query-ish strings: NFKD, strip combining marks, lowercase, trim, coalesce spaces. */
export function normalizeQ(input: string): string {
  return String(input || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

// ---------- Redis factory ----------
export function makeRedis(): Redis | null {
  const url = process.env.REDIS_URL || "";
  const password = process.env.REDIS_PASSWORD || undefined;
  const useTLS = !!process.env.REDIS_TLS;

  const common = {
    password,
    enableAutoPipelining: true,
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    keepAlive: 10_000,
    autoResubscribe: false,
  } as const;

  const client = url
    ? new Redis(url, { ...common, tls: useTLS ? {} : undefined })
    : new Redis({
        host: process.env.REDIS_HOST || "redis",
        port: Number(process.env.REDIS_PORT || 6379),
        ...common,
      });

  client.on("error", (e) => console.error("[redis]", e.message));
  client.connect().catch(() => {}); // best-effort
  return client;
}

/** BigInt-safe JSON stringify: bigint -> number (if safe) else string. */
function stringifySafe(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (typeof v !== "bigint") return v;
    const abs = v < 0n ? -v : v;
    return abs <= 9007199254740991n ? Number(v) : v.toString();
  });
}

// ---------- cached() with singleflight + ioredis-typed commands ----------
export async function cached<T>(
  r: Redis | null,
  key: string,
  ttlMs: number,
  compute: () => Promise<T>
): Promise<T> {
  if (!r || ttlMs <= 0) return compute();

  const lockKey = `sf:lock:${key}`;
  const ttlSec = Math.ceil(ttlMs / 1000);
  let state: string | null = null;
  let payload: string | null = null;

  try {
    const sha = await ensureSingleflightScript(r);
    const res = (await r.evalsha(
      sha,
      2,
      key,
      lockKey,
      String(ttlSec),
      String(Date.now()),
      String(SF_STALE_MS)
    )) as unknown as [string, string];
    state = res?.[0] ?? null;
    payload = res?.[1] ?? null;
  } catch (err: any) {
    if (err?.message?.includes("NOSCRIPT")) {
      singleflightSha = undefined;
    } else {
      console.error("[cache singleflight]", err);
    }
  }

  if (state === "hit" && payload) {
    if (DBG) console.log("[cache] HIT", key);
    return JSON.parse(payload) as T;
  }

  try {
    const hit = await r.get(key);
    if (hit != null) {
      if (DBG) console.log("[cache] HIT", key);
      return JSON.parse(hit) as T;
    }
  } catch (e: any) {
    console.error("[redis get]", e?.message ?? e);
  }

  const hadLock = state === "miss-locked";
  let haveLock = hadLock;

  if (!hadLock && state === "miss-wait") {
    // SETNX + PEXPIRE instead of SET {NX,PX} to satisfy typings
    const got = (await r.setnx(lockKey, "1")) === 1;
    if (got) {
      await r.pexpire(lockKey, 10_000);
      haveLock = true;
    } else {
      if (DBG) console.log("[cache] miss-wait", key);
      await new Promise((resolve) => setTimeout(resolve, SF_SLEEP_MS));
      const again = await r.get(key);
      if (again) return JSON.parse(again) as T;
    }
  }

  const val = await compute();

  try {
    const json = stringifySafe(val);
    const bytes = Buffer.byteLength(json);
    if (bytes <= MAX_BYTES) {
      const ttl = Math.max(1_000, jitter(ttlMs));
      if (haveLock) {
        await r.multi().psetex(key, ttl, json).del(lockKey).exec();
      } else {
        await r.psetex(key, ttl, json);
      }
      if (DBG) console.log("[cache] SET", key, "ttlMs", ttl, "bytes", bytes);
    } else if (DBG) {
      console.log("[cache] SKIP(set too big)", key, "bytes", bytes);
    }
  } catch (e: any) {
    console.error("[redis set]", e?.message ?? e);
  }

  return val;
}

// ---------- key builders & invalidation ----------
export function ckey(parts: Array<string | number | boolean | null | undefined>) {
  return parts.map((p) => (p == null ? "" : String(p))).join(":");
}

export function makeSearchKey(
  userId: string,
  q: string,
  fuzzy: boolean,
  limit: number,
  offset: number
): string {
  return ckey(["records", "search", userId, normalizeQ(q), Number(fuzzy), limit, offset]);
}

export const verKey = (userId: string) => `rec:ver:u:${userId}`;
export const idKey = (
  ver: string | number,
  userId: string,
  qNorm: string,
  limit: number,
  offset: number,
  fuzzy: boolean
) =>
  `rec:search:v${ver}:u:${userId}:f:${fuzzy ? 1 : 0}:l:${limit}:o:${offset}:q:${sha1(
    qNorm
  )}`;

/** Per-record doc key; cache is user-agnostic so we can reuse across queries. */
export const docKey = (id: string) => `rec:doc:${id}`;

/** Invalidate user cache (search, autocomplete, facets, price stats). */
export async function invalidateSearchKeysForUser(
  r: Redis | null,
  userId: string
): Promise<number> {
  if (!r) return 0;

  const patterns = [
    `records:search:${userId}*`, // keep broad for both old/new shapes
    `records:ac:${userId}:*`,
    `records:facets:${userId}:*`,
    `records:pricestats:${userId}:*`,
  ];

  let total = 0;
  for (const pattern of patterns) {
    let cursor = "0";
    try {
      do {
        const res = await r.scan(cursor, "MATCH", pattern, "COUNT", 400);
        cursor = res[0];
        const keys: string[] = res[1] ?? [];
        if (keys.length) {
          try {
            // @ts-ignore (older types might not have unlink declared)
            const n = await (r.unlink?.(...keys) ?? r.del(...keys));
            total += Number(n) || 0;
          } catch {
            const n = await r.del(...keys);
            total += Number(n) || 0;
          }
        }
      } while (cursor !== "0");
      if (DBG) console.log("[cache] INVALIDATE", pattern);
    } catch (e: any) {
      console.error("[redis invalidate]", pattern, e?.message ?? e);
    }
  }
  if (DBG) console.log("[cache] INVALIDATE total", total);
  return total;
}

// ---------- PG LISTEN/NOTIFY -> bump per-user version ----------
export async function attachPgInvalidationListener(
  pg: PgClient,
  redis: Redis | null
): Promise<void> {
  try {
    await pg.query("LISTEN records_invalidate");
    pg.on("notification", async (msg: Notification) => {
      const userId = msg.payload || "";
      if (!userId) return;
      try {
        if (redis) await redis.incr(verKey(userId));
        if (DBG) console.log("[cache] bump ver for", userId);
      } catch (e: any) {
        console.error("[cache bump ver]", e?.message ?? e);
      }
    });
    if (DBG) console.log("[cache] listening on records_invalidate");
  } catch (e: any) {
    console.error("[cache] LISTEN failed", e?.message ?? e);
  }
}

// ---------- docs cache: single-roundtrip read, pipelined fill ----------
/**
 * Fetch docs by ordered IDs using Redis MGET, backfill misses via `fetchMissing`,
 * set each doc with PEXPIRE (jittered), and return results in the same order.
 */
export async function getDocsByIds<T>(
  r: Redis | null,
  ids: string[],
  ttlMs: number = DOC_TTL_MS_DEFAULT,
  fetchMissing: (missingIds: string[]) => Promise<Record<string, T>>
): Promise<(T | null)[]> {
  if (!ids.length) return [];
  if (!r) {
    const data = await fetchMissing([...new Set(ids)]);
    return ids.map((id) => data[id] ?? null);
  }

  // 1) single roundtrip read
  const keys = ids.map(docKey);
  let rows: Array<string | null> = [];
  try {
    rows = (await r.mget(...keys)) as Array<string | null>;
  } catch (e: any) {
    console.error("[redis mget]", e?.message ?? e);
    rows = Array(ids.length).fill(null);
  }

  // 2) parse + detect misses (dedup for DB)
  const out: (T | null)[] = new Array(ids.length).fill(null);
  const missingSet = new Set<string>();
  for (let i = 0; i < ids.length; i++) {
    const s = rows[i];
    if (s != null) {
      try {
        out[i] = JSON.parse(s) as T;
      } catch {
        missingSet.add(ids[i]);
      }
    } else {
      missingSet.add(ids[i]);
    }
  }

  if (missingSet.size === 0) return out;

  // 3) fetch misses from source
  const missing = [...missingSet];
  let fetched: Record<string, T> = {};
  try {
    fetched = await fetchMissing(missing);
  } catch (e: any) {
    console.error("[docs fetchMissing]", e?.message ?? e);
  }

  // 4) write-back to Redis (pipeline)
  try {
    const pipe = r.pipeline();
    for (const id of missing) {
      const v = fetched[id];
      if (v == null) continue;
      const json = stringifySafe(v);
      if (Buffer.byteLength(json) > MAX_BYTES) continue;
      pipe.psetex(docKey(id), Math.max(1_000, jitter(ttlMs)), json);
    }
    await pipe.exec();
  } catch (e: any) {
    console.error("[redis pipeline set docs]", e?.message ?? e);
  }

  // 5) fill results
  for (let i = 0; i < ids.length; i++) {
    if (out[i] == null) out[i] = fetched[ids[i]] ?? null;
  }

  return out;
}
