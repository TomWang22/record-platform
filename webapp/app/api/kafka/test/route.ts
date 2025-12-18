import { NextRequest } from 'next/server'

// Test Kafka connectivity
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const { Kafka } = require('kafkajs')
    
    // Use the PLAINTEXT_HOST listener for external connections
    const broker = process.env.KAFKA_BROKER || 'localhost:29092'
    
    const kafka = new Kafka({
      clientId: 'frontend-kafka-test',
      brokers: [broker],
      connectionTimeout: 5000,
      requestTimeout: 5000,
      retry: {
        retries: 2,
        initialRetryTime: 100,
        maxRetryTime: 300,
      },
    })
    
    const admin = kafka.admin()
    
    // Add timeout to connection
    const connectPromise = admin.connect()
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), 5000)
    )
    
    await Promise.race([connectPromise, timeoutPromise])
    
    const topics = await admin.listTopics()
    
    await admin.disconnect()
    
    return Response.json({
      ok: true,
      message: 'Kafka connection successful',
      topics: topics.filter((t: string) => !t.startsWith('_')),
      broker,
    })
  } catch (error: any) {
    return Response.json(
      {
        ok: false,
        message: 'Kafka connection failed',
        error: error.message,
        broker: process.env.KAFKA_BROKER || 'localhost:29092',
        hint: 'Make sure Kafka is running: docker-compose up -d kafka zookeeper',
      },
      { status: 500 }
    )
  }
}

