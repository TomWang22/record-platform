/* cspell:ignore grpc */
import * as grpc from '@grpc/grpc-js'
import { createRpGrpcServer } from '@common/utils/grpc-server-factory'
import * as protoLoader from '@grpc/proto-loader'
import os from 'os'
import { pool } from './lib/db.js'
import {
  makeRedis,
  cached,
  makePostKey,
  makePostsListKey,
  makeCommentsKey,
  makeMessagesKey,
  makeThreadKey,
  invalidateForumVoteCaches,
} from './lib/cache.js'
import { applyCommentVote, applyPostVote } from './lib/forumVotes.js'
import { kafka } from '@common/utils/kafka'
import { registerHealthService, createRpGrpcServerCredentialsForBind } from '@common/utils'
import { resolveProtoPath } from '@common/utils/proto'
import { buildMetadata, sendMessagingEvent } from './kafkaMessagingEvents.js'
import {
  createMessageWithOutbox,
  replyMessageWithOutbox,
} from './application/messageOutbox.js'
import { stableHumanDmThreadId } from './lib/dm-thread-id.js'

function isoTs(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value)
}

function toGrpcError(error: unknown): { code: number; message: string } {
  const message = error instanceof Error ? error.message : String(error)
  return { code: grpc.status.INTERNAL, message }
}

const PROTO_PATH = resolveProtoPath('messaging.proto')
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
})

const messagingProto = grpc.loadPackageDefinition(packageDefinition) as any
const service = messagingProto.messaging?.v1?.MessagingService?.service
if (!service) {
  throw new Error('MessagingService not found (expected package messaging.v1)')
}

// Redis for caching
const redis = makeRedis()

// CPU cores for parallel processing
const CPU_CORES = os.cpus().length
console.log(`[messaging-grpc] Using ${CPU_CORES} CPU cores for parallel processing`)

let kafkaProducer: any = null
async function getKafkaProducer() {
  if (!kafkaProducer) {
    kafkaProducer = kafka.producer()
    await Promise.race([
      kafkaProducer.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Kafka connection timeout')), 5000),
      ),
    ])
  }
  return kafkaProducer
}

// gRPC logging middleware
function withLogging(handler: any, methodName: string) {
  return async (call: any, callback: any) => {
    const start = Date.now()
    console.log(`[gRPC] ${methodName} called`)
    try {
      await handler(call, callback)
      const duration = Date.now() - start
      console.log(`[gRPC] ${methodName} completed in ${duration}ms`)
    } catch (err: any) {
      const duration = Date.now() - start
      console.error(`[gRPC] ${methodName} failed after ${duration}ms:`, err)
      callback({
        code: grpc.status.INTERNAL,
        message: err.message || 'internal error',
      })
    }
  }
}

