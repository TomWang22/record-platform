/** Client-side RP field parsing — mirrors listings-service/rp-listing-fields.ts */

const HOUSING_RESIDENCE_TYPES = new Set([
  'apartment',
  'house',
  'townhouse',
  'condo',
  'studio',
  'room',
  'duplex',
])

const FORMAT_IN_TITLE =
  /\b(LP|CD|7[\s-]?inch|7"|10[\s-]?inch|10"|12[\s-]?inch|12"|cassette)\b/i

function amenityMap(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (raw == null) return out
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const s = String(item).trim()
      if (!s) continue
      const colon = s.indexOf(':')
      if (colon > 0) {
        out[s.slice(0, colon).trim().toLowerCase()] = s.slice(colon + 1).trim()
      }
    }
    return out
  }
  if (typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v == null) continue
      out[String(k).trim().toLowerCase()] = String(v).trim()
    }
  }
  return out
}

function pick(map: Record<string, string>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = map[k]
    if (v && !HOUSING_RESIDENCE_TYPES.has(v.toLowerCase())) return v
  }
  return undefined
}

export function inferFormatFromTitle(title: string): string | undefined {
  const m = title.match(FORMAT_IN_TITLE)
  if (!m) return undefined
  const f = m[1].toLowerCase()
  if (f.includes('7')) return '7-inch'
  if (f.includes('10')) return '10-inch'
  if (f.includes('12')) return '12-inch'
  return f.toUpperCase() === 'CD' ? 'CD' : f.toUpperCase() === 'LP' ? 'LP' : f
}

export function resolveRpFormat(
  row: Record<string, unknown>,
  amenityFields: Record<string, string>,
): string | undefined {
  const explicit =
    row.format != null
      ? String(row.format).trim()
      : pick(amenityFields, 'format', 'media_format', 'record_format')
  if (explicit && !HOUSING_RESIDENCE_TYPES.has(explicit.toLowerCase())) {
    return explicit
  }
  const rt = row.residence_type != null ? String(row.residence_type).toLowerCase() : ''
  if (rt && !HOUSING_RESIDENCE_TYPES.has(rt)) return rt
  return inferFormatFromTitle(String(row.title ?? ''))
}

export function parseRpFieldsFromRow(row: Record<string, unknown>) {
  const map = amenityMap(row.amenities)
  const format = resolveRpFormat(row, map)
  return {
    format,
    mediaCondition: pick(map, 'media_condition', 'mediacondition', 'grade', 'media_grade'),
    sleeveCondition: pick(map, 'sleeve_condition', 'sleevecondition', 'sleeve_grade'),
    catalogNumber: pick(map, 'catalog_number', 'catalognumber'),
    label: pick(map, 'label'),
  }
}
