import Redis from 'ioredis'

let client: Redis | null = null

/** Singleton Redis client. Why: avoid multiple TCP connections per worker. */
export function getRedis(): Redis {
  if (!client) {
    const url = process.env.REDIS_URL || 'redis://redis:6379/0'
    client = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 2 })
  }
  return client
}

/** Simple cache get/set with TTL seconds. */
export async function cache<T = unknown>(key: string, loader: () => Promise<T>, ttlSec = 60): Promise<T> {
  const r = getRedis()
  const hit = await r.get(key)
  if (hit) return JSON.parse(hit) as T
  const data = await loader()
  await r.set(key, JSON.stringify(data), 'EX', ttlSec)
  return data
}
