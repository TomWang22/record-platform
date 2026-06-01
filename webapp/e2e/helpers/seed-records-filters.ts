import type { APIRequestContext } from '@playwright/test'

import { with429Retry } from './http-retry'
import { createListingWithShipping } from './listing-contract'

const PLACEHOLDER = 'https://picsum.photos/seed/rp-record-filter/400/400'

/** Records with distinct purchased/received dates for toolbar filter E2E. */
export async function seedRecordsForToolbarFilters(
  request: APIRequestContext,
  token: string,
): Promise<{
  runTag: string
  earlyId: string
  midId: string
  lateId: string
  listedRecordId: string
  earlyArtist: string
  midArtist: string
  lateArtist: string
}> {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const runTag = String(Date.now())

  async function createRecord(
    artist: string,
    name: string,
    purchasedAt: string,
    receivedAt: string,
  ): Promise<string> {
    const res = await with429Retry('create record', () =>
      request.post('/api/records', {
        headers,
        data: {
          artist,
          name,
          format: 'LP',
          catalogNumber: `CAT-${Date.now()}`,
          label: 'Filter Test',
          recordGrade: 'VG+',
          sleeveGrade: 'VG',
          purchaseType: 'retail',
          purchasePriceCents: 2500,
          purchaseCurrency: 'USD',
          purchasedAt: `${purchasedAt}T00:00:00Z`,
          receivedAt: `${receivedAt}T00:00:00Z`,
          mediaPieces: [{ kind: 'front_cover', index: 0, urlOrPath: PLACEHOLDER }],
        },
      }),
    )
    if (!res.ok()) {
      throw new Error(`create record failed ${res.status()}: ${(await res.text()).slice(0, 200)}`)
    }
    const row = (await res.json()) as { id?: string }
    if (!row.id) throw new Error('record missing id')
    return row.id
  }

  const earlyArtist = `Filter Early ${runTag}`
  const midArtist = `Filter Mid ${runTag}`
  const lateArtist = `Filter Late ${runTag}`
  const earlyId = await createRecord(earlyArtist, 'Pressing A', '2026-01-15', '2026-01-20')
  const midId = await createRecord(midArtist, 'Pressing B', '2026-03-10', '2026-03-15')
  const lateId = await createRecord(lateArtist, 'Pressing C', '2026-05-01', '2026-05-05')
  const listedRecordId = midId

  await createListingWithShipping(request, token, {
    title: `Listed from record ${runTag}`,
    source_record_id: listedRecordId,
  })

  return {
    runTag,
    earlyId,
    midId,
    lateId,
    listedRecordId,
    earlyArtist,
    midArtist,
    lateArtist,
  }
}
