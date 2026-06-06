/** Parse listings amenities JSON (array of key:value strings or object). */

export function amenityMapFromRaw(raw: unknown): Record<string, string> {
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
