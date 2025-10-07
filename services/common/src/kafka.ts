import { Kafka } from 'kafkajs'
export const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID || 'record-platform',
  brokers: [process.env.KAFKA_BROKER || 'kafka:9092']
})
