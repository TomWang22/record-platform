import { apiFetch } from './api-client'

export type MessagingListingContext = {
  id: string
  title: string
  priceCents: number | null
  thumbnailUrl: string | null
  saleMode?: string | null
  /** Listing owner principal when known — used for seller/buyer negotiation side. */
  sellerId?: string | null
}

export type MessagingParticipant = {
  id: string
  username: string | null
  displayName: string | null
}

export type InboxFilter =
  | 'all'
  | 'direct'
  | 'groups'
  | 'unread'
  | 'archived'
  | 'offers'

export type MessagingInboxThread = {
  id: string
  kind: 'dm' | 'group'
  participantDisplay: string
  listingId: string | null
  listingContextTitle: string | null
  lastMessagePreview: string
  unreadCount: number
  lastAt: string | null
}

export type MessageReaction = {
  emoji: string
  count: number
  includesMe: boolean
}

export type MessagingThreadMessage = {
  id: string
  senderId: string
  senderDisplayName: string
  body: string
  createdAt: string
  editedAt?: string | null
  isMine: boolean
  replyToSnippet?: string | null
  reactions?: MessageReaction[]
}

export type MessagingThreadContract = {
  conversationId: string
  listing: MessagingListingContext | null
  participants: MessagingParticipant[]
  messages: MessagingThreadMessage[]
}

type ThreadRow = {
  id: string
  kind?: string
  participantDisplay?: string
  listingId?: string | null
  listingContextTitle?: string | null
  lastMessagePreview?: string
  unreadCount?: number
  lastAt?: string | null
}

export async function fetchMessagingInbox(): Promise<MessagingInboxThread[]> {
  const data = await apiFetch<{ threads?: ThreadRow[] }>('/api/messages/threads', { auth: true })
  return (data.threads ?? []).map((row) => ({
    id: String(row.id),
    kind: String(row.kind ?? 'dm').toLowerCase() === 'group' ? 'group' : 'dm',
    participantDisplay: String(row.participantDisplay ?? 'New messages'),
    listingId: row.listingId ? String(row.listingId) : null,
    listingContextTitle: row.listingContextTitle ? String(row.listingContextTitle) : null,
    lastMessagePreview: String(row.lastMessagePreview ?? ''),
    unreadCount: Number(row.unreadCount ?? 0),
    lastAt: row.lastAt ? String(row.lastAt) : null,
  }))
}

export async function fetchMessagingThread(threadId: string): Promise<MessagingThreadContract> {
  return apiFetch<MessagingThreadContract>(
    `/api/messages/thread/${encodeURIComponent(threadId)}?includeArchived=true`,
    { auth: true },
  )
}

export type StartMessagingThreadResult = {
  threadId: string
  recipientId?: string
  listingId?: string
  messageId?: string
  listing?: MessagingListingContext | null
}

export async function startMessagingThread(input: {
  listingId?: string
  recipientId?: string
  initialMessage?: string
}): Promise<StartMessagingThreadResult> {
  if (!input.listingId && !input.recipientId) {
    throw new Error('listingId or recipientId required')
  }
  const data = await apiFetch<{
    thread_id?: string
    threadId?: string
    message_id?: string
    messageId?: string
    recipient_id?: string
    recipientId?: string
    listing_id?: string
    listingId?: string
    listing?: {
      id?: string
      title?: string
      price_cents?: number | null
      thumbnail_url?: string | null
      pricing_mode?: string | null
    }
  }>('/api/messages/start', {
    method: 'POST',
    auth: true,
    data: {
      ...(input.listingId ? { listing_id: input.listingId } : {}),
      ...(input.recipientId ? { recipient_id: input.recipientId } : {}),
      ...(input.initialMessage ? { initial_message: input.initialMessage } : {}),
    },
  })
  const threadId = String(data.thread_id ?? data.threadId ?? '').trim()
  if (!threadId) throw new Error('start did not return thread_id')
  const listing = data.listing
  return {
    threadId,
    recipientId: String(data.recipient_id ?? data.recipientId ?? input.recipientId ?? '').trim() || undefined,
    listingId: String(data.listing_id ?? data.listingId ?? input.listingId ?? '').trim() || undefined,
    messageId: String(data.message_id ?? data.messageId ?? '').trim() || undefined,
    listing: listing
      ? {
          id: String(listing.id ?? input.listingId ?? ''),
          title: String(listing.title ?? 'Listing'),
          priceCents:
            typeof listing.price_cents === 'number' ? listing.price_cents : null,
          thumbnailUrl: listing.thumbnail_url ? String(listing.thumbnail_url) : null,
          saleMode: listing.pricing_mode ? String(listing.pricing_mode) : null,
        }
      : null,
  }
}

export type MessagingUserSearchHit = {
  id: string
  username: string | null
  displayName: string | null
}

