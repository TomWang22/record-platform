'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { formatMoneyFromCents } from '@/lib/listing-format'
import { getUserIdFromToken } from '@/lib/jwt-user'
import {
  addMessageReaction,
  archiveThread,
  deleteThreadForSelf,
  editMessage,
  fetchArchivedThreads,
  fetchMessagingInbox,
  fetchMessagingThread,
  replyToMessage,
  sendGroupMessage,
  sendMarketplaceMessage,
  type InboxFilter,
  type MessagingInboxThread,
  type MessagingThreadContract,
  type MessagingThreadMessage,
} from '@/lib/messaging-product-api'
import { getClientSessionToken } from '@/lib/session'
import { useSession, isSessionAuthenticated } from '@/lib/use-session'

function formatThreadTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function MessagingProductView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const session = useSession()

  const composeUserId = searchParams.get('user')?.trim() ?? ''
  const composeListingId = searchParams.get('listing')?.trim() ?? ''
  const threadParam = searchParams.get('thread')?.trim() ?? ''

  const token = isSessionAuthenticated(session) ? session.token : getClientSessionToken()
  const currentUserId = getUserIdFromToken(token)

  const [threads, setThreads] = useState<MessagingInboxThread[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [threadDetail, setThreadDetail] = useState<MessagingThreadContract | null>(null)
  const [composeBody, setComposeBody] = useState('')
  const [loadingInbox, setLoadingInbox] = useState(true)
  const [loadingThread, setLoadingThread] = useState(false)
  const [sending, setSending] = useState(false)
  const [listingPreview, setListingPreview] = useState<{
    title: string
    priceCents: number | null
    thumbnailUrl: string | null
  } | null>(null)
  const [composeSellerId, setComposeSellerId] = useState('')
  const [replyTo, setReplyTo] = useState<{ id: string; snippet: string } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>('all')
  const [inboxSearch, setInboxSearch] = useState('')
  const [archivedRows, setArchivedRows] = useState<
    Array<{ threadId: string; subject?: string; archivedAt?: string }>
  >([])

  const loadInbox = useCallback(async () => {
    setLoadingInbox(true)
    try {
      const rows = await fetchMessagingInbox()
      setThreads(rows)
      return rows
    } catch {
      setThreads([])
      return []
    } finally {
      setLoadingInbox(false)
    }
  }, [])

  const loadThread = useCallback(async (threadId: string) => {
    setLoadingThread(true)
    try {
      const detail = await fetchMessagingThread(threadId)
      setThreadDetail(detail)
      setActiveThreadId(threadId)
    } catch {
      setThreadDetail(null)
    } finally {
      setLoadingThread(false)
    }
  }, [])

  useEffect(() => {
    void loadInbox()
    const interval = setInterval(() => void loadInbox(), 12_000)
    return () => clearInterval(interval)
  }, [loadInbox])

  useEffect(() => {
    if (!composeListingId) {
      setListingPreview(null)
      setComposeSellerId('')
      return
    }
    void (async () => {
      try {
        const res = await fetch(`/api/listings/${composeListingId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (!res.ok) return
        const data = (await res.json()) as {
          title?: string
          price_cents?: number
          priceCents?: number
          primary_image_url?: string
          primaryImageUrl?: string
          seller_id?: string
          user_id?: string
          sellerId?: string
          userId?: string
          images?: string[] | Array<{ url?: string; image_url?: string }>
        }
        const sellerFromListing = String(
          data.seller_id ??
            data.user_id ??
            data.sellerId ??
            data.userId ??
            '',
        ).trim()
        setComposeSellerId(composeUserId || sellerFromListing)
        const priceCents =
          typeof data.price_cents === 'number'
            ? data.price_cents
            : typeof data.priceCents === 'number'
              ? data.priceCents
              : null
        const thumb =
          data.primary_image_url ??
          data.primaryImageUrl ??
          (Array.isArray(data.images) && data.images[0]
            ? typeof data.images[0] === 'string'
              ? data.images[0]
              : String(
                  (data.images[0] as { url?: string; image_url?: string }).url ??
                    (data.images[0] as { url?: string; image_url?: string }).image_url ??
                    '',
                )
            : null)
        setListingPreview({
          title: String(data.title ?? 'Listing'),
          priceCents,
          thumbnailUrl: thumb,
        })
      } catch {
        setListingPreview(null)
      }
    })()
  }, [composeListingId, composeUserId, token])

  useEffect(() => {
    if (composeUserId) setComposeSellerId(composeUserId)
  }, [composeUserId])

  useEffect(() => {
    if (threadParam) {
      void loadThread(threadParam)
    }
  }, [threadParam, loadThread])

  const composeRecipientId = composeUserId || composeSellerId
  const composeMode = Boolean(composeRecipientId && !activeThreadId)
  const counterpartLabel = useMemo(() => {
    if (threadDetail?.participants?.length) {
      const other = threadDetail.participants.find((p) => p.id !== currentUserId)
      if (other?.displayName) return other.displayName
      if (other?.username) return other.username.replace(/^@+/, '')
    }
    const row = threads.find((t) => t.id === activeThreadId)
    if (row?.participantDisplay) return row.participantDisplay
    return 'Seller'
  }, [threadDetail, threads, activeThreadId, currentUserId])

  const listingCard = threadDetail?.listing ?? (composeListingId && listingPreview
    ? {
        id: composeListingId,
        title: listingPreview.title,
        priceCents: listingPreview.priceCents,
        thumbnailUrl: listingPreview.thumbnailUrl,
      }
    : null)

  async function refreshAfterSend(
    isFirstWithListing: boolean,
    previewHint?: string,
    knownThreadId?: string,
  ) {
    setComposeBody('')
    setReplyTo(null)
    const inbox = await loadInbox()
    if (isFirstWithListing) {
      const hint = String(previewHint || '').slice(0, 24)
      const match =
        inbox.find((t) => composeListingId && t.listingId === composeListingId) ??
        (hint ? inbox.find((t) => t.lastMessagePreview.includes(hint)) : undefined) ??
        inbox[0]
      const threadId = knownThreadId || match?.id
      if (threadId) {
        setActiveThreadId(threadId)
        await loadThread(threadId)
        router.push(`/messages?thread=${encodeURIComponent(threadId)}`)
      }
    } else if (activeThreadId) {
      await loadThread(activeThreadId)
    }
  }

  const activeThreadKind = useMemo(() => {
    const row = threads.find((t) => t.id === activeThreadId)
    return row?.kind ?? 'dm'
  }, [threads, activeThreadId])

  const filteredThreads = useMemo(() => {
    const q = inboxSearch.trim().toLowerCase()
    let rows = threads
    if (inboxFilter === 'direct') rows = rows.filter((t) => t.kind === 'dm')
    else if (inboxFilter === 'groups') rows = rows.filter((t) => t.kind === 'group')
    else if (inboxFilter === 'unread') rows = rows.filter((t) => t.unreadCount > 0)
    else if (inboxFilter === 'offers') {
      rows = rows.filter((t) => Boolean(t.listingId || t.listingContextTitle))
    }
    if (q) {
      rows = rows.filter((t) => {
        const hay = `${t.participantDisplay} ${t.listingContextTitle ?? ''} ${t.lastMessagePreview}`.toLowerCase()
        return hay.includes(q)
      })
    }
    return rows
  }, [threads, inboxFilter, inboxSearch])

  useEffect(() => {
    if (inboxFilter !== 'archived') return
    void fetchArchivedThreads()
      .then(setArchivedRows)
      .catch(() => setArchivedRows([]))
  }, [inboxFilter])

  async function handleArchiveActiveThread() {
    if (!activeThreadId) return
    await archiveThread(activeThreadId)
    setActiveThreadId(null)
    setThreadDetail(null)
    router.push('/messages')
    await loadInbox()
    try {
      const rows = await fetchArchivedThreads()
      setArchivedRows(rows)
    } catch {
      setArchivedRows([])
    }
  }

  async function handleDeleteActiveThread() {
    if (!activeThreadId) return
    await deleteThreadForSelf(activeThreadId)
    setActiveThreadId(null)
    setThreadDetail(null)
    router.push('/messages')
    await loadInbox()
  }

  async function handleSend() {
    const body = composeBody.trim()
    if (!body || sending) return
    if (!composeRecipientId && !activeThreadId && !replyTo) return

    setSending(true)
    try {
      if (replyTo) {
        await replyToMessage(replyTo.id, body)
        await refreshAfterSend(false, body)
        return
      }

      if (activeThreadId && activeThreadKind === 'group') {
        await sendGroupMessage(activeThreadId, body)
        await refreshAfterSend(false, body)
        return
      }

      const recipientId =
        composeRecipientId ||
        threadDetail?.participants.find((p) => p.id !== currentUserId)?.id ||
        ''

      if (!recipientId) return

      const isFirstWithListing = Boolean(composeListingId && !activeThreadId && !replyTo)

      const sent = await sendMarketplaceMessage({
        recipientId,
        body,
        listingId: composeListingId || undefined,
        isFirstWithListing,
      })

      await refreshAfterSend(isFirstWithListing, body, sent.threadId)
    } finally {
      setSending(false)
    }
  }

  async function handleSaveEdit() {
    if (!editingId || !editDraft.trim() || sending) return
    setSending(true)
    try {
      await editMessage(editingId, editDraft.trim())
      setEditingId(null)
      setEditDraft('')
      if (activeThreadId) await loadThread(activeThreadId)
    } finally {
      setSending(false)
    }
  }

  async function handleReaction(messageId: string, emoji: string) {
    try {
      await addMessageReaction(messageId, emoji)
      if (activeThreadId) await loadThread(activeThreadId)
    } catch {
      /* non-fatal */
    }
  }

  function startReply(msg: MessagingThreadMessage) {
    setReplyTo({ id: msg.id, snippet: msg.body.slice(0, 120) })
    setEditingId(null)
    setEditDraft('')
  }

  function startEdit(msg: MessagingThreadMessage) {
    setEditingId(msg.id)
    setEditDraft(msg.body)
    setReplyTo(null)
  }

  function selectThread(threadId: string) {
    router.push(`/messages?thread=${encodeURIComponent(threadId)}`)
    void loadThread(threadId)
  }

  return (
    <div
      className="space-y-4"
      data-testid="messages-product-page"
      data-ready={loadingInbox ? 'loading' : 'ready'}
    >
      <span
        className="hidden"
        aria-hidden
        data-testid={loadingInbox ? 'messages-loading' : 'messages-ready'}
      />
      <header>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Messages</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Marketplace conversations about listings and offers.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2" data-testid="messages-inbox-filters">
        {(
          [
            ['all', 'All'],
            ['direct', 'Direct'],
            ['groups', 'Groups'],
            ['unread', 'Unread'],
            ['archived', 'Archived'],
            ['offers', 'Offers'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            data-testid={`messages-filter-${key}`}
            onClick={() => setInboxFilter(key)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              inboxFilter === key
                ? 'bg-brand text-white'
                : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
        <input
          data-testid="messages-inbox-search"
          value={inboxSearch}
          onChange={(e) => setInboxSearch(e.target.value)}
          placeholder="Search people or listings…"
          className="min-w-[200px] flex-1 rounded-xl border border-slate-200/80 px-3 py-1.5 text-sm dark:border-white/10 dark:bg-slate-950"
        />
      </div>

      <div
        className="grid min-h-[560px] overflow-hidden rounded-2xl border border-slate-200/80 bg-white dark:border-white/10 dark:bg-slate-950 lg:grid-cols-[minmax(260px,320px)_1fr]"
        data-testid="messages-compose-panel"
      >
        <aside
          className="flex flex-col border-b border-slate-200/80 dark:border-white/10 lg:border-b-0 lg:border-r"
          data-testid="messages-inbox-list"
        >
          <div className="border-b border-slate-200/80 px-4 py-3 dark:border-white/10">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Inbox</p>
          </div>
          <ul className="flex-1 overflow-y-auto">
            {loadingInbox && threads.length === 0 && (
              <li className="px-4 py-6 text-sm text-slate-500">Loading conversations…</li>
            )}
            {inboxFilter === 'archived' && archivedRows.length === 0 && (
              <li className="px-4 py-6 text-sm text-slate-500">No archived conversations.</li>
            )}
            {inboxFilter === 'archived' &&
              archivedRows.map((row) => (
                <li key={row.threadId}>
                  <button
                    type="button"
                    data-testid="messages-inbox-item"
                    onClick={() => selectThread(row.threadId)}
                    className="w-full border-b border-slate-100 px-4 py-3 text-left text-sm dark:border-white/5"
                  >
                    {row.subject ?? 'Archived conversation'}
                  </button>
                </li>
              ))}
            {inboxFilter !== 'archived' && !loadingInbox && filteredThreads.length === 0 && (
              <li className="px-4 py-6 text-sm text-slate-500">No conversations yet.</li>
            )}
            {inboxFilter !== 'archived' &&
              filteredThreads.map((thread) => (
              <li key={thread.id}>
                <button
                  type="button"
                  data-testid="messages-inbox-item"
                  onClick={() => selectThread(thread.id)}
                  className={`w-full border-b border-slate-100 px-4 py-3 text-left transition hover:bg-slate-50 dark:border-white/5 dark:hover:bg-white/5 ${
                    activeThreadId === thread.id ? 'bg-brand/5' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                      {thread.participantDisplay}
                    </p>
                    {thread.unreadCount > 0 && (
                      <span className="shrink-0 rounded-full bg-brand px-1.5 text-[10px] font-bold text-white">
                        {thread.unreadCount}
                      </span>
                    )}
                  </div>
                  {thread.listingContextTitle && (
                    <p className="mt-0.5 truncate text-xs text-slate-500">{thread.listingContextTitle}</p>
                  )}
                  <p className="mt-1 line-clamp-2 text-xs text-slate-600 dark:text-slate-300">
                    {thread.lastMessagePreview}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-400">{formatThreadTime(thread.lastAt)}</p>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="flex flex-col" data-testid="messages-thread-panel">
          {listingCard && (
            <div
              className="flex gap-3 border-b border-slate-200/80 px-4 py-3 dark:border-white/10"
              data-testid="messages-compose-listing-context"
            >
              {listingCard.thumbnailUrl ? (
                <img
                  src={listingCard.thumbnailUrl}
                  alt=""
                  className="h-16 w-16 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400 dark:bg-slate-800">
                  No image
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                  {listingCard.title}
                </p>
                {listingCard.priceCents != null && (
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    {formatMoneyFromCents(listingCard.priceCents)}
                  </p>
                )}
                <Link
                  href={`/listings/${listingCard.id}`}
                  className="mt-1 inline-block text-xs font-medium text-brand hover:underline"
                  data-testid="messages-compose-listing-link"
                >
                  View listing
                </Link>
              </div>
              <span
                data-testid="messages-compose-listing-id"
                data-listing-id={listingCard.id}
                className="hidden"
                aria-hidden
              />
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 px-4 py-3 dark:border-white/10">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{counterpartLabel}</p>
            {activeThreadId && (
              <div className="flex gap-2">
                <button
                  type="button"
                  data-testid="messages-thread-archive"
                  onClick={() => void handleArchiveActiveThread()}
                  className="rounded px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100 dark:hover:bg-white/10"
                >
                  Archive
                </button>
                <button
                  type="button"
                  data-testid="messages-thread-delete-self"
                  onClick={() => void handleDeleteActiveThread()}
                  className="rounded px-2 py-1 text-[11px] text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                >
                  Delete for me
                </button>
              </div>
            )}
            <span
              data-testid="messages-compose-recipient"
              data-recipient-id={composeRecipientId || undefined}
              className="hidden"
              aria-hidden
            />
            {activeThreadId || composeRecipientId ? (
              <span data-testid="messages-compose-ready" className="hidden" aria-hidden />
            ) : null}
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {loadingThread && (
              <p className="text-sm text-slate-500">Loading conversation…</p>
            )}
            {!loadingThread && composeMode && threadDetail == null && (
              <p className="text-sm text-slate-500">
                Send a message to start the conversation about this listing.
              </p>
            )}
            {(threadDetail?.messages ?? []).map((msg) => (
              <div
                key={msg.id}
                data-testid="messages-thread-bubble"
                data-message-id={msg.id}
                className={`flex flex-col gap-1 ${msg.isMine ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
                    msg.isMine
                      ? 'bg-brand text-white'
                      : 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white'
                  }`}
                >
                  {!msg.isMine && (
                    <p className="mb-1 text-[10px] font-medium opacity-80">{msg.senderDisplayName}</p>
                  )}
                  {msg.replyToSnippet && (
                    <p
                      className={`mb-2 border-l-2 pl-2 text-xs opacity-80 ${
                        msg.isMine ? 'border-white/40' : 'border-slate-400'
                      }`}
                      data-testid="messages-reply-quote"
                    >
                      {msg.replyToSnippet}
                    </p>
                  )}
                  {editingId === msg.id ? (
                    <div className="space-y-2">
                      <textarea
                        data-testid="messages-edit-body"
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        rows={2}
                        className="w-full rounded-lg border border-white/30 bg-white/10 px-2 py-1 text-sm text-white"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          data-testid="messages-edit-save"
                          onClick={() => void handleSaveEdit()}
                          disabled={sending || !editDraft.trim()}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingId(null)
                            setEditDraft('')
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap" data-testid="messages-bubble-text">
                      {msg.body}
                    </p>
                  )}
                  <p
                    className={`mt-1 text-[10px] ${msg.isMine ? 'text-white/70' : 'text-slate-500'}`}
                  >
                    {formatThreadTime(msg.createdAt)}
                    {msg.editedAt ? ' · edited' : ''}
                  </p>
                </div>
                {editingId !== msg.id && (
                  <div
                    className={`flex flex-wrap items-center gap-1 ${msg.isMine ? 'justify-end' : 'justify-start'}`}
                  >
                    <button
                      type="button"
                      data-testid="messages-action-reply"
                      onClick={() => startReply(msg)}
                      className="rounded px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10"
                    >
                      Reply
                    </button>
                    {msg.isMine && (
                      <button
                        type="button"
                        data-testid="messages-action-edit"
                        onClick={() => startEdit(msg)}
                        className="rounded px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10"
                      >
                        Edit
                      </button>
                    )}
                    <button
                      type="button"
                      data-testid="messages-action-react"
                      onClick={() => void handleReaction(msg.id, '👍')}
                      className="rounded px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10"
                    >
                      👍
                    </button>
                    {(msg.reactions ?? []).map((r) => (
                      <span
                        key={`${msg.id}-${r.emoji}`}
                        data-testid="messages-reaction-chip"
                        className={`rounded-full px-2 py-0.5 text-[11px] ${
                          r.includesMe
                            ? 'bg-brand/15 text-brand'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-800'
                        }`}
                      >
                        {r.emoji} {r.count}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="border-t border-slate-200/80 p-4 dark:border-white/10">
            {replyTo && (
              <div
                className="mb-2 flex items-start justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900"
                data-testid="messages-reply-compose-banner"
              >
                <p className="text-slate-600 dark:text-slate-300">
                  Replying to: <span className="font-medium">{replyTo.snippet}</span>
                </p>
                <button
                  type="button"
                  className="text-slate-400 hover:text-slate-600"
                  onClick={() => setReplyTo(null)}
                  aria-label="Cancel reply"
                >
                  ×
                </button>
              </div>
            )}
            <textarea
              data-testid="messages-compose-body"
              value={composeBody}
              onChange={(e) => setComposeBody(e.target.value)}
              placeholder={replyTo ? 'Write your reply…' : 'Type your message…'}
              rows={3}
              className="w-full resize-none rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
            />
            <div className="mt-2 flex justify-end">
              <Button
                data-testid="messages-compose-send"
                onClick={() => void handleSend()}
                disabled={
                  sending ||
                  !composeBody.trim() ||
                  (Boolean(composeListingId) && !composeRecipientId && !activeThreadId && !replyTo)
                }
              >
                {sending ? 'Sending…' : 'Send'}
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
