import Redis from "ioredis";

// Toggle extra logging with: kubectl -n record-platform set env deploy/records-service DEBUG_CACHE=1
const DBG = process.env.DEBUG_CACHE === "1";
const MAX_BYTES = Number(process.env.CACHE_MAX_BYTES ?? 524_288);

function jitter(ms: number) {
  const low = ms * 0.9;
  const high = ms * 1.1;
  return Math.round(low + Math.random() * (high - low));
}

/** Normalize query-ish strings: NFKD, strip combining marks, lowercase, trim, coalesce spaces. */
export function normalizeQ(input: string): string {
  return String(input || "")
    .normalize("NFKD")
    // strip all Unicode combining marks (category M)
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function makeRedis(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  const client = new Redis(url, {
    enableAutoPipelining: true,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
  });

  client.on("error", (e) => console.error("[redis]", e.message));
  // best-effort connect; errors are logged via 'error' event
  client.connect().catch(() => {});
  return client;
}

/** BigInt-safe JSON stringify: bigint -> number (if safe) else string. */
function stringifySafe(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (typeof v !== "bigint") return v;
    const abs = v < 0n ? -v : v;
    // Number.MAX_SAFE_INTEGER = 9007199254740991
    return abs <= 9007199254740991n ? Number(v) : v.toString();
  });
}

export async function cached<T>(
  r: Redis | null,
  key: string,
  ttlMs: number,
  compute: () => Promise<T>
): Promise<T> {
  if (!r || ttlMs <= 0) {
    if (DBG) console.log("[cache] bypass (redis/ttl)", { key, ttlMs });
    return compute();
  }

  // GET
  try {
    const hit = await r.get(key);
    if (hit != null) {
      if (DBG) console.log("[cache] HIT", key);
      return JSON.parse(hit) as T;
    }
  } catch (e: any) {
    console.error("[redis get]", e?.message ?? e);
  }

  // MISS -> compute
  const val = await compute();

  // SET (best effort; never fail request on cache error)
  try {
    const json = stringifySafe(val);
    const bytes = Buffer.byteLength(json);
    if (bytes <= MAX_BYTES) {
      const ttl = jitter(ttlMs);
      await r.set(key, json, "PX", ttl);
      if (DBG) console.log("[cache] SET", key, "ttlMs", ttl, "bytes", bytes);
    } else {
      if (DBG) console.log("[cache] SKIP(set too big)", key, "bytes", bytes);
    }
  } catch (e: any) {
    console.error("[redis set]", e?.message ?? e);
  }

  return val;
}

/** Stable key joiner */
export function ckey(parts: Array<string | number | boolean | null | undefined>) {
  return parts.map((p) => (p == null ? "" : String(p))).join(":");
}

/** Build the canonical search cache key. */
export function makeSearchKey(
  userId: string,
  q: string,
  fuzzy: boolean,
  limit: number,
  offset: number
): string {
  return ckey(["records", "search", userId, normalizeQ(q), Number(fuzzy), limit, offset]);
}

/**
 * Invalidate user cache (search, autocomplete, facets, price stats).
 * Returns number of deleted keys.
 */
export async function invalidateSearchKeysForUser(
  r: Redis | null,
  userId: string
): Promise<number> {
  if (!r) return 0;

  const patterns = [
    `records:search:${userId}:*`,
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
          // Prefer UNLINK (non-blocking); fall back to DEL
          try {
            // @ts-ignore (older types might not have unlink)
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
