import fs from 'node:fs'
import path from 'node:path'

export type ContractAuthCache = {
  tokens: Record<string, string>
  stats: {
    loginAttempts: number
    registerAttempts: number
    cacheHits: number
    rateLimited429: number
  }
}

const CACHE_PATH = path.join(__dirname, '..', '.contract-auth-cache.json')

export function readContractAuthCache(): ContractAuthCache | null {
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf8')
    return JSON.parse(raw) as ContractAuthCache
  } catch {
    return null
  }
}

export function writeContractAuthCache(cache: ContractAuthCache): void {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true })
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2))
}

export function mergeAuthStats(
  partial: Partial<ContractAuthCache['stats']>,
): void {
  const existing = readContractAuthCache()
  const stats = {
    loginAttempts: 0,
    registerAttempts: 0,
    cacheHits: 0,
    rateLimited429: 0,
    ...existing?.stats,
    ...partial,
  }
  writeContractAuthCache({
    tokens: existing?.tokens ?? {},
    stats,
  })
}
