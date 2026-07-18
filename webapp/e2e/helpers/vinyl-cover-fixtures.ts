/**
 * Deterministic album-sleeve fixtures for contract seeds.
 * Local SVG covers under /public/e2e-fixtures/covers — never picsum/stock photos.
 */

export const VINYL_COVER_FIXTURES = [
  '/e2e-fixtures/covers/kenny-dorham.svg',
  '/e2e-fixtures/covers/art-blakey.svg',
  '/e2e-fixtures/covers/miles-davis.svg',
  '/e2e-fixtures/covers/coltrane.svg',
  '/e2e-fixtures/covers/monk.svg',
  '/e2e-fixtures/covers/evans.svg',
  '/e2e-fixtures/covers/mingus.svg',
  '/e2e-fixtures/covers/hancock.svg',
  '/e2e-fixtures/covers/shorter.svg',
  '/e2e-fixtures/covers/morgan.svg',
  '/e2e-fixtures/covers/silver.svg',
  '/e2e-fixtures/covers/adderley.svg',
] as const

export const COVER_KENNY = VINYL_COVER_FIXTURES[0]
export const COVER_BLAKEY = VINYL_COVER_FIXTURES[1]
export const COVER_MILES = VINYL_COVER_FIXTURES[2]

export function vinylCoverForIndex(index: number): string {
  return VINYL_COVER_FIXTURES[Math.abs(index) % VINYL_COVER_FIXTURES.length]
}

/** Absolute URL for API payloads that require a full origin. */
export function vinylCoverAbsolute(index: number, origin = 'https://localhost:3443'): string {
  const path = vinylCoverForIndex(index)
  return `${origin.replace(/\/$/, '')}${path}`
}

export function isForbiddenStockMediaUrl(url: string | null | undefined): boolean {
  if (!url) return false
  const u = String(url).toLowerCase()
  return u.includes('picsum.photos') || u.includes('loremflickr') || u.includes('unsplash.com')
}
