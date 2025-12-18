/* cspell:ignore grpc */
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import * as path from 'path'
import * as fs from 'fs'
import os from 'os'
import { pool } from './lib/db.js'
import { makeRedis } from './lib/cache.js'
import { cached, makePostKey, makePostsListKey, makeCommentsKey, makeMessagesKey, makeThreadKey } from './lib/cache.js'
import { kafka } from '@common/utils/kafka'
import { registerHealthService } from '@common/utils'

// Load proto file (try both relative paths for dev vs production)
const PROTO_PATH = fs.existsSync(path.join(__dirname, '../../proto/social.proto'))
  ? path.join(__dirname, '../../proto/social.proto')
  : path.join(__dirname, '../../../proto/social.proto')
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
})

const socialProto = grpc.loadPackageDefinition(packageDefinition) as any

// Redis for caching
const redis = makeRedis()

// CPU cores for parallel processing
const CPU_CORES = os.cpus().length
console.log(`[social-grpc] Using ${CPU_CORES} CPU cores for parallel processing`)

// Kafka producer for real-time messaging (optional - fails gracefully if Kafka is unavailable)
let kafkaProducer: any = null
let kafkaConnectionFailed = false
async function getKafkaProducer() {
  if (kafkaConnectionFailed) {
    return null // Don't retry if we've already failed
  }
  if (!kafkaProducer) {
    try {
      kafkaProducer = kafka.producer()
      // Add connection timeout
      await Promise.race([
        kafkaProducer.connect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Kafka connection timeout')), 2000)
        )
      ])
    } catch (err) {
      console.warn('[social] Kafka producer connection failed (non-fatal):', (err as Error)?.message || err)
      kafkaConnectionFailed = true
      kafkaProducer = null
      return null
    }
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

// Implement SocialService
const socialService = {
  // Forum methods (placeholder implementations - will be replaced with DB queries)
  async ListPosts(call: any, callback: any) {
    const { user_id, page = 1, limit = 20, flair } = call.request
    const cacheKey = makePostsListKey(page, limit, flair)
    const result = await cached(
      redis,
      cacheKey,
      60_000, // 1 minute cache
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
      120_000, // 2 minute cache
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
    const { post_id, vote } = call.request
    callback(null, {
      post_id,
      upvotes: vote === 'up' ? 1 : 0,
      downvotes: vote === 'down' ? 1 : 0,
    })
  },

  async ListComments(call: any, callback: any) {
    const { post_id } = call.request
    const cacheKey = makeCommentsKey(post_id)
    const result = await cached(
      redis,
      cacheKey,
      30_000, // 30 second cache
      async () => ({ post_id, comments: [] })
    )
    callback(null, result)
  },

  async CreateComment(call: any, callback: any) {
    const { post_id, user_id, content, parent_id } = call.request
    try {
      // Insert comment into database
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
        code: 13, // INTERNAL
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
    const { comment_id, vote } = call.request
    callback(null, {
      comment_id,
      upvotes: vote === 'up' ? 1 : 0,
      downvotes: vote === 'down' ? 1 : 0,
    })
  },

  // Messaging methods (with Kafka integration)
  async ListMessages(call: any, callback: any) {
    const { user_id, page = 1, limit = 20, message_type } = call.request
    const cacheKey = makeMessagesKey(user_id, page, limit, message_type)
    try {
      // Add timeout wrapper to prevent hanging on slow Redis
      const result = await Promise.race([
        cached(
          redis,
          cacheKey,
          30_000, // 30 second cache
          async () => ({
            messages: [],
            pagination: { page, limit, total: 0, total_pages: 0 },
          })
        ),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('ListMessages cache timeout')), 5000)
        )
      ]) as any
      callback(null, result)
    } catch (err: any) {
      // Fallback to empty result if cache fails
      console.warn('[social-grpc] ListMessages cache error, returning empty result:', err?.message)
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
    if (!recipient_id || !message_type || !subject || !content) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: 'recipient_id, message_type, subject, and content required',
      })
    }

    // Publish to Kafka for real-time delivery (with timeout to prevent hanging)
    try {
      const producer = await getKafkaProducer()
      if (producer) {
        await Promise.race([
          producer.send({
            topic: 'messages',
            messages: [
              {
                key: recipient_id,
                value: JSON.stringify({
                  sender_id,
                  recipient_id,
                  message_type,
                  subject,
                  content,
                  parent_message_id: parent_message_id || null,
                  timestamp: new Date().toISOString(),
                }),
              },
            ],
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Kafka send timeout')), 2000)
          )
        ])
      }
    } catch (err) {
      console.warn('[social] Kafka publish failed (non-fatal):', err)
    }

    callback(null, {
      message: {
        id: 'placeholder-message-id',
        sender_id,
        recipient_id,
        parent_message_id: parent_message_id || '',
        thread_id: parent_message_id ? 'placeholder-thread-id' : '',
        message_type,
        subject,
        content,
        is_read: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    })
  },

  async ReplyMessage(call: any, callback: any) {
    const { message_id, sender_id, message_type, subject, content } = call.request
    if (!content) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: 'content required',
      })
    }

    // Publish reply to Kafka
    try {
      const producer = await getKafkaProducer()
      if (producer) {
        await producer.send({
          topic: 'messages',
          messages: [
            {
              key: message_id, // Use parent message ID as key for thread grouping
              value: JSON.stringify({
                parent_message_id: message_id,
                sender_id,
                message_type: message_type || 'General',
                subject: subject || 'Re: ...',
                content,
                timestamp: new Date().toISOString(),
              }),
            },
          ],
        })
      }
    } catch (err) {
      console.warn('[social] Kafka publish failed (non-fatal):', err)
    }

    callback(null, {
      message: {
        id: 'placeholder-reply-id',
        sender_id,
        recipient_id: 'placeholder',
        parent_message_id: message_id,
        thread_id: 'placeholder-thread-id',
        message_type: message_type || 'General',
        subject: subject || 'Re: ...',
        content,
        is_read: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    })
  },

  async UpdateMessage(call: any, callback: any) {
    const { message_id, user_id, subject, content } = call.request
    callback(null, {
      message: {
        id: message_id,
        sender_id: user_id,
        subject: subject || 'Updated',
        content: content || 'Updated',
        updated_at: new Date().toISOString(),
      },
    })
  },

  async DeleteMessage(call: any, callback: any) {
    callback(null, { success: true })
  },

  async GetThread(call: any, callback: any) {
    const { thread_id } = call.request
    const cacheKey = makeThreadKey(thread_id)
    const result = await cached(
      redis,
      cacheKey,
      60_000, // 1 minute cache
      async () => ({ thread_id, messages: [] })
    )
    callback(null, result)
  },

  async MarkMessageRead(call: any, callback: any) {
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

// Wrap all handlers with logging
const wrappedService: any = {}
for (const [method, handler] of Object.entries(socialService)) {
  wrappedService[method] = withLogging(handler, method)
}

export function startGrpcServer(port: number) {
  const server = new grpc.Server({
    'grpc.keepalive_time_ms': 30000,
    'grpc.keepalive_timeout_ms': 5000,
    'grpc.keepalive_permit_without_calls': 1,
    'grpc.http2.max_pings_without_data': 0,
    'grpc.http2.min_time_between_pings_ms': 10000,
    'grpc.http2.min_ping_interval_without_data_ms': 300000,
  })
  server.addService(socialProto.social.SocialService.service, wrappedService)

  // Register standard gRPC Health Service (grpc.health.v1.Health)
  // This enables health checks via: grpc.health.v1.Health/Check
  registerHealthService(server, "social.SocialService", async () => {
    try {
      await pool.query('SELECT 1');
      return true;
    } catch (err) {
      console.error("[gRPC] Health check failed:", err);
      return false;
    }
  });

  // Enable gRPC reflection for tooling (grpcurl, etc.)
  if (process.env.ENABLE_GRPC_REFLECTION !== "false") {
    try {
      const { enableReflection } = require("@common/utils/grpc-reflection");
      enableReflection(server, [PROTO_PATH], ["social.SocialService"]);
    } catch (err) {
      console.warn("[social gRPC] Failed to enable reflection:", err);
    }
  }

  // Try to load TLS certs (for production with ALPN = h2)
  let credentials: grpc.ServerCredentials;
  const keyPath = process.env.TLS_KEY_PATH || "/etc/certs/tls.key";
  const certPath = process.env.TLS_CERT_PATH || "/etc/certs/tls.crt";
  const caPath = process.env.TLS_CA_PATH || process.env.GRPC_CA_CERT || "/etc/certs/ca.crt";
  
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const key = fs.readFileSync(keyPath);
    const cert = fs.readFileSync(certPath);
    
    // For strict TLS: verify client certificates if CA cert exists
    let rootCerts: Buffer | null = null;
    let checkClientCert = false;
    if (fs.existsSync(caPath)) {
      rootCerts = fs.readFileSync(caPath);
      checkClientCert = true;
      console.log("[gRPC] Starting secure HTTP/2-only server with strict TLS (client cert verification)");
    } else {
      console.log("[gRPC] Starting secure HTTP/2-only server with ALPN = h2 (no client cert verification)");
    }
    
    credentials = grpc.ServerCredentials.createSsl(
      rootCerts,
      [{ private_key: key, cert_chain: cert }],
      checkClientCert as any
    );
  } else {
    console.warn("[gRPC] TLS certs not found, starting insecure server (dev only)");
    credentials = grpc.ServerCredentials.createInsecure();
  }

  server.bindAsync(`0.0.0.0:${port}`, credentials, (err, actualPort) => {
    if (err) {
      console.error('[social] gRPC server bind failed:', err)
      return
    }
    server.start()
    console.log(`[social] gRPC server listening on port ${actualPort} (HTTP/2 only)`)
  })

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('[social] gRPC server shutting down...')
    server.forceShutdown()
    if (kafkaProducer) {
      await kafkaProducer.disconnect()
    }
    if (redis) {
      try {
        // Use disconnect instead of quit to avoid writeable stream errors
        await redis.disconnect()
      } catch (err) {
        console.warn('[social] Redis disconnect error (non-fatal):', err)
      }
    }
  })
}