/** Raw gRPC method implementations (unit-test via direct `call`/`callback`; server wraps with logging). */
export const messagingGrpcHandlers = {
  async ListPosts(call: any, callback: any) {
    const { user_id, page = 1, limit = 20, flair } = call.request
    const cacheKey = makePostsListKey(page, limit, flair)
    const result = await cached(
      redis,
      cacheKey,
      60_000,
      async () => ({
        posts: [],
        pagination: { page, limit, total: 0, total_pages: 0 },
      })
    )
    callback(null, result)
  },

  async GetPost(call: any, callback: any) {
    const { post_id } = call.request
    const cacheKey = makePostKey(post_id)
    const result = await cached(
      redis,
      cacheKey,
      120_000,
      async () => ({
        post: {
          id: post_id,
          user_id: 'placeholder',
          title: 'Placeholder',
          content: 'Placeholder',
          flair: 'Discussion',
          upvotes: 0,
          downvotes: 0,
          comment_count: 0,
          is_pinned: false,
          is_locked: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      })
    )
    callback(null, result)
  },

  async CreatePost(call: any, callback: any) {
    const { user_id, title, content, flair } = call.request
    if (!title || !content || !flair) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: 'title, content, and flair required',
      })
    }
    callback(null, {
      post: {
        id: 'placeholder-post-id',
        user_id,
        title,
        content,
        flair,
        upvotes: 0,
        downvotes: 0,
        comment_count: 0,
        is_pinned: false,
        is_locked: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    })
  },

  async UpdatePost(call: any, callback: any) {
    const { post_id, user_id, title, content, flair } = call.request
    callback(null, {
      post: {
        id: post_id,
        user_id,
        title: title || 'Updated',
        content: content || 'Updated',
        flair: flair || 'Discussion',
        upvotes: 0,
        downvotes: 0,
        comment_count: 0,
        is_pinned: false,
        is_locked: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    })
  },

  async DeletePost(call: any, callback: any) {
    callback(null, { success: true })
  },

  async VotePost(call: any, callback: any) {
    const { post_id, user_id, vote } = call.request
    if (!post_id || !user_id || !vote || !['up', 'down'].includes(vote)) {
      callback({ code: 3, message: 'post_id, user_id, and vote (up/down) required' })
      return
    }
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const out = await applyPostVote(client, post_id, user_id, vote as 'up' | 'down')
      await client.query('COMMIT')
      void invalidateForumVoteCaches(redis, post_id)
      callback(null, {
        post_id,
        user_id,
        vote: out.user_vote,
        upvotes: out.upvotes,
        downvotes: out.downvotes,
        user_vote: out.user_vote,
      })
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {})
      console.error('[gRPC] VotePost error:', err)
      callback({ code: 13, message: err.message || 'Failed to vote on post' })
    } finally {
      client.release()
    }
  },

  async ListComments(call: any, callback: any) {
    const { post_id } = call.request
    const cacheKey = makeCommentsKey(post_id)
    const result = await cached(
      redis,
      cacheKey,
      30_000,
      async () => ({ post_id, comments: [] })
    )
    callback(null, result)
  },

  async CreateComment(call: any, callback: any) {
    const { post_id, user_id, content, parent_id } = call.request
    try {
      const insertQuery = `
        INSERT INTO forum.comments (post_id, user_id, parent_id, content)
        VALUES ($1, $2, $3, $4)
        RETURNING id, post_id, user_id, parent_id, content, upvotes, downvotes,
                  created_at, updated_at
      `
      const { rows } = await pool.query(insertQuery, [post_id, user_id, parent_id || null, content])
      const comment = rows[0]

      callback(null, {
        comment: {
          id: comment.id,
          post_id: comment.post_id,
          user_id: comment.user_id,
          parent_id: comment.parent_id || '',
          content: comment.content,
          upvotes: comment.upvotes,
          downvotes: comment.downvotes,
          created_at: comment.created_at.toISOString(),
          updated_at: comment.updated_at.toISOString(),
        },
      })
    } catch (error: any) {
      console.error('[gRPC] CreateComment error:', error)
      callback({
        code: 13,
        message: error.message || 'Failed to create comment',
      })
    }
  },

  async UpdateComment(call: any, callback: any) {
    const { comment_id, user_id, content } = call.request
    callback(null, {
      comment: {
        id: comment_id,
        user_id,
        content: content || 'Updated',
        upvotes: 0,
        downvotes: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    })
  },

  async DeleteComment(call: any, callback: any) {
    callback(null, { success: true })
  },

  async VoteComment(call: any, callback: any) {
    const { comment_id, user_id, vote } = call.request
    if (!comment_id || !user_id || !vote || !['up', 'down'].includes(vote)) {
      callback({ code: 3, message: 'comment_id, user_id, and vote (up/down) required' })
      return
    }
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const out = await applyCommentVote(client, comment_id, user_id, vote as 'up' | 'down')
      await client.query('COMMIT')
      void invalidateForumVoteCaches(redis, out.post_id)
      callback(null, {
        comment_id,
        user_id,
        vote: out.user_vote,
        upvotes: out.upvotes,
        downvotes: out.downvotes,
        user_vote: out.user_vote,
      })
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {})
      const msg = err?.message || String(err)
      if (msg === 'COMMENT_NOT_FOUND') {
        callback({ code: 5, message: 'comment not found' })
        return
      }
      console.error('[gRPC] VoteComment error:', err)
      callback({ code: 13, message: msg || 'Failed to vote on comment' })
    } finally {
      client.release()
    }
  },

  async ListMessages(call: any, callback: any) {
    const { user_id, page = 1, limit = 20, message_type } = call.request
    const cacheKey = makeMessagesKey(user_id, page, limit, message_type)
    try {
      const result = await Promise.race([
        cached(
          redis,
          cacheKey,
          30_000,
          async () => ({
            messages: [],
            pagination: { page, limit, total: 0, total_pages: 0 },
          })
        ),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('ListMessages cache timeout')), 5000)
        ),
      ]) as any
      callback(null, result)
    } catch (err: any) {
      console.warn('[messaging-grpc] ListMessages cache error, returning empty result:', err?.message)
      callback(null, {
        messages: [],
        pagination: { page, limit, total: 0, total_pages: 0 },
      })
    }
  },

  async GetMessage(call: any, callback: any) {
    const { message_id } = call.request
    callback(null, {
      message: {
        id: message_id,
        sender_id: 'placeholder',
        recipient_id: 'placeholder',
        parent_message_id: '',
        thread_id: '',
        message_type: 'General',
        subject: 'Placeholder',
        content: 'Placeholder',
        is_read: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    })
  },

  async SendMessage(call: any, callback: any) {
    const { sender_id, recipient_id, message_type, subject, content, parent_message_id } = call.request
    if (!sender_id || !recipient_id || !message_type || !subject || !content) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: 'sender_id, recipient_id, message_type, subject, and content required',
      })
    }

    try {
      const parentId =
        parent_message_id != null && String(parent_message_id).trim()
          ? String(parent_message_id).trim()
          : null
      let threadId: string | null = null
      try {
        threadId = stableHumanDmThreadId(String(sender_id), String(recipient_id))
      } catch {
        threadId = null
      }

      const { message } = await createMessageWithOutbox(pool, {
        senderId: String(sender_id),
        recipientId: String(recipient_id),
        groupId: null,
        parentMessageId: parentId,
        threadId,
        messageType: String(message_type),
        subject: String(subject),
        content: String(content),
        // Preserve prior gRPC partition key: recipient_id
        partitionKey: String(recipient_id),
      })

      callback(null, {
        message: {
          id: message.id,
          sender_id: message.sender_id,
          recipient_id: message.recipient_id ?? '',
          parent_message_id: message.parent_message_id ?? '',
          thread_id: message.thread_id ?? '',
          message_type: message.message_type,
          subject: message.subject,
          content: message.content,
          is_read: false,
          created_at: isoTs(message.created_at),
          updated_at: isoTs(message.updated_at),
        },
      })
    } catch (error) {
      callback(toGrpcError(error))
    }
  },

  async ReplyMessage(call: any, callback: any) {
    const { message_id, sender_id, message_type, subject, content } = call.request
    if (!content) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: 'content required',
      })
    }
    if (!message_id || !sender_id) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: 'message_id and sender_id required',
      })
    }

    try {
      const parentQuery = await pool.query(
        `SELECT id, sender_id, recipient_id, group_id, subject, thread_id, message_type
         FROM messages.messages WHERE id = $1`,
        [message_id],
      )
      if (parentQuery.rows.length === 0) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: 'Parent message not found',
        })
      }

      const parent = parentQuery.rows[0] as {
        id: string
        sender_id: string
        recipient_id: string | null
        group_id: string | null
        subject: string | null
        thread_id: string | null
        message_type: string | null
      }
      const group_id = parent.group_id
      let recipient_id: string | null = null
      let replyThreadId: string | null = null
      if (group_id) {
        recipient_id = null
        replyThreadId = parent.thread_id != null ? String(parent.thread_id) : null
      } else {
        const ps = String(parent.sender_id)
        const pr = parent.recipient_id != null ? String(parent.recipient_id) : ''
        const peer = ps === String(sender_id) ? pr : ps
        recipient_id = peer || null
        if (recipient_id) {
          try {
            replyThreadId = stableHumanDmThreadId(String(sender_id), recipient_id)
          } catch {
            replyThreadId = parent.thread_id != null ? String(parent.thread_id) : null
          }
        } else {
          replyThreadId = parent.thread_id != null ? String(parent.thread_id) : null
        }
      }

      const subj = group_id
        ? String(subject || '').trim() || `Re: ${parent.subject || 'Message'}`
        : String(subject || '').trim()

      const { message } = await replyMessageWithOutbox(pool, {
        senderId: String(sender_id),
        recipientId: recipient_id,
        groupId: group_id != null ? String(group_id) : null,
        parentMessageId: String(message_id),
        threadId: replyThreadId,
        messageType: String(message_type || parent.message_type || 'General'),
        subject: subj,
        content: String(content),
        // Preserve prior gRPC partition key: parent message_id
        partitionKey: String(message_id),
        causationId: String(message_id),
      })

      callback(null, {
        message: {
          id: message.id,
          sender_id: message.sender_id,
          recipient_id: message.recipient_id ?? '',
          parent_message_id: message.parent_message_id ?? String(message_id),
          thread_id: message.thread_id ?? '',
          message_type: message.message_type,
          subject: message.subject,
          content: message.content,
          is_read: false,
          created_at: isoTs(message.created_at),
          updated_at: isoTs(message.updated_at),
        },
      })
    } catch (error) {
      callback(toGrpcError(error))
    }
  },

  async UpdateMessage(call: any, callback: any) {
    const { message_id, user_id, subject, content } = call.request
    const updatedAt = new Date().toISOString()
    const producer = await getKafkaProducer()
    await sendMessagingEvent(producer, message_id, {
      metadata: buildMetadata({
        event_type: 'MessageUpdated',
        aggregate_id: message_id,
        aggregate_type: 'message',
      }),
      message_id,
      subject: subject || 'Updated',
      content: content || 'Updated',
      updated_at: updatedAt,
    })
    callback(null, {
      message: {
        id: message_id,
        sender_id: user_id,
        subject: subject || 'Updated',
        content: content || 'Updated',
        updated_at: updatedAt,
      },
    })
  },

  async DeleteMessage(call: any, callback: any) {
    const { message_id } = call.request
    const deletedAt = new Date().toISOString()
    const producer = await getKafkaProducer()
    await sendMessagingEvent(producer, message_id, {
      metadata: buildMetadata({
        event_type: 'MessageDeleted',
        aggregate_id: message_id,
        aggregate_type: 'message',
      }),
      message_id,
      deleted_at: deletedAt,
    })
    callback(null, { success: true })
  },

  async GetThread(call: any, callback: any) {
    const { thread_id } = call.request
    const cacheKey = makeThreadKey(thread_id)
    const result = await cached(
      redis,
      cacheKey,
      60_000,
      async () => ({ thread_id, messages: [] })
    )
    callback(null, result)
  },

  async MarkMessageRead(call: any, callback: any) {
    const { message_id, user_id } = call.request
    const readAt = new Date().toISOString()
    if (message_id && user_id) {
      const producer = await getKafkaProducer()
      await sendMessagingEvent(producer, message_id, {
        metadata: buildMetadata({
          event_type: 'MessageMarkedRead',
          aggregate_id: message_id,
          aggregate_type: 'message',
        }),
        message_id,
        user_id,
        read_at: readAt,
      })
    }
    callback(null, { success: true })
  },

  async HealthCheck(call: any, callback: any) {
    try {
      await pool.query('SELECT 1')
      callback(null, { healthy: true, version: '0.1.0' })
    } catch (err) {
      callback(null, { healthy: false, version: '0.1.0' })
    }
  },
}

