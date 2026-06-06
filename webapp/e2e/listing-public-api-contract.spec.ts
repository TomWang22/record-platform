import { test, expect } from '@playwright/test'

const HOUSING_KEYS = [
  'landlord_id',
  'landlord_display',
  'residence_type',
  'bedrooms',
  'bathrooms',
  'tenant',
  'price_usd_monthly',
]

function bodyHasForbiddenKey(obj: unknown, key: string): boolean {
  if (obj == null || typeof obj !== 'object') return false
  if (Array.isArray(obj)) return obj.some((x) => bodyHasForbiddenKey(x, key))
  const o = obj as Record<string, unknown>
  if (Object.prototype.hasOwnProperty.call(o, key)) return true
  return Object.values(o).some((v) => bodyHasForbiddenKey(v, key))
}

function bodyHasCentsKey(obj: unknown): string | null {
  if (obj == null || typeof obj !== 'object') return null
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const hit = bodyHasCentsKey(item)
      if (hit) return hit
    }
    return null
  }
  const o = obj as Record<string, unknown>
  for (const key of Object.keys(o)) {
    if (key === 'price_cents' || key.endsWith('_cents')) return key
    const nested = bodyHasCentsKey(o[key])
    if (nested) return `${key}.${nested}`
  }
  return null
}

test.describe('Public listing API contract (search/detail parity)', () => {
  test('search and detail share public fields; no cents or housing leaks', async ({ request }) => {
    const searchRes = await request.get('/api/listings/search?limit=1')
    expect(searchRes.ok(), await searchRes.text()).toBeTruthy()
    const searchBody = (await searchRes.json()) as { items?: Record<string, unknown>[] }
    const first = searchBody.items?.[0]
    expect(first?.id, JSON.stringify(searchBody)).toBeTruthy()
    const id = String(first!.id)

    const detailRes = await request.get(`/api/listings/${id}`)
    expect(detailRes.ok(), await detailRes.text()).toBeTruthy()
    const detail = (await detailRes.json()) as Record<string, unknown>

    expect(String(detail.id)).toBe(id)
    expect(detail.seller).toBeTruthy()
    expect(detail.seller).toBe(first!.seller)
    expect(detail.priceDisplay).toBe(first!.priceDisplay)
    expect(detail.format).toBe(first!.format)
    expect(detail.mediaCondition).toBe(first!.mediaCondition)
    expect(detail.price).toBe(first!.price)

    const searchImages = (first!.images as string[] | undefined) ?? []
    const detailImages = (detail.images as string[] | undefined) ?? []
    expect(detailImages.length).toBeGreaterThan(0)
    if (searchImages.length > 0) {
      expect(detailImages.length).toBeGreaterThanOrEqual(searchImages.length)
    }

    expect(bodyHasCentsKey(searchBody)).toBeNull()
    expect(bodyHasCentsKey(detail)).toBeNull()
    for (const key of HOUSING_KEYS) {
      expect(bodyHasForbiddenKey(searchBody, key)).toBeFalsy()
      expect(bodyHasForbiddenKey(detail, key)).toBeFalsy()
    }

    expect(detail.priceDisplay).toMatch(/^\$\d+\.\d{2}$/)
    expect(detail.listedAtDisplay).toBeTruthy()
    expect(detail.shipping).toBeTruthy()
  })
})
