import { apiFetch } from './api-client'

export type MessagingListingContext = {
  id: string
  title: string
  priceCents: number | null
  thumbnailUrl: string | null
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

export type SendMarketplaceMessageResult = {
  threadId?: string
}

export async function sendMarketplaceMessage(input: {
  recipientId: string
  body: string
  listingId?: string
  isFirstWithListing?: boolean
  parentMessageId?: string
}): Promise<SendMarketplaceMessageResult> {
  const content = input.body.trim()
  if (!content) throw new Error('Message body required')

  if (input.isFirstWithListing && input.listingId) {
    const started = await apiFetch<{ thread_id?: string; threadId?: string }>(
      '/api/messages/start',
      {
        method: 'POST',
        auth: true,
        data: {
          listing_id: input.listingId,
          initial_message: content,
        },
      },
    )
    const threadId = String(started.thread_id ?? started.threadId ?? '').trim()
    return threadId ? { threadId } : {}
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
