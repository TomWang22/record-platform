/**
 * Deterministic album-sleeve fixtures for contract seeds.
 * Uses solid-color placeholder PNGs labelled with artist/title — never picsum/stock photos.
 * Local SVG sleeves also live under webapp/public/e2e-fixtures/covers/ for post-deploy serving.
 */

const SLEEVES = [
  { slug: 'kenny-dorham', label: 'Kenny+Dorham', bg: '1a2744', fg: 'c4a35a' },
  { slug: 'art-blakey', label: 'Art+Blakey', bg: '2c1810', fg: 'e8d5a3' },
  { slug: 'miles-davis', label: 'Miles+Davis', bg: '0d2137', fg: '7eb8da' },
  { slug: 'coltrane', label: 'John+Coltrane', bg: '1c3d5a', fg: 'f0e6d2' },
  { slug: 'monk', label: 'Thelonious+Monk', bg: '2a1f14', fg: 'd4a574' },
  { slug: 'evans', label: 'Bill+Evans', bg: '1f2a24', fg: 'a8c5b0' },
  { slug: 'mingus', label: 'Charles+Mingus', bg: '3a1515', fg: 'e0b080' },
  { slug: 'hancock', label: 'Herbie+Hancock', bg: '14243a', fg: '8ab4d4' },
  { slug: 'shorter', label: 'Wayne+Shorter', bg: '1a1520', fg: 'c9a0dc' },
  { slug: 'morgan', label: 'Lee+Morgan', bg: '2b1d12', fg: 'f2c14e' },
  { slug: 'silver', label: 'Horace+Silver', bg: '1e2f1e', fg: 'c5d4a0' },
  { slug: 'adderley', label: 'Cannonball+Adderley', bg: '241828', fg: 'e8b4b8' },
] as const

export const VINYL_COVER_FIXTURES = SLEEVES.map(
  (s) => `https://placehold.co/800x800/${s.bg}/${s.fg}/png?text=${s.label}`,
) as readonly string[]

export const COVER_KENNY = VINYL_COVER_FIXTURES[0]
export const COVER_BLAKEY = VINYL_COVER_FIXTURES[1]
export const COVER_MILES = VINYL_COVER_FIXTURES[2]

export function vinylCoverForIndex(index: number): string {
  return VINYL_COVER_FIXTURES[Math.abs(index) % VINYL_COVER_FIXTURES.length]
}

export function vinylCoverAbsolute(index: number, origin = 'https://record-platform.test'): string {
  const slug = SLEEVES[Math.abs(index) % SLEEVES.length].slug
  return `${origin.replace(/\/$/, '')}/e2e-fixtures/covers/${slug}.svg`
}

export function isForbiddenStockMediaUrl(url: string | null | undefined): boolean {
  if (!url) return false
  const u = String(url).toLowerCase()
  return u.includes('picsum.photos') || u.includes('loremflickr') || u.includes('unsplash.com')
}
