import { apiFetch } from './api-client'

export type AppNotification = {
  id: string
  type: string
  title: string
  body: string
  href: string
  read: boolean
  createdAt: string
}

type NotificationRow = {
  id: string
  event_type?: string
  payload?: Record<string, unknown> | string | null
  read_at?: string | null
  created_at?: string
}

function parsePayload(payload: NotificationRow['payload']): Record<string, unknown> {
  if (!payload) return {}
  if (typeof payload === 'object') return payload
  try {
    return JSON.parse(payload) as Record<string, unknown>
  } catch {
    return {}
  }
}

function aiInsightDeepLink(
  eventType: string,
  payload: Record<string, unknown>,
): string | null {
  const listingId = String(payload.listing_id ?? payload.listingId ?? '').trim()
  const contractId = String(payload.contract_id ?? '').trim()
  if (eventType === 'AuctionRiskDetectedV1') {
    return listingId ? `/insights?panel=auction&listing=${listingId}` : '/insights?panel=auction'
  }
  if (eventType === 'PricingRecommendationCreatedV1') {
    return listingId ? `/insights?panel=pricing&listing=${listingId}` : '/insights?panel=pricing'
  }
  if (eventType === 'AIInsightCreatedV1') {
    if (contractId === 'buyer_collection_summary') return '/insights?panel=buyer'
    if (contractId === 'seller_sales_summary') return '/insights?panel=seller'
    if (contractId === 'record_valuation') return '/insights?panel=valuation'
    if (contractId === 'rag_query') return '/insights?panel=rag'
    return '/insights'
  }
  if (payload.notification_category === 'marketplace_ai') {
    return '/insights'
  }
  return null
}

function rowToAppNotification(row: NotificationRow): AppNotification {
  const payload = parsePayload(row.payload)
  const title = String(payload.title ?? row.event_type ?? 'Notification')
  const body = String(payload.body ?? payload.message ?? '')
  const eventType = String(row.event_type ?? '').trim()
  const aiLink = aiInsightDeepLink(eventType, payload)
  const href = String(
    aiLink ??
      payload.href ??
      payload.deep_link ??
      (payload.listing_id ? `/listings/${payload.listing_id}` : '/listings'),
  )
  const payloadType = String(payload.type ?? '').trim()
  const normalizedType =
    payloadType ||
    (eventType === 'message_received' ? 'message_received' : eventType) ||
    (payload.notification_category === 'marketplace_ai' ? 'marketplace_ai' : 'system')

  return {
    id: row.id,
    type: normalizedType,
    title,
    body,
    href,
    read: Boolean(row.read_at),
    createdAt: String(row.created_at ?? new Date().toISOString()),
  }
}

export async function fetchNotificationsFromApi(): Promise<AppNotification[]> {
  const data = await apiFetch<{ items?: NotificationRow[] }>('/api/notifications', {
    auth: true,
  })
  return (data.items ?? []).map(rowToAppNotification)
}

export async function markNotificationRead(id: string): Promise<void> {
  await apiFetch(`/api/notifications/${id}/read`, { method: 'POST', auth: true })
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiFetch('/api/notifications/read-all', { method: 'POST', auth: true, data: {} })
}
