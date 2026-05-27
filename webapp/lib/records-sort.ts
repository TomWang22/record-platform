import type { CollectionRecord, RecordsSortKey } from './records-types'

export function sortRecords(
  records: CollectionRecord[],
  sortKey: RecordsSortKey,
): CollectionRecord[] {
  const copy = [...records]
  const cmpStr = (a: string, b: string) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })

  copy.sort((a, b) => {
    switch (sortKey) {
      case 'artist_asc':
        return cmpStr(a.artist, b.artist) || cmpStr(a.name, b.name)
      case 'artist_desc':
        return cmpStr(b.artist, a.artist) || cmpStr(b.name, a.name)
      case 'title_asc':
        return cmpStr(a.name, b.name) || cmpStr(a.artist, b.artist)
      case 'title_desc':
        return cmpStr(b.name, a.name) || cmpStr(b.artist, a.artist)
      case 'purchased_desc': {
        const ta = a.purchasedAt ? Date.parse(a.purchasedAt) : 0
        const tb = b.purchasedAt ? Date.parse(b.purchasedAt) : 0
        return tb - ta
      }
      case 'purchased_asc': {
        const ta = a.purchasedAt ? Date.parse(a.purchasedAt) : 0
        const tb = b.purchasedAt ? Date.parse(b.purchasedAt) : 0
        return ta - tb
      }
      case 'price_desc':
        return (b.purchasePriceCents ?? -1) - (a.purchasePriceCents ?? -1)
      case 'price_asc':
        return (a.purchasePriceCents ?? Number.MAX_SAFE_INTEGER) -
          (b.purchasePriceCents ?? Number.MAX_SAFE_INTEGER)
      case 'added_desc':
        return (
          Date.parse(b.createdAt ?? '0') - Date.parse(a.createdAt ?? '0')
        )
      default:
        return 0
    }
  })
  return copy
}
