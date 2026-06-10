import { apiFetch } from './api-client'

export type PurchaseHistoryItem = {
  id: string
  order_id: string
  listing_id: string | null
  item_type: string
  item_id: string
  quantity: number
  price_paid: string | number
  currency: string
  purchase_type: string
  status: string
  purchased_at: string
  metadata?: Record<string, unknown> | null
}

export type PurchaseHistoryResponse = {
  items: PurchaseHistoryItem[]
  total: number
}

export async function fetchPurchaseHistory(limit = 200): Promise<PurchaseHistoryResponse> {
  return apiFetch<PurchaseHistoryResponse>(`/api/history/purchases?limit=${limit}`, { auth: true })
}