export async function searchMessagingUsers(query: string): Promise<MessagingUserSearchHit[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const data = await apiFetch<{
    users?: Array<{ id: string; username?: string | null; display_name?: string | null }>
  }>(`/api/messages/users/search?q=${encodeURIComponent(q)}`, { auth: true })
  return (data.users ?? []).map((row) => ({
    id: String(row.id),
    username: row.username ? String(row.username) : null,
    displayName: row.display_name ? String(row.display_name) : null,
  }))
}

export async function fetchMessagingUser(userId: string): Promise<MessagingUserSearchHit | null> {
  const data = await apiFetch<{
    user?: { id: string; username?: string | null; display_name?: string | null; email?: string | null }
  }>(`/api/messages/users/${encodeURIComponent(userId)}`, { auth: true })
  const row = data.user
  if (!row?.id) return null
  return {
    id: String(row.id),
    username: row.username ? String(row.username) : null,
    displayName: row.display_name
      ? String(row.display_name)
      : row.email
        ? String(row.email)
        : null,
  }
}

export type SendMarketplaceMessageResult = {
  threadId?: string
  messageId?: string
}

export async function sendMarketplaceMessage(input: {
  recipientId: string
  body: string
  listingId?: string
  isFirstMessage?: boolean
  parentMessageId?: string
}): Promise<SendMarketplaceMessageResult> {
  const content = input.body.trim()
  if (!content) throw new Error('Message body required')

  if (input.isFirstMessage) {
    const started = await startMessagingThread({
      listingId: input.listingId,
      recipientId: input.recipientId,
      initialMessage: content,
    })
    return { threadId: started.threadId, messageId: started.messageId }
  }

  await apiFetch('/api/messages/send', {
    method: 'POST',
    auth: true,
    data: {
      recipient_id: input.recipientId,
      message_type: 'question',
      subject: 'Message',
      content,
      parent_message_id: input.parentMessageId ?? null,
    },
  })
  return {}
}

export async function replyToMessage(messageId: string, body: string): Promise<void> {
  const content = body.trim()
  if (!content) throw new Error('Reply body required')
  await apiFetch(`/api/messages/${encodeURIComponent(messageId)}/reply`, {
    method: 'POST',
    auth: true,
    data: { content },
  })
}

export async function editMessage(messageId: string, body: string): Promise<void> {
  const content = body.trim()
  if (!content) throw new Error('Message body required')
  await apiFetch(`/api/messages/${encodeURIComponent(messageId)}`, {
    method: 'PUT',
    auth: true,
    data: { content, subject: '' },
  })
}

export async function addMessageReaction(messageId: string, emoji: string): Promise<void> {
  await apiFetch(`/api/messages/${encodeURIComponent(messageId)}/reactions`, {
    method: 'POST',
    auth: true,
    data: { emoji },
  })
}

export async function archiveThread(threadId: string): Promise<void> {
  await apiFetch(`/api/messages/thread/${encodeURIComponent(threadId)}/archive`, {
    method: 'POST',
    auth: true,
  })
}

export async function unarchiveThread(threadId: string): Promise<void> {
  await apiFetch(`/api/messages/thread/${encodeURIComponent(threadId)}/archive`, {
    method: 'DELETE',
    auth: true,
  })
}

export async function deleteThreadForSelf(threadId: string): Promise<void> {
  await apiFetch(`/api/messages/thread/${encodeURIComponent(threadId)}/delete`, {
    method: 'POST',
    auth: true,
  })
}

export async function fetchArchivedThreads(): Promise<
  Array<{ threadId: string; subject?: string; archivedAt?: string }>
> {
  const data = await apiFetch<{ archived?: Array<{ thread_id: string; subject?: string; archived_at?: string }> }>(
    '/api/messages/archived',
    { auth: true },
  )
  return (data.archived ?? []).map((row) => ({
    threadId: String(row.thread_id),
    subject: row.subject ? String(row.subject) : undefined,
    archivedAt: row.archived_at ? String(row.archived_at) : undefined,
  }))
}

export async function createMessagingGroup(input: {
  name: string
  description?: string
}): Promise<{ id: string; name: string }> {
  return apiFetch<{ id: string; name: string }>('/api/messages/groups', {
    method: 'POST',
    auth: true,
    data: input,
  })
}

export async function addGroupMember(groupId: string, userId: string): Promise<void> {
  await apiFetch(`/api/messages/groups/${encodeURIComponent(groupId)}/members`, {
    method: 'POST',
    auth: true,
    data: { user_id: userId },
  })
}

export async function leaveMessagingGroup(groupId: string): Promise<void> {
  await apiFetch(`/api/messages/groups/${encodeURIComponent(groupId)}/leave`, {
    method: 'DELETE',
    auth: true,
  })
}

export async function sendGroupMessage(groupId: string, content: string): Promise<void> {
  await apiFetch('/api/messages/send', {
    method: 'POST',
    auth: true,
    data: {
      group_id: groupId,
      message_type: 'group',
      subject: 'Group message',
      content: content.trim(),
    },
  })
}
