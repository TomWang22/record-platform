'use client'

import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

type ActivityEvent = {
  id: string
  source: string
  event: string
  price?: number
  currency?: string
  marketplaceRef?: string
  ts: string
  topic?: string
}

const MAX_EVENTS = 40

type MessageType = 'general' | 'trade' | 'question' | 'offer' | 'sale' | 'wanted' | 'system'

type UserMessage = {
  id: string
  fromUserId: string
  fromUserEmail?: string
  fromUsername?: string
  toUserId: string
  toUserEmail?: string
  toUsername?: string
  message: string
  messageType: MessageType
  recordId?: string
  recordTitle?: string
  parentMessageId?: string
  timestamp: string
  read: boolean
  replies?: UserMessage[]
}

const messageTypeColors: Record<MessageType, 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info'> = {
  general: 'default',
  trade: 'success',
  question: 'info',
  offer: 'primary',
  sale: 'danger',
  wanted: 'warning',
  system: 'default',
}

const messageTypeLabels: Record<MessageType, string> = {
  general: 'General',
  trade: 'Trade',
  question: 'Question',
  offer: 'Offer',
  sale: 'For Sale',
  wanted: 'Wanted',
  system: 'System',
}

export default function MessagesPage() {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [paused, setPaused] = useState(false)
  const [showCompose, setShowCompose] = useState(false)
  const [conversations, setConversations] = useState<UserMessage[]>([])
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null)
  const [newMessage, setNewMessage] = useState({ 
    toUserId: '', 
    message: '', 
    recordId: '', 
    messageType: 'general' as MessageType 
  })
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (paused) {
      setConnected(false)
      return
    }
    const stream = new EventSource('/api/messages/stream')
    stream.onopen = () => setConnected(true)
    stream.onerror = () => setConnected(false)
    stream.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as ActivityEvent
        setEvents((prev) => [payload, ...prev].slice(0, MAX_EVENTS))
      } catch (error) {
        console.warn('failed to parse stream event', error)
      }
    }
    return () => {
      stream.close()
    }
  }, [paused])

  const latest = events[0]
  const kafkaTopic = latest?.topic ?? 'record-platform.activity'

  useEffect(() => {
    void fetchConversations()
    const interval = setInterval(() => {
      void fetchConversations()
    }, 10000) // Poll every 10 seconds
    return () => clearInterval(interval)
  }, [])

  async function fetchConversations() {
    try {
      const response = await fetch('/api/messages/conversations')
      const data = await response.json()
      setConversations(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error('Failed to fetch conversations:', error)
    }
  }

  async function sendMessage() {
    if (!newMessage.toUserId || !newMessage.message) {
      return
    }
    setSending(true)
    try {
      const response = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toUserId: newMessage.toUserId,
          message: newMessage.message,
          recordId: newMessage.recordId || undefined,
          messageType: newMessage.messageType,
        }),
      })
      if (response.ok) {
        setNewMessage({ toUserId: '', message: '', recordId: '', messageType: 'general' })
        setShowCompose(false)
        void fetchConversations()
      }
    } catch (error) {
      console.error('Failed to send message:', error)
    } finally {
      setSending(false)
    }
  }

  async function sendReply(parentMessageId: string) {
    if (!replyText || !selectedConversation) return
    setSending(true)
    try {
      const response = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toUserId: selectedConversation,
          message: replyText,
          parentMessageId,
          messageType: 'general' as MessageType,
        }),
      })
      if (response.ok) {
        setReplyText('')
        setReplyingTo(null)
        void fetchConversations()
      }
    } catch (error) {
      console.error('Failed to send reply:', error)
    } finally {
      setSending(false)
    }
  }

  const groupedBySource = useMemo(() => {
    return events.reduce<Record<string, number>>((acc, item) => {
      acc[item.source] = (acc[item.source] ?? 0) + 1
      return acc
    }, {})
  }, [events])

  const conversationMessages = useMemo(() => {
    if (!selectedConversation) return []
    const allMessages = conversations.filter(
      (msg) => msg.fromUserId === selectedConversation || msg.toUserId === selectedConversation
    )
    // Build threaded structure
    const messageMap = new Map<string, UserMessage>()
    const rootMessages: UserMessage[] = []
    
    allMessages.forEach((msg) => {
      messageMap.set(msg.id, { ...msg, replies: [] })
    })
    
    allMessages.forEach((msg) => {
      const message = messageMap.get(msg.id)!
      if (msg.parentMessageId && messageMap.has(msg.parentMessageId)) {
        const parent = messageMap.get(msg.parentMessageId)!
        if (!parent.replies) parent.replies = []
        parent.replies.push(message)
      } else {
        rootMessages.push(message)
      }
    })
    
    return rootMessages.sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
  }, [conversations, selectedConversation])

  function renderMessage(msg: UserMessage, isReply: boolean) {
    const isFromCurrentUser = msg.fromUserId === 'current-user' // TODO: Get actual current user ID
    return (
      <div
        className={`rounded-2xl border p-4 ${
          isFromCurrentUser
            ? 'ml-auto max-w-[80%] bg-brand/10 border-brand/20'
            : 'mr-auto max-w-[80%] bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-white/10'
        } ${isReply ? 'ml-4' : ''}`}
      >
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
              {msg.fromUsername || msg.fromUserEmail || msg.fromUserId}
            </span>
            <Badge variant={messageTypeColors[msg.messageType]} className="text-xs">
              {messageTypeLabels[msg.messageType]}
            </Badge>
          </div>
          <span className="text-xs text-slate-400">
            {new Date(msg.timestamp).toLocaleString()}
          </span>
        </div>
        <p className="text-sm text-slate-900 dark:text-white mb-2">{msg.message}</p>
        {msg.recordId && (
          <a
            href={`/records/${msg.recordId}`}
            className="text-xs text-brand hover:underline mt-1 block"
          >
            {msg.recordTitle ? `View: ${msg.recordTitle}` : 'View Record →'}
          </a>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Messages</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Real-time message stream via Kafka. Activity updates and user-to-user messaging.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setPaused((prev) => !prev)}>
            {paused ? 'Resume stream' : 'Pause stream'}
          </Button>
          <Button variant="outline" onClick={() => setShowCompose(!showCompose)}>
            {showCompose ? 'Hide' : 'New Message'}
          </Button>
        </div>
      </header>

      {/* Compose Message */}
      {showCompose && (
        <Card title="Send Message">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">
                To User ID <span className="text-rose-600">*</span>
              </label>
              <input
                type="text"
                value={newMessage.toUserId}
                onChange={(e) => setNewMessage((prev) => ({ ...prev, toUserId: e.target.value }))}
                placeholder="Enter user ID"
                className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">
                Message <span className="text-rose-600">*</span>
              </label>
              <textarea
                value={newMessage.message}
                onChange={(e) => setNewMessage((prev) => ({ ...prev, message: e.target.value }))}
                placeholder="Type your message..."
                rows={4}
                className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">
                Message Type
              </label>
              <select
                value={newMessage.messageType}
                onChange={(e) => setNewMessage((prev) => ({ ...prev, messageType: e.target.value as MessageType }))}
                className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
              >
                {Object.entries(messageTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">
                Record ID (optional)
              </label>
              <input
                type="text"
                value={newMessage.recordId}
                onChange={(e) => setNewMessage((prev) => ({ ...prev, recordId: e.target.value }))}
                placeholder="Link to a record (optional)"
                className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={sendMessage} disabled={sending || !newMessage.toUserId || !newMessage.message}>
                {sending ? 'Sending...' : 'Send Message'}
              </Button>
              <Button variant="ghost" onClick={() => setShowCompose(false)} disabled={sending}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      <section className="grid gap-5 lg:grid-cols-3">
        <Card title="Stream status" className="flex flex-col gap-3">
          <p className="text-sm">
            Status:{' '}
            <span className={connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600'}>
              {connected ? 'Connected' : 'Idle'}
            </span>
          </p>
          <p className="text-sm">Events received: {events.length}</p>
          <p className="text-sm">Kafka topic: {kafkaTopic}</p>
          <div>
            <p className="text-xs uppercase text-slate-400">Sources</p>
            <ul className="mt-1 space-y-1 text-sm text-slate-600 dark:text-slate-300">
              {Object.entries(groupedBySource).map(([source, count]) => (
                <li key={source} className="flex items-center justify-between">
                  <span>{source}</span>
                  <span>{count}</span>
                </li>
              ))}
              {events.length === 0 && <li className="text-slate-400">waiting for events…</li>}
            </ul>
          </div>
          {conversations.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-200 dark:border-white/10">
              <p className="text-xs uppercase text-slate-400 mb-2">Conversations</p>
              <ul className="space-y-1 text-sm">
                {Array.from(new Set(conversations.map((c) => c.fromUserId === 'current-user' ? c.toUserId : c.fromUserId))).map((userId) => (
                  <li key={userId}>
                    <button
                      onClick={() => setSelectedConversation(selectedConversation === userId ? null : userId)}
                      className={`w-full text-left px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 ${
                        selectedConversation === userId ? 'bg-brand/10 text-brand' : ''
                      }`}
                    >
                      {userId}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card
          title={selectedConversation ? 'Conversation' : 'Live feed'}
          description={selectedConversation 
            ? `Messages with ${selectedConversation}` 
            : 'Real-time events via Server-Sent Events (SSE). Ready for Kafka integration with database persistence.'}
          className="lg:col-span-2"
        >
          {selectedConversation ? (
            <div className="space-y-4">
              {conversationMessages.length === 0 ? (
                <p className="text-sm text-slate-400">No messages yet in this conversation.</p>
              ) : (
                <div className="space-y-4">
                  {conversationMessages.map((msg) => (
                    <div key={msg.id} className="space-y-2">
                      {renderMessage(msg, false)}
                      {msg.replies && msg.replies.length > 0 && (
                        <div className="ml-8 space-y-2 border-l-2 border-slate-200 dark:border-slate-700 pl-4">
                          {msg.replies.map((reply) => renderMessage(reply, true))}
                        </div>
                      )}
                      {replyingTo === msg.id ? (
                        <div className="ml-8 space-y-2">
                          <textarea
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            placeholder="Type your reply..."
                            rows={3}
                            className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => sendReply(msg.id)}
                              disabled={sending || !replyText}
                            >
                              {sending ? 'Sending...' : 'Send Reply'}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setReplyingTo(null)
                                setReplyText('')
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="ml-8">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setReplyingTo(msg.id)
                              setReplyText('')
                            }}
                          >
                            Reply
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="sticky bottom-0 bg-white dark:bg-slate-900 pt-4 border-t border-slate-200 dark:border-white/10">
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Type a new message..."
                  rows={3}
                  className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
                />
                <div className="flex gap-2 mt-2">
                  <Button
                    onClick={() => {
                      if (selectedConversation) {
                        const response = fetch('/api/messages/send', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            toUserId: selectedConversation,
                            message: replyText,
                            messageType: 'general' as MessageType,
                          }),
                        })
                        response.then((res) => {
                          if (res.ok) {
                            setReplyText('')
                            void fetchConversations()
                          }
                        })
                      }
                    }}
                    disabled={sending || !replyText || !selectedConversation}
                  >
                    {sending ? 'Sending...' : 'Send Message'}
                  </Button>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedConversation(null)}>
                Back to feed
              </Button>
            </div>
          ) : (
            <>
          {events.length === 0 && <p className="text-sm text-slate-400">No messages yet.</p>}
          {events.length > 0 && (
            <ul className="max-h-[520px] space-y-3 overflow-y-auto pr-2">
              {events.map((event) => (
                <li key={event.id} className="rounded-2xl border border-slate-200/80 p-4 dark:border-white/10">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">{event.source}</p>
                    <p className="text-xs text-slate-400">{new Date(event.ts).toLocaleTimeString()}</p>
                  </div>
                  <p className="mt-2 text-base font-medium capitalize text-slate-900 dark:text-white">
                    {event.event.replace(/_/g, ' ')}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                    {event.price && (
                      <span className="font-semibold text-slate-900 dark:text-white">
                        ${event.price.toFixed(2)} {event.currency}
                      </span>
                    )}
                    {event.marketplaceRef && <span>Lot #{event.marketplaceRef}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
            </>
          )}
        </Card>
      </section>
    </div>
  )
}

