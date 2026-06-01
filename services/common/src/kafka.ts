import { Kafka } from 'kafkajs'
import * as fs from 'fs'
import { recordKafkaPartitionLeaderMetrics } from "./kafkaLeaderMetrics.js";

/**
 * Optional isolation suffix for tests/CI. Appended to default topic names when env vars are unset.
 * Producers and consumers must share the same OCH_KAFKA_TOPIC_SUFFIX (or RP_KAFKA_TOPIC_SUFFIX).
 */
export function ochKafkaTopicIsolationSuffix(): string {
  const raw = (process.env.RP_KAFKA_TOPIC_SUFFIX || process.env.OCH_KAFKA_TOPIC_SUFFIX || "").trim();
  if (!raw) return "";
  const cleaned = raw.replace(/^\.+/, "");
  return cleaned ? `.${cleaned}` : "";
}

// Strict TLS configuration: no cleartext. All Kafka client connections use SSL (port 9093).
// Set KAFKA_SSL_ENABLED=true to enable TLS connections (required by platform policy).
// When enabled, must provide KAFKA_CA_CERT; optionally KAFKA_CLIENT_CERT/KAFKA_CLIENT_KEY for mTLS.
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
    
    // Strict TLS: do not fall back to PLAINTEXT when SSL is enabled. Require at least CA or client cert.
    if (!config.ca && !config.cert) {
      const msg = '[kafka] KAFKA_SSL_ENABLED=true but no certificates provided. Set KAFKA_CA_CERT (and optionally KAFKA_CLIENT_CERT/KAFKA_CLIENT_KEY for mTLS). No plaintext fallback.'
      console.error(msg)
      throw new Error(msg)
    }

    return config
  } catch (error) {
    console.error('[kafka] Error loading SSL certificates:', error)
    throw error
  }
})() : undefined

// Determine broker port based on SSL configuration
const brokerPort = sslConfig ? '9093' : '9092'
const rawBrokers = (process.env.KAFKA_BROKER || '').trim()
const brokers = rawBrokers
  ? rawBrokers
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => (entry.includes(':') ? entry : `${entry}:${brokerPort}`))
  : [`kafka:${brokerPort}`]

export const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID || 'record-platform',
  brokers,
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

export type EnsureKafkaBrokerReadyOptions = {
  requiredTopics?: string[];
};

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ensureKafkaBrokerReady(
  serviceLabel: string,
  options?: EnsureKafkaBrokerReadyOptions,
): Promise<void> {
  const budgetMs = Number(process.env.RP_KAFKA_STARTUP_BARRIER_MS || process.env.OCH_KAFKA_STARTUP_BARRIER_MS || "120000");
  const minRetryMs = Number(process.env.RP_KAFKA_STARTUP_RETRY_MIN_MS || process.env.OCH_KAFKA_STARTUP_RETRY_MIN_MS || "1000");
  const maxRetryMs = Number(process.env.RP_KAFKA_STARTUP_RETRY_MAX_MS || process.env.OCH_KAFKA_STARTUP_RETRY_MAX_MS || "8000");
  const deadline = Date.now() + budgetMs;
  const fromEnv =
    (process.env.RP_KAFKA_STARTUP_REQUIRED_TOPICS || process.env.OCH_KAFKA_STARTUP_REQUIRED_TOPICS || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean) ?? [];
  const requiredTopics = [...new Set([...(options?.requiredTopics ?? []), ...fromEnv])];

  let attempt = 0;
  let lastErr: unknown;

  while (Date.now() < deadline) {
    attempt += 1;
    const admin = kafka.admin();
    try {
      await admin.connect();
      try {
        const topics = await admin.listTopics();
        if (requiredTopics.length > 0) {
          const missing = requiredTopics.filter((t) => !topics.includes(t));
          if (missing.length > 0) {
            throw new Error(
              `Required Kafka topics missing: ${missing.join(", ")}. Create them before starting services.`,
            );
          }
        }
        await recordKafkaPartitionLeaderMetrics(admin);
      } finally {
        try {
          await admin.disconnect();
        } catch {
          /* ignore */
        }
      }
      console.log(`[kafka] broker ready (${serviceLabel})`);
      return;
    } catch (e) {
      lastErr = e;
      try {
        await admin.disconnect();
      } catch {
        /* ignore */
      }
      if (Date.now() >= deadline) {
        break;
      }
      const backoff = Math.min(maxRetryMs, Math.floor(minRetryMs * 1.35 ** Math.min(attempt, 14)));
      console.warn(
        `[kafka] connect/metadata attempt ${attempt} failed for ${serviceLabel}; retry in ${backoff}ms (${e instanceof Error ? e.message : String(e)})`,
      );
      await sleepMs(backoff);
    }
  }

  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  console.error(`[kafka] FATAL: broker not reachable for ${serviceLabel}:`, msg);
  throw new Error(`[${serviceLabel}] Kafka broker required but unavailable: ${msg}`);
}

export async function checkKafkaConnectivity(): Promise<boolean> {
  const admin = kafka.admin();
  try {
    await admin.connect();
    await admin.disconnect();
    return true;
  } catch {
    return false;
  }
}
