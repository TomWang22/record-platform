import { NextRequest } from 'next/server'

// For Next.js running on the host, we always use localhost:29092
// (not kafka:9092 which is for Docker-internal connections)
const { Kafka } = require('kafkajs')

// Kafka consumer for real-time analytics events
// This endpoint streams events from Kafka topics to the frontend via Server-Sent Events (SSE)

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  // Create a readable stream for Server-Sent Events
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      
      // Send initial connection message
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected', message: 'Kafka stream connected' })}\n\n`))
      
      let consumer: any = null
      let isRunning = true
      
      try {
        // Create Kafka consumer with timeout
        // Always use localhost:29092 for Next.js (host machine), not kafka:9092 (Docker-internal)
        const broker = process.env.KAFKA_BROKER || 'localhost:29092'
        
        const kafka = new Kafka({
          clientId: 'frontend-kafka-stream',
          brokers: [broker],
          connectionTimeout: 5000,
          requestTimeout: 5000,
          retry: {
            retries: 2,
            initialRetryTime: 100,
            maxRetryTime: 300,
          },
        })
        
        consumer = kafka.consumer({ groupId: 'frontend-analytics-stream' })
        
        // Connect with timeout
        const connectPromise = consumer.connect()
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Kafka connection timeout')), 5000)
        )
        await Promise.race([connectPromise, timeoutPromise])
        
        // Subscribe to analytics topics
        await consumer.subscribe({
          topics: ['analytics-predictions', 'analytics-searches'],
          fromBeginning: false, // Only get new messages
        })
        
        // Start consuming messages
        await consumer.run({
          eachMessage: async ({ topic, partition, message }: any) => {
            if (!isRunning) return
            
            try {
              const event = {
                type: 'event',
                topic,
                partition,
                timestamp: message.timestamp,
                key: message.key?.toString(),
                value: JSON.parse(message.value?.toString() || '{}'),
              }
              
              // Send event to client
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
            } catch (error) {
              console.error('[kafka-stream] Error processing message:', error)
            }
          },
        })
      } catch (error) {
        console.error('[kafka-stream] Kafka consumer error:', error)
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', message: 'Kafka connection failed' })}\n\n`)
        )
      }
      
      // Handle client disconnect
      request.signal.addEventListener('abort', () => {
        isRunning = false
        if (consumer) {
          consumer.disconnect().catch(console.error)
        }
        controller.close()
      })
    },
  })
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  })
}