/** K8s grpc-health-probe (same logic as `registerHealthService` callback on the server). */
export async function messagingGrpcHealthProbe(): Promise<boolean> {
  try {
    await pool.query('SELECT 1')
    return true
  } catch (err) {
    console.error('[messaging] Health check failed:', err)
    return false
  }
}

// Wrap all handlers with logging
const wrappedHandlers: any = {}
for (const [method, handler] of Object.entries(messagingGrpcHandlers)) {
  wrappedHandlers[method] = withLogging(handler, method)
}

export function startGrpcServer(port: number) {
  const server = createRpGrpcServer({
    'grpc.keepalive_time_ms': 30000,
    'grpc.keepalive_timeout_ms': 5000,
    'grpc.keepalive_permit_without_calls': 1,
    'grpc.http2.max_pings_without_data': 0,
    'grpc.http2.min_time_between_pings_ms': 10000,
    'grpc.http2.min_ping_interval_without_data_ms': 300000,
  })
  server.addService(service, wrappedHandlers)

  registerHealthService(server, 'messaging.v1.MessagingService')

  // Enable gRPC reflection for tooling (grpcurl, etc.)
  if (process.env.ENABLE_GRPC_REFLECTION !== 'false') {
    try {
      const { enableReflection } = require('@common/utils/grpc-reflection')
      enableReflection(server, [PROTO_PATH], ['messaging.v1.MessagingService'])
    } catch (err) {
      console.warn('[messaging gRPC] Failed to enable reflection:', err)
    }
  }

  let credentials: grpc.ServerCredentials
  try {
    credentials = createRpGrpcServerCredentialsForBind('messaging gRPC')
  } catch (e) {
    console.error(e)
    process.exit(1)
  }

  server.bindAsync(`0.0.0.0:${port}`, credentials, (err, actualPort) => {
    if (err) {
      console.error('[messaging] gRPC server bind failed:', err)
      return
    }
    console.log(`[messaging] gRPC server listening on port ${actualPort} (HTTP/2 only)`)
  })

  process.on('SIGTERM', async () => {
    console.log('[messaging] gRPC server shutting down...')
    server.forceShutdown()
    if (kafkaProducer) {
      await kafkaProducer.disconnect()
    }
    if (redis) {
      try {
        await redis.disconnect()
      } catch (err) {
        console.warn('[messaging] Redis disconnect error (non-fatal):', err)
      }
    }
  })
}
