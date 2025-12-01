'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, MouseEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AttachmentUpload, type AttachmentFile } from '@/components/ui/attachment-upload'
import { Users, Plus, LogOut, Image as ImageIcon } from 'lucide-react'

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

type Attachment = {
  id: string
  file_url: string
  thumbnail_url?: string
  file_name?: string
  file_type: 'image' | 'video' | 'audio' | 'document' | 'other'
  width?: number
  height?: number
}

type Group = {
  id: string
  name: string
  description?: string
  created_by: string
  created_at: string
  updated_at: string
  role?: string
  joined_at?: string
  members?: Array<{ user_id: string; role: string; joined_at: string }>
}

type UserMessage = {
  id: string
  sender_id?: string
  recipient_id?: string
  group_id?: string
  fromUserId?: string
  fromUserEmail?: string
  fromUsername?: string
  toUserId?: string
  toUserEmail?: string
  toUsername?: string
  message?: string
  content?: string
  subject?: string
  messageType: MessageType
  message_type?: string
  recordId?: string
  recordTitle?: string
  parentMessageId?: string
  parent_message_id?: string
  parent_message?: UserMessage
  timestamp: string
  created_at?: string
  read: boolean
  is_read?: boolean
  replies?: UserMessage[]
  attachments?: Attachment[]
  group_name?: string
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
  const [groups, setGroups] = useState<Group[]>([])
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [newGroup, setNewGroup] = useState({ name: '', description: '' })
  const [messageAttachments, setMessageAttachments] = useState<AttachmentFile[]>([])
  const [viewMode, setViewMode] = useState<'p2p' | 'group' | 'activity'>('p2p')

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
    void fetchGroups()
    const interval = setInterval(() => {
      void fetchConversations()
      if (viewMode === 'group') {
        void fetchGroups()
      }
    }, 10000) // Poll every 10 seconds
    return () => clearInterval(interval)
  }, [viewMode])

  async function fetchConversations() {
    try {
      const response = await fetch('/api/messages/conversations')
      const data = await response.json()
      const messages = data.messages || Array.isArray(data) ? (data.messages || data) : []
      // Fetch attachments for each message
      const messagesWithAttachments = await Promise.all(
        messages.map(async (msg: UserMessage) => {
          try {
            const attResponse = await fetch(`/api/messages/${msg.id}/attachments`)
            if (attResponse.ok) {
              const attData = await attResponse.json()
              return { ...msg, attachments: attData.attachments || [] }
            }
          } catch (err) {
            console.error(`Failed to fetch attachments for message ${msg.id}:`, err)
          }
          return { ...msg, attachments: [] }
        })
      )
      setConversations(messagesWithAttachments)
    } catch (error) {
      console.error('Failed to fetch conversations:', error)
    }
  }

  async function fetchGroups() {
    try {
      const response = await fetch('/api/messages/groups')
      if (response.ok) {
        const data = await response.json()
        setGroups(data.groups || [])
      }
    } catch (error) {
      console.error('Failed to fetch groups:', error)
    }
  }

  async function createGroup() {
    if (!newGroup.name) return
    setSending(true)
    try {
      const response = await fetch('/api/messages/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newGroup),
      })
      if (response.ok) {
        setNewGroup({ name: '', description: '' })
        setShowCreateGroup(false)
        void fetchGroups()
      }
    } catch (error) {
      console.error('Failed to create group:', error)
    } finally {
      setSending(false)
    }
  }

  async function leaveGroup(groupId: string) {
    if (!confirm('Are you sure you want to leave this group?')) return
    try {
      const response = await fetch(`/api/messages/groups/${groupId}/leave`, {
        method: 'DELETE',
      })
      if (response.ok) {
        if (selectedGroup === groupId) {
          setSelectedGroup(null)
        }
        void fetchGroups()
      }
    } catch (error) {
      console.error('Failed to leave group:', error)
    }
  }

  async function sendMessage(groupId?: string) {
    const recipientId = groupId ? undefined : newMessage.toUserId
    const groupIdToUse = groupId || undefined
    const content = newMessage.message || replyText

    if ((!recipientId && !groupIdToUse) || !content) {
      return
    }
    setSending(true)
    try {
      const response = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient_id: recipientId,
          group_id: groupIdToUse,
          message_type: newMessage.messageType || 'general',
          subject: newMessage.messageType || 'Message',
          content,
          parent_message_id: replyingTo || undefined,
        }),
      })
      if (response.ok) {
        const messageData = await response.json()
        // Upload attachments if any
        if (messageAttachments.length > 0) {
          for (const attachment of messageAttachments) {
            try {
              await fetch(`/api/messages/${messageData.id}/attachments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  file_url: attachment.file_url || URL.createObjectURL(attachment.file),
                  file_type: attachment.file_type,
                  file_name: attachment.file_name,
                  file_size: attachment.file_size,
                  mime_type: attachment.mime_type,
                  thumbnail_url: attachment.thumbnail_url,
                }),
              })
            } catch (err) {
              console.error('Failed to upload message attachment:', err)
            }
          }
        }
        setNewMessage({ toUserId: '', message: '', recordId: '', messageType: 'general' })
        setReplyText('')
        setReplyingTo(null)
        setMessageAttachments([])
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
    if (!replyText || (!selectedConversation && !selectedGroup)) return
    await sendMessage(selectedGroup || undefined)
  }

  const groupedBySource = useMemo(() => {
    return events.reduce<Record<string, number>>((acc, item) => {
      acc[item.source] = (acc[item.source] ?? 0) + 1
      return acc
    }, {})
  }, [events])

  const conversationMessages = useMemo(() => {
    if (!selectedConversation && !selectedGroup) return []
    const allMessages = conversations.filter((msg) => {
      if (selectedGroup) {
        return msg.group_id === selectedGroup
      }
      const senderId = msg.sender_id || msg.fromUserId
      const recipientId = msg.recipient_id || msg.toUserId
      return senderId === selectedConversation || recipientId === selectedConversation
    })
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
        {msg.parent_message && (
          <div className="mb-2 p-2 bg-slate-200 dark:bg-slate-700 rounded text-xs border-l-2 border-brand">
            <p className="font-medium">Replying to:</p>
            <p className="text-slate-600 dark:text-slate-300 truncate">
              {msg.parent_message.content || msg.parent_message.message || 'Message'}
            </p>
          </div>
        )}
        <p className="text-sm text-slate-900 dark:text-white mb-2">
          {msg.content || msg.message}
        </p>
        {msg.attachments && msg.attachments.length > 0 && (
          <div className="grid grid-cols-2 gap-2 my-2">
            {msg.attachments.map((att: Attachment) => (
              <div key={att.id} className="rounded-lg overflow-hidden border border-slate-200 dark:border-white/10">
                {att.file_type === 'image' && (
                  <img
                    src={att.thumbnail_url || att.file_url}
                    alt={att.file_name || 'Attachment'}
                    className="w-full h-32 object-cover cursor-pointer hover:opacity-80"
                    onClick={() => window.open(att.file_url, '_blank')}
                  />
                )}
                {att.file_type === 'video' && (
                  <video
                    src={att.file_url}
                    controls
                    className="w-full h-32 object-cover"
                  />
                )}
                {att.file_type !== 'image' && att.file_type !== 'video' && (
                  <div className="p-2 bg-slate-100 dark:bg-slate-800 flex items-center gap-2">
                    <ImageIcon className="h-4 w-4" />
                    <a
                      href={att.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs truncate hover:text-brand"
                    >
                      {att.file_name || 'Attachment'}
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
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
          <Button
            variant={viewMode === 'p2p' ? 'default' : 'outline'}
            onClick={() => setViewMode('p2p')}
          >
            P2P Messages
          </Button>
          <Button
            variant={viewMode === 'group' ? 'default' : 'outline'}
            onClick={() => setViewMode('group')}
          >
            <Users className="h-4 w-4 mr-2" />
            Groups
          </Button>
          <Button
            variant={viewMode === 'activity' ? 'default' : 'outline'}
            onClick={() => setViewMode('activity')}
          >
            Activity
          </Button>
          {viewMode === 'group' && (
            <Button variant="outline" onClick={() => setShowCreateGroup(!showCreateGroup)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Group
            </Button>
          )}
          {viewMode === 'p2p' && (
            <Button variant="outline" onClick={() => setShowCompose(!showCompose)}>
              {showCompose ? 'Hide' : 'New Message'}
            </Button>
          )}
        </div>
      </header>

      {/* Create Group */}
      {showCreateGroup && viewMode === 'group' && (
        <Card title="Create Group">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">
                Group Name <span className="text-rose-600">*</span>
              </label>
              <input
                type="text"
                value={newGroup.name}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setNewGroup((prev: { name: string; description: string }) => ({ ...prev, name: e.target.value }))}
                placeholder="Enter group name"
                className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">
                Description (optional)
              </label>
              <textarea
                value={newGroup.description}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNewGroup((prev: { name: string; description: string }) => ({ ...prev, description: e.target.value }))}
                placeholder="Group description..."
                rows={3}
                className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={createGroup} disabled={sending || !newGroup.name}>
                {sending ? 'Creating...' : 'Create Group'}
              </Button>
              <Button variant="ghost" onClick={() => setShowCreateGroup(false)} disabled={sending}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Compose Message */}
      {showCompose && viewMode === 'p2p' && (
        <Card title="Send Message">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">
                To User ID <span className="text-rose-600">*</span>
              </label>
              <input
                type="text"
                value={newMessage.toUserId}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setNewMessage((prev: { toUserId: string; message: string; recordId: string; messageType: MessageType }) => ({ ...prev, toUserId: e.target.value }))}
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
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNewMessage((prev: { toUserId: string; message: string; recordId: string; messageType: MessageType }) => ({ ...prev, message: e.target.value }))}
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
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setNewMessage((prev: { toUserId: string; message: string; recordId: string; messageType: MessageType }) => ({ ...prev, messageType: e.target.value as MessageType }))}
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
                onChange={(e: ChangeEvent<HTMLInputElement>) => setNewMessage((prev: { toUserId: string; message: string; recordId: string; messageType: MessageType }) => ({ ...prev, recordId: e.target.value }))}
                placeholder="Link to a record (optional)"
                className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">
                Attachments (optional)
              </label>
              <AttachmentUpload
                onAttachmentsChange={setMessageAttachments}
                maxAttachments={10}
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

      {viewMode === 'group' && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {groups.length === 0 ? (
            <Card>
              <p className="text-sm text-slate-400 text-center py-8">No groups yet. Create one to get started!</p>
            </Card>
          ) : (
            groups.map((group: Group) => (
              <div key={group.id} onClick={() => setSelectedGroup(group.id)}>
                <Card className="cursor-pointer hover:shadow-lg transition-shadow">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-slate-900 dark:text-white">{group.name}</h3>
                  {group.role === 'admin' && (
                    <Badge variant="primary" className="text-xs">Admin</Badge>
                  )}
                </div>
                {group.description && (
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 line-clamp-2">
                    {group.description}
                  </p>
                )}
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>Created {new Date(group.created_at).toLocaleDateString()}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e: MouseEvent<HTMLButtonElement>) => {
                      e.stopPropagation()
                      void leaveGroup(group.id)
                    }}
                    className="text-rose-600 hover:text-rose-700"
                  >
                    <LogOut className="h-3 w-3 mr-1" />
                    Leave
                  </Button>
                </div>
                </Card>
              </div>
            ))
          )}
        </div>
      )}

      {selectedGroup && viewMode === 'group' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={() => setSelectedGroup(null)}>
              ← Back to Groups
            </Button>
          </div>
          <Card>
            <div className="space-y-4">
              {conversationMessages.length === 0 ? (
                <p className="text-sm text-slate-400">No messages yet in this group.</p>
              ) : (
                <div className="space-y-4">
                  {conversationMessages.map((msg: UserMessage) => (
                    <div key={msg.id} className="space-y-2">
                      {renderMessage(msg, false)}
                      {msg.replies && msg.replies.length > 0 && (
                        <div className="ml-8 space-y-2 border-l-2 border-slate-200 dark:border-slate-700 pl-4">
                          {msg.replies.map((reply: UserMessage) => renderMessage(reply, true))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="sticky bottom-0 bg-white dark:bg-slate-900 pt-4 border-t border-slate-200 dark:border-white/10">
                <textarea
                  value={replyText}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setReplyText(e.target.value)}
                  placeholder="Type a message to the group..."
                  rows={3}
                  className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
                />
                <AttachmentUpload
                  onAttachmentsChange={setMessageAttachments}
                  maxAttachments={10}
                />
                <div className="flex gap-2 mt-2">
                  <Button
                    onClick={() => sendMessage(selectedGroup)}
                    disabled={sending || !replyText}
                  >
                    {sending ? 'Sending...' : 'Send Message'}
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {viewMode === 'activity' && (
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
              {Object.entries(groupedBySource).map(([source, count]: [string, number]) => (
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
                {Array.from(new Set(conversations.map((c: UserMessage) => c.fromUserId === 'current-user' ? c.toUserId : c.fromUserId))).map((userId: string) => (
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
                  {conversationMessages.map((msg: UserMessage) => (
                    <div key={msg.id} className="space-y-2">
                      {renderMessage(msg, false)}
                      {msg.replies && msg.replies.length > 0 && (
                        <div className="ml-8 space-y-2 border-l-2 border-slate-200 dark:border-slate-700 pl-4">
                          {msg.replies.map((reply: UserMessage) => renderMessage(reply, true))}
                        </div>
                      )}
                      {replyingTo === msg.id ? (
                        <div className="ml-8 space-y-2">
                          <textarea
                            value={replyText}
                            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setReplyText(e.target.value)}
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
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setReplyText(e.target.value)}
                  placeholder="Type a new message..."
                  rows={3}
                  className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
                />
                <AttachmentUpload
                  onAttachmentsChange={setMessageAttachments}
                  maxAttachments={10}
                />
                <div className="flex gap-2 mt-2">
                  <Button
                    onClick={() => sendMessage()}
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
              {events.map((event: ActivityEvent) => (
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
      )}

      {viewMode === 'p2p' && !selectedConversation && (
        <section className="grid gap-5 lg:grid-cols-3">
          <Card title="Conversations" className="flex flex-col gap-3">
            {conversations.length > 0 && (
              <ul className="space-y-1 text-sm">
                {Array.from(new Set(conversations.map((c: UserMessage) => {
                  const senderId = c.sender_id || c.fromUserId
                  const recipientId = c.recipient_id || c.toUserId
                  return senderId === 'current-user' ? recipientId : senderId
                }))).map((userId: string) => (
                  <li key={userId}>
                    <button
                      onClick={() => setSelectedConversation(userId)}
                      className={`w-full text-left px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 ${
                        selectedConversation === userId ? 'bg-brand/10 text-brand' : ''
                      }`}
                    >
                      {userId}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Select a conversation" className="lg:col-span-2">
            <p className="text-sm text-slate-400">Select a conversation from the list to start messaging.</p>
          </Card>
        </section>
      )}

      {viewMode === 'p2p' && selectedConversation && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={() => setSelectedConversation(null)}>
              ← Back to Conversations
            </Button>
          </div>
          <Card>
            <div className="space-y-4">
              {conversationMessages.length === 0 ? (
                <p className="text-sm text-slate-400">No messages yet in this conversation.</p>
              ) : (
                <div className="space-y-4">
                  {conversationMessages.map((msg: UserMessage) => (
                    <div key={msg.id} className="space-y-2">
                      {renderMessage(msg, false)}
                      {msg.replies && msg.replies.length > 0 && (
                        <div className="ml-8 space-y-2 border-l-2 border-slate-200 dark:border-slate-700 pl-4">
                          {msg.replies.map((reply: UserMessage) => renderMessage(reply, true))}
                        </div>
                      )}
                      {replyingTo === msg.id ? (
                        <div className="ml-8 space-y-2">
                          <textarea
                            value={replyText}
                            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setReplyText(e.target.value)}
                            placeholder="Type your reply..."
                            rows={3}
                            className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
                          />
                          <AttachmentUpload
                            onAttachmentsChange={setMessageAttachments}
                            maxAttachments={10}
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
                                setMessageAttachments([])
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
                              setMessageAttachments([])
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
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setReplyText(e.target.value)}
                  placeholder="Type a new message..."
                  rows={3}
                  className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
                />
                <AttachmentUpload
                  onAttachmentsChange={setMessageAttachments}
                  maxAttachments={10}
                />
                <div className="flex gap-2 mt-2">
                  <Button
                    onClick={() => sendMessage()}
                    disabled={sending || !replyText || !selectedConversation}
                  >
                    {sending ? 'Sending...' : 'Send Message'}
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

