import { Router, type Request, type Response } from 'express'
import type Redis from 'ioredis'
import type { AuthedRequest } from '../lib/auth.js''
import { cached, makeMessagesKey, makeThreadKey } from '../lib/cache.js''
import { pool } from '../lib/db.js''
import { kafka } from '@common/utils/kafka'

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

export default function messagesRouter(redis: Redis | null, cpuCores: number) {
  const router = Router()

  // GET /messages - List user's messages (inbox)
  router.get('/', async (req: AuthedRequest, res: Response) => {
    const userId = req.userId
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 20
    const type = req.query.type as string | undefined
    const offset = (page - 1) * limit

    const cacheKey = makeMessagesKey(userId!, page, limit, type)
    const result = await cached(
      redis,
      cacheKey,
      30_000, // 30 second cache (messages change frequently)
      async () => {
        try {
          // Get messages where user is recipient OR is in a group
          const query = `
            SELECT 
              m.id,
              m.sender_id,
              m.recipient_id,
              m.group_id,
              m.parent_message_id,
              m.thread_id,
              m.message_type,
              m.subject,
              m.content,
              m.is_read,
              m.created_at,
              m.updated_at,
              g.name as group_name
            FROM messages.messages m
            LEFT JOIN messages.groups g ON m.group_id = g.id
            WHERE (m.recipient_id = $1 OR m.group_id IN (
              SELECT group_id FROM messages.group_members WHERE user_id = $1
            ))
            ${type ? 'AND m.message_type = $3' : ''}
            ORDER BY m.created_at DESC
            LIMIT $${type ? '4' : '2'} OFFSET $${type ? '5' : '3'}
          `
          const params = type ? [userId, limit, type, offset] : [userId, limit, offset]
          const { rows } = await pool.query(query, params)

          // Get total count
          const countQuery = `
            SELECT COUNT(*) as total
            FROM messages.messages m
            WHERE (m.recipient_id = $1 OR m.group_id IN (
              SELECT group_id FROM messages.group_members WHERE user_id = $1
            ))
            ${type ? 'AND m.message_type = $2' : ''}
          `
          const countParams = type ? [userId, type] : [userId]
          const { rows: countRows } = await pool.query(countQuery, countParams)
          const total = parseInt(countRows[0].total, 10)

          return {
            messages: rows,
            pagination: {
              page,
              limit,
              total,
              totalPages: Math.ceil(total / limit),
            },
          }
        } catch (err) {
          console.error('[social] Error fetching messages:', err)
          throw err
        }
      }
    )

    res.json(result)
  })

  // POST /messages - Send new message (direct or group)
  router.post('/', async (req: AuthedRequest, res: Response) => {
    const { recipient_id, group_id, message_type, subject, content, parent_message_id } = req.body
    const sender_id = req.userId

    // Validate: must have either recipient_id (direct) or group_id (group), but not both
    if ((!recipient_id && !group_id) || (recipient_id && group_id)) {
      return res.status(400).json({
        error: 'Either recipient_id (direct message) or group_id (group message) required, but not both',
      })
    }

    if (!message_type || !subject || !content) {
      return res.status(400).json({
        error: 'message_type, subject, and content required',
      })
    }

    // If group message, verify user is a member
    if (group_id) {
      const memberCheck = await pool.query(
        'SELECT 1 FROM messages.group_members WHERE group_id = $1 AND user_id = $2',
        [group_id, sender_id]
      )
      if (memberCheck.rows.length === 0) {
        return res.status(403).json({ error: 'You are not a member of this group' })
      }
    }

    try {
      // Insert message into database
      const insertQuery = `
        INSERT INTO messages.messages (
          sender_id, recipient_id, group_id, parent_message_id,
          message_type, subject, content, is_read
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)
        RETURNING id, sender_id, recipient_id, group_id, parent_message_id, thread_id,
                  message_type, subject, content, is_read, created_at, updated_at
      `
      const { rows } = await pool.query(insertQuery, [
        sender_id,
        recipient_id || null,
        group_id || null,
        parent_message_id || null,
        message_type,
        subject,
        content,
      ])
      const message = rows[0]

      // Publish to Kafka for real-time delivery
      try {
        const producer = await getKafkaProducer()
        if (producer) {
          const topic = group_id ? 'group-messages' : 'messages'
          const kafkaKey = group_id || recipient_id // Use group_id or recipient_id as key

          // Get group members if group message
          let recipients: string[] = []
          if (group_id) {
            const memberQuery = await pool.query(
              'SELECT user_id FROM messages.group_members WHERE group_id = $1 AND user_id != $2',
              [group_id, sender_id]
            )
            recipients = memberQuery.rows.map((r: any) => r.user_id)
          } else if (recipient_id) {
            recipients = [recipient_id]
          }

          await producer.send({
            topic,
            messages: [
              {
                key: kafkaKey,
                value: JSON.stringify({
                  message_id: message.id,
                  sender_id,
                  recipient_id: recipient_id || null,
                  group_id: group_id || null,
                  recipients, // All recipients (for group: all members except sender)
                  message_type,
                  subject,
                  content,
                  parent_message_id: parent_message_id || null,
                  thread_id: message.thread_id,
                  timestamp: message.created_at,
                }),
              },
            ],
          })
        }
      } catch (err) {
        console.warn('[social] Kafka publish failed (non-fatal):', err)
      }

      res.status(201).json(message)
    } catch (err: any) {
      console.error('[social] Error creating message:', err)
      res.status(500).json({ error: 'Failed to create message' })
    }
  })

  // GET /messages/:messageId - Get message details
  router.get('/:messageId', async (req: AuthedRequest, res: Response) => {
    const { messageId } = req.params
    const userId = req.userId

    try {
      const query = `
        SELECT 
          m.id,
          m.sender_id,
          m.recipient_id,
          m.group_id,
          m.parent_message_id,
          m.thread_id,
          m.message_type,
          m.subject,
          m.content,
          m.is_read,
          m.created_at,
          m.updated_at,
          g.name as group_name
        FROM messages.messages m
        LEFT JOIN messages.groups g ON m.group_id = g.id
        WHERE m.id = $1
        AND (m.recipient_id = $2 OR m.sender_id = $2 OR m.group_id IN (
          SELECT group_id FROM messages.group_members WHERE user_id = $2
        ))
      `
      const { rows } = await pool.query(query, [messageId, userId])

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Message not found' })
      }

      res.json(rows[0])
    } catch (err) {
      console.error('[social] Error fetching message:', err)
      res.status(500).json({ error: 'Failed to fetch message' })
    }
  })

  // POST /messages/:messageId/reply - Reply to message (creates thread)
  router.post('/:messageId/reply', async (req: AuthedRequest, res: Response) => {
    const { messageId } = req.params
    const { message_type, subject, content } = req.body
    const sender_id = req.userId

    if (!content) {
      return res.status(400).json({ error: 'content required' })
    }

    try {
      // Get parent message to determine recipient/group
      const parentQuery = await pool.query(
        'SELECT recipient_id, group_id, sender_id FROM messages.messages WHERE id = $1',
        [messageId]
      )
      if (parentQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Parent message not found' })
      }

      const parent = parentQuery.rows[0]
      const recipient_id = parent.recipient_id || (parent.sender_id === sender_id ? null : parent.sender_id)
      const group_id = parent.group_id

      // Insert reply
      const insertQuery = `
        INSERT INTO messages.messages (
          sender_id, recipient_id, group_id, parent_message_id,
          message_type, subject, content, is_read
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)
        RETURNING id, sender_id, recipient_id, group_id, parent_message_id, thread_id,
                  message_type, subject, content, is_read, created_at, updated_at
      `
      const { rows } = await pool.query(insertQuery, [
        sender_id,
        recipient_id,
        group_id,
        messageId,
        message_type || 'General',
        subject || `Re: ${parent.subject || 'Message'}`,
        content,
      ])
      const message = rows[0]

      // Publish reply to Kafka
      try {
        const producer = await getKafkaProducer()
        if (producer) {
          const topic = group_id ? 'group-messages' : 'messages'
          const kafkaKey = group_id || recipient_id || messageId

          let recipients: string[] = []
          if (group_id) {
            const memberQuery = await pool.query(
              'SELECT user_id FROM messages.group_members WHERE group_id = $1 AND user_id != $2',
              [group_id, sender_id]
            )
            recipients = memberQuery.rows.map((r: any) => r.user_id)
          } else if (recipient_id) {
            recipients = [recipient_id]
          } else if (parent.sender_id !== sender_id) {
            recipients = [parent.sender_id]
          }

          await producer.send({
            topic,
            messages: [
              {
                key: kafkaKey,
                value: JSON.stringify({
                  message_id: message.id,
                  parent_message_id: messageId,
                  sender_id,
                  recipient_id: recipient_id || null,
                  group_id: group_id || null,
                  recipients,
                  message_type: message.message_type,
                  subject: message.subject,
                  content,
                  thread_id: message.thread_id,
                  timestamp: message.created_at,
                }),
              },
            ],
          })
        }
      } catch (err) {
        console.warn('[social] Kafka publish failed (non-fatal):', err)
      }

      res.status(201).json(message)
    } catch (err: any) {
      console.error('[social] Error replying to message:', err)
      res.status(500).json({ error: 'Failed to reply to message' })
    }
  })

  // PUT /messages/:messageId - Update message (sender only)
  router.put('/:messageId', async (req: AuthedRequest, res: Response) => {
    const { messageId } = req.params
    const { subject, content } = req.body
    const userId = req.userId

    try {
      // Verify sender owns the message
      const checkQuery = await pool.query(
        'SELECT sender_id FROM messages.messages WHERE id = $1',
        [messageId]
      )
      if (checkQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Message not found' })
      }
      if (checkQuery.rows[0].sender_id !== userId) {
        return res.status(403).json({ error: 'You can only edit your own messages' })
      }

      const updateQuery = `
        UPDATE messages.messages
        SET subject = COALESCE($1, subject),
            content = COALESCE($2, content),
            updated_at = now()
        WHERE id = $3
        RETURNING id, sender_id, recipient_id, group_id, parent_message_id, thread_id,
                  message_type, subject, content, is_read, created_at, updated_at
      `
      const { rows } = await pool.query(updateQuery, [subject, content, messageId])

      res.json(rows[0])
    } catch (err) {
      console.error('[social] Error updating message:', err)
      res.status(500).json({ error: 'Failed to update message' })
    }
  })

  // DELETE /messages/:messageId - Delete message (sender or recipient)
  router.delete('/:messageId', async (req: AuthedRequest, res: Response) => {
    const { messageId } = req.params
    const userId = req.userId

    try {
      // Verify user is sender or recipient
      const checkQuery = await pool.query(
        `SELECT sender_id, recipient_id, group_id FROM messages.messages WHERE id = $1
         AND (sender_id = $2 OR recipient_id = $2 OR group_id IN (
           SELECT group_id FROM messages.group_members WHERE user_id = $2
         ))`,
        [messageId, userId]
      )
      if (checkQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Message not found' })
      }

      await pool.query('DELETE FROM messages.messages WHERE id = $1', [messageId])
      res.status(204).end()
    } catch (err) {
      console.error('[social] Error deleting message:', err)
      res.status(500).json({ error: 'Failed to delete message' })
    }
  })

  // GET /messages/thread/:threadId - Get full thread/conversation
  router.get('/thread/:threadId', async (req: AuthedRequest, res: Response) => {
    const { threadId } = req.params
    const userId = req.userId

    const cacheKey = makeThreadKey(threadId)
    const result = await cached(
      redis,
      cacheKey,
      60_000, // 1 minute cache
      async () => {
        try {
          const query = `
            SELECT 
              m.id,
              m.sender_id,
              m.recipient_id,
              m.group_id,
              m.parent_message_id,
              m.thread_id,
              m.message_type,
              m.subject,
              m.content,
              m.is_read,
              m.created_at,
              m.updated_at
            FROM messages.messages m
            WHERE m.thread_id = $1
            AND (m.recipient_id = $2 OR m.sender_id = $2 OR m.group_id IN (
              SELECT group_id FROM messages.group_members WHERE user_id = $2
            ))
            ORDER BY m.created_at ASC
          `
          const { rows } = await pool.query(query, [threadId, userId])

          return {
            thread_id: threadId,
            messages: rows,
          }
        } catch (err) {
          console.error('[social] Error fetching thread:', err)
          throw err
        }
      }
    )

    res.json(result)
  })

  // POST /messages/:messageId/read - Mark as read
  router.post('/:messageId/read', async (req: AuthedRequest, res: Response) => {
    const { messageId } = req.params
    const userId = req.userId

    try {
      // Insert read receipt
      await pool.query(
        `INSERT INTO messages.message_reads (message_id, user_id, read_by_sender)
         VALUES ($1, $2, FALSE)
         ON CONFLICT (message_id, user_id) DO UPDATE SET read_at = now()`,
        [messageId, userId]
      )

      // Get updated message
      const { rows } = await pool.query(
        'SELECT id, is_read, updated_at FROM messages.messages WHERE id = $1',
        [messageId]
      )

      res.json({
        id: messageId,
        is_read: rows[0]?.is_read || true,
        read_at: new Date().toISOString(),
      })
    } catch (err) {
      console.error('[social] Error marking message as read:', err)
      res.status(500).json({ error: 'Failed to mark message as read' })
    }
  })

  // ============================================================
  // GROUP CHAT ENDPOINTS
  // ============================================================

  // POST /messages/groups - Create a new group
  router.post('/groups', async (req: AuthedRequest, res: Response) => {
    console.log('[social] POST /messages/groups called', { name: req.body?.name, userId: req.userId })
    const { name, description } = req.body
    const created_by = req.userId

    if (!name) {
      console.warn('[social] Group creation failed: name required')
      return res.status(400).json({ error: 'name required' })
    }

    // Check if request was aborted
    if (req.aborted) {
      console.warn('[social] Request aborted before processing group creation')
      return res.status(499).end() // 499 Client Closed Request
    }

    try {
      console.log('[social] Starting group creation query...')
      // Use pool.query directly instead of pool.connect() to avoid connection pool exhaustion
      // Add timeout to prevent hanging on slow database operations
      const groupResult = await Promise.race([
        pool.query(`
          INSERT INTO messages.groups (name, description, created_by)
          VALUES ($1, $2, $3)
          RETURNING id, name, description, created_by, created_at, updated_at
        `, [name, description || null, created_by]),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Database query timeout')), 5000)
        )
      ]) as any
      
      const group = groupResult.rows[0]
      console.log('[social] Group created:', group.id)

      // Check if request was aborted after first query
      if (req.aborted) {
        console.warn('[social] Request aborted after group creation, before adding admin')
        return res.status(499).end()
      }

      // Add creator as admin
      console.log('[social] Adding creator as admin...')
      await Promise.race([
        pool.query(
          'INSERT INTO messages.group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
          [group.id, created_by, 'admin']
        ),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Database query timeout')), 5000)
        )
      ])

      // Check if request was aborted before sending response
      if (req.aborted) {
        console.warn('[social] Request aborted before sending response')
        return res.status(499).end()
      }

      console.log('[social] Group creation successful, sending response')
      res.status(201).json(group)
    } catch (err: any) {
      // Don't send response if request was aborted
      if (req.aborted) {
        console.warn('[social] Request aborted during error handling')
        return
      }
      console.error('[social] Error creating group:', err?.message || err)
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create group', details: err?.message || 'Unknown error' })
      }
    }
  })

  // POST /messages/groups/:groupId/members - Add member to group
  router.post('/groups/:groupId/members', async (req: AuthedRequest, res: Response) => {
    const { groupId } = req.params
    const { user_id } = req.body
    const requester_id = req.userId

    if (!user_id) {
      return res.status(400).json({ error: 'user_id required' })
    }

    try {
      // Verify requester is admin or moderator
      const roleCheck = await pool.query(
        'SELECT role FROM messages.group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, requester_id]
      )
      if (roleCheck.rows.length === 0 || !['admin', 'moderator'].includes(roleCheck.rows[0].role)) {
        return res.status(403).json({ error: 'Only admins and moderators can add members' })
      }

      // Add member
      await pool.query(
        'INSERT INTO messages.group_members (group_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [groupId, user_id, 'member']
      )

      res.status(201).json({ group_id: groupId, user_id, role: 'member' })
    } catch (err: any) {
      console.error('[social] Error adding group member:', err)
      res.status(500).json({ error: 'Failed to add group member' })
    }
  })

  // GET /messages/groups/:groupId - Get group details
  router.get('/groups/:groupId', async (req: AuthedRequest, res: Response) => {
    const { groupId } = req.params
    const userId = req.userId

    try {
      // Verify user is a member
      const memberCheck = await pool.query(
        'SELECT 1 FROM messages.group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
      )
      if (memberCheck.rows.length === 0) {
        return res.status(403).json({ error: 'You are not a member of this group' })
      }

      // Get group with members
      const groupQuery = await pool.query(
        'SELECT id, name, description, created_by, created_at, updated_at FROM messages.groups WHERE id = $1',
        [groupId]
      )
      const membersQuery = await pool.query(
        'SELECT user_id, role, joined_at FROM messages.group_members WHERE group_id = $1 ORDER BY joined_at ASC',
        [groupId]
      )

      res.json({
        ...groupQuery.rows[0],
        members: membersQuery.rows,
      })
    } catch (err) {
      console.error('[social] Error fetching group:', err)
      res.status(500).json({ error: 'Failed to fetch group' })
    }
  })

  // GET /messages/groups - List user's groups
  router.get('/groups', async (req: AuthedRequest, res: Response) => {
    const userId = req.userId

    try {
      const query = `
        SELECT g.id, g.name, g.description, g.created_by, g.created_at, g.updated_at,
               gm.role, gm.joined_at
        FROM messages.groups g
        INNER JOIN messages.group_members gm ON g.id = gm.group_id
        WHERE gm.user_id = $1
        ORDER BY g.updated_at DESC
      `
      const { rows } = await pool.query(query, [userId])

      res.json({ groups: rows })
    } catch (err) {
      console.error('[social] Error fetching groups:', err)
      res.status(500).json({ error: 'Failed to fetch groups' })
    }
  })

  return router
}
