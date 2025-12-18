import { Kafka } from 'kafkajs'
import * as fs from 'fs'

// Strict TLS configuration for production
// Set KAFKA_SSL_ENABLED=true to enable TLS connections
// When enabled, must provide KAFKA_CA_CERT, KAFKA_CLIENT_CERT, KAFKA_CLIENT_KEY
const sslConfig = process.env.KAFKA_SSL_ENABLED === 'true' ? (() => {
  try {
    const config: any = {
      rejectUnauthorized: true, // Strict TLS - reject self-signed certificates
    }
    
    if (process.env.KAFKA_CA_CERT) {
      config.ca = [fs.readFileSync(process.env.KAFKA_CA_CERT, 'utf-8')]
    }
    
    if (process.env.KAFKA_CLIENT_CERT) {
      config.cert = fs.readFileSync(process.env.KAFKA_CLIENT_CERT, 'utf-8')
    }
    
    if (process.env.KAFKA_CLIENT_KEY) {
      config.key = fs.readFileSync(process.env.KAFKA_CLIENT_KEY, 'utf-8')
    }
    
    // If no certs provided, return undefined to use PLAINTEXT
    if (!config.ca && !config.cert) {
      console.warn('[kafka] KAFKA_SSL_ENABLED=true but no certificates provided, falling back to PLAINTEXT')
      return undefined
    }
    
    return config
  } catch (error) {
    console.error('[kafka] Error loading SSL certificates:', error)
    return undefined
  }
})() : undefined

// Determine broker port based on SSL configuration
const brokerPort = sslConfig ? '9093' : '9092'
const brokerHost = process.env.KAFKA_BROKER?.split(':')[0] || 'kafka'
const broker = process.env.KAFKA_BROKER || `${brokerHost}:${brokerPort}`

export const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID || 'record-platform',
  brokers: [broker],
  ssl: sslConfig,
  // Strict connection settings
  connectionTimeout: 3000,
  requestTimeout: 25000,
  retry: {
    retries: 8,
    initialRetryTime: 100,
    maxRetryTime: 30000,
  }
})
