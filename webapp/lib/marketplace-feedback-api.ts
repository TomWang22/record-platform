import { apiFetch } from './api-client'

export type FeedbackSummary = {
  score: number
  totalReviews: number
  positive: number
  neutral: number
  negative: number
  averageStars: number
  distribution: { stars: number; count: number }[]
  reviews: {
    id: string
    stars: number
    sentiment: 'positive' | 'neutral' | 'negative'
    role: 'buyer' | 'seller'
    body: string
    listingTitle?: string
    listingId?: string
    transactionId?: string
    createdAt: string
  }[]
}

export async function fetchFeedbackSummary(username?: string): Promise<FeedbackSummary> {
  const path = username
    ? `/api/feedback/users/${encodeURIComponent(username)}`
    : '/api/feedback/me'
  return apiFetch<FeedbackSummary>(path, { auth: true })
}

export async function seedContractFeedback(
  listingId: string,
  sellerUserId: string,
  buyerUserId: string,
): Promise<{ feedback_ids: string[] }> {
  return apiFetch('/api/feedback/seed-contract', {
    method: 'POST',
    auth: true,
    data: { listing_id: listingId, seller_user_id: sellerUserId, buyer_user_id: buyerUserId },
  })
}
