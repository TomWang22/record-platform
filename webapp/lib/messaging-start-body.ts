export type NormalizedMessagingStartBody = {
  listingId?: string
  recipientId?: string
  initialMessage?: string
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return undefined
}

/** Accept snake_case and camelCase while contracts migrate. */
export function normalizeMessagingStartBody(
  body: Record<string, unknown> | null | undefined,
): NormalizedMessagingStartBody {
  const raw = body && typeof body === 'object' ? body : {}
  const listingId = pickString(raw, 'listing_id', 'listingId')
  const recipientId = pickString(raw, 'recipient_id', 'recipientId')
  const initialMessage = pickString(raw, 'initial_message', 'initialMessage')
  return {
    ...(listingId ? { listingId } : {}),
    ...(recipientId ? { recipientId } : {}),
    ...(initialMessage ? { initialMessage } : {}),
  }
}

export function pickMessagingField(
  body: Record<string, unknown> | null | undefined,
  snake: string,
  camel: string,
): string | undefined {
  const raw = body && typeof body === 'object' ? body : {}
  return pickString(raw, snake, camel)
}
