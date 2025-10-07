import Redis from 'ioredis'
let _client: Redis | null = null
export function getRedis(): Redis {
  if (_client) return _client
  const url = process.env.REDIS_URL || 'redis://localhost:6379/0'
  _client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3 })
  return _client
}
