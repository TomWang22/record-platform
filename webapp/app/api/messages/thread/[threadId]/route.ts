import { NextRequest, NextResponse } from 'next/server'

import {
  messagingMessagesBaseUrl,
  messagingProxyHeaders,
  userIdFromAuthHeader,
} from '@/lib/messaging-bff'
import { getApiGatewayUrl } from '@/lib/server-api'

const LISTING_SUBJECT = /^\[listing:([0-9a-f-]{36})\]\s*(.*)$/i

type RawReaction = {
  emoji?: string
  count?: number
  includes_me?: boolean
}

type RawReplyTo = {
  content_snippet?: string
  content?: string
}

type RawMessage = {
  id: string
  sender_id?: string
  recipient_id?: string
  content?: string
  subject?: string
  created_at?: string
  edited_at?: string | null
  reply_to_message?: RawReplyTo | null
  reactions?: RawReaction[] | string
  sender_display_name?: string | null
  sender_username?: string | null
  recipient_display_name?: string | null
  recipient_username?: string | null
}

function parseReactions(raw: RawMessage['reactions']): Array<{ emoji: string; count: number; includesMe: boolean }> {
  if (!raw) return []
  let list: RawReaction[] = []
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw) as RawReaction[]
    } catch {
      return []
    }
  } else if (Array.isArray(raw)) {
    list = raw
  }
  return list
    .map((r) => ({
      emoji: String(r.emoji ?? ''),
      count: Number(r.count ?? 0),
      includesMe: Boolean(r.includes_me),
    }))
    .filter((r) => r.emoji && r.count > 0)
}

function displayLabel(
  displayName: string | null | undefined,
  username: string | null | undefined,
): string {
  const d = String(displayName ?? '').trim()
  if (d) return d
  const u = String(username ?? '')
    .trim()
    .replace(/^@+/, '')
  if (u) return u.startsWith('@') ? u : `@${u}`
  return 'Member'
}

function parseListingFromMessages(messages: RawMessage[]): {
  listingId: string | null
  listingTitle: string | null
} {
  for (const m of messages) {
    const subject = String(m.subject ?? '').trim()
    const match = subject.match(LISTING_SUBJECT)
    if (match) {
      return { listingId: match[1], listingTitle: match[2]?.trim() || 'Listing' }
    }
  }
  return { listingId: null, listingTitle: null }
}

async function fetchListingSummary(
  listingId: string,
  authHeader: string,
): Promise<{
  title: string
  priceCents: number | null
  thumbnailUrl: string | null
  sellerId: string | null
} | null> {
  try {
    const url = `${getApiGatewayUrl()}/api/listings/${listingId}`
    const res = await fetch(url, {
      headers: { Authorization: authHeader },
      cache: 'no-store',
    })
    if (!res.ok) return null
    const j = (await res.json()) as Record<string, unknown>
    const title = String(j.title ?? 'Listing')
    let priceCents: number | null = null
    if (typeof j.price === 'number' && Number.isFinite(j.price)) {
      priceCents = Math.round(j.price * 100)
    } else if (typeof j.price_cents === 'number' && Number.isFinite(j.price_cents)) {
      priceCents = Math.round(j.price_cents)
    } else if (typeof j.priceCents === 'number' && Number.isFinite(j.priceCents)) {
      priceCents = Math.round(j.priceCents)
    }
    const images = j.images ?? j.media
    let thumbnailUrl: string | null = null
    if (Array.isArray(images) && images.length > 0) {
      const first = images[0]
      if (typeof first === 'string' && first.trim()) {
        thumbnailUrl = first.trim()
      } else if (first && typeof first === 'object') {
        const o = first as Record<string, unknown>
        thumbnailUrl = String(o.url ?? o.image_url ?? o.thumbnail_url ?? '') || null
      }
    } else if (typeof j.thumbnail_url === 'string') {
      thumbnailUrl = j.thumbnail_url
    } else if (typeof j.primaryImageUrl === 'string') {
      thumbnailUrl = j.primaryImageUrl
    } else if (typeof j.primary_image_url === 'string') {
      thumbnailUrl = j.primary_image_url
    }
    const sellerRaw =
      j.seller_id ?? j.sellerId ?? (j.seller && typeof j.seller === 'object'
        ? (j.seller as Record<string, unknown>).id
        : null)
    const sellerId = sellerRaw != null && String(sellerRaw).trim() ? String(sellerRaw) : null
    return {
      title,
      priceCents: Number.isFinite(priceCents) ? priceCents : null,
      thumbnailUrl,
      sellerId,
    }
  } catch {
    return null
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { threadId: string } },
) {
  const threadId = params.threadId
  const authHeader = request.headers.get('Authorization') || ''
  const currentUserId = userIdFromAuthHeader(authHeader)

  try {
    const response = await fetch(
      `${messagingMessagesBaseUrl()}/thread/${encodeURIComponent(threadId)}?includeArchived=true`,
      {
        headers: messagingProxyHeaders(request),
        cache: 'no-store',
      },
    )

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch thread' }, { status: response.status })
    }

    const raw = (await response.json()) as {
      thread_id?: string
      messages?: RawMessage[]
    }

    const messages = raw.messages ?? []
    const { listingId, listingTitle } = parseListingFromMessages(messages)

    let listing: {
      id: string
      title: string
      priceCents: number | null
      thumbnailUrl: string | null
      sellerId: string | null
    } | null = null

    if (listingId) {
      const summary = await fetchListingSummary(listingId, authHeader)
      listing = {
        id: listingId,
        title: summary?.title ?? listingTitle ?? 'Listing',
        priceCents: summary?.priceCents ?? null,
        thumbnailUrl: summary?.thumbnailUrl ?? null,
        sellerId: summary?.sellerId ?? null,
      }
    }

    const participantMap = new Map<
      string,
      { id: string; username: string | null; displayName: string | null }
    >()

    for (const row of messages) {
      const pairs: Array<[string | undefined, string | null | undefined, string | null | undefined]> =
        [
          [row.sender_id, row.sender_display_name, row.sender_username],
          [row.recipient_id, row.recipient_display_name, row.recipient_username],
        ]
      for (const [id, displayName, username] of pairs) {
        if (!id) continue
        if (!participantMap.has(id)) {
          participantMap.set(id, {
            id,
            displayName: displayName ? String(displayName) : null,
            username: username ? String(username) : null,
          })
        }
      }
    }

    const contractMessages = messages.map((row) => {
      const senderId = String(row.sender_id ?? '')
      const isMine = Boolean(currentUserId && senderId === currentUserId)
      const replyTo = row.reply_to_message
      const replySnippet = String(
        replyTo?.content_snippet ?? replyTo?.content ?? '',
      ).trim()
      return {
        id: String(row.id),
        senderId,
        senderDisplayName: isMine
          ? 'You'
          : displayLabel(row.sender_display_name, row.sender_username),
        body: String(row.content ?? ''),
        createdAt: String(row.created_at ?? new Date().toISOString()),
        editedAt: row.edited_at ? String(row.edited_at) : null,
        isMine,
        replyToSnippet: replySnippet || null,
        reactions: parseReactions(row.reactions),
      }
    })

    return NextResponse.json({
      conversationId: String(raw.thread_id ?? threadId),
      listing,
      participants: Array.from(participantMap.values()),
      messages: contractMessages,
    })
  } catch (error) {
    console.error('Failed to fetch messaging thread:', error)
    return NextResponse.json({ error: 'Failed to fetch thread' }, { status: 500 })
  }
}
