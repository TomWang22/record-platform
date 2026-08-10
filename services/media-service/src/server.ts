import './otel-bootstrap.js'
import { userLifecycleV1Topic, installShutdownSignalHandlers, setRpBuildInfoMetric } from '@common/utils'
import { ensureKafkaBrokerReady } from '@common/utils/kafka'
import { pool } from './db/mediaRepo.js'
import { startGrpcServer } from './grpc-server.js'
import { startMediaHttpServer } from './http-server.js'
import { startMediaOutboxPublisher } from './outbox/publishOutbox.js'
import { startMediaUserLifecycleConsumer } from './user-lifecycle-consumer.js'

const grpcPort = parseInt(process.env.GRPC_PORT || '50052', 10)
const httpPort = parseInt(process.env.HTTP_PORT || '4018', 10)

async function main() {
  installShutdownSignalHandlers({ service: 'media-service' })
  setRpBuildInfoMetric('media-service')
  await ensureKafkaBrokerReady('media-service', { requiredTopics: [userLifecycleV1Topic()] })
  console.log(
    `[media-service] starting HTTP on ${httpPort}, gRPC on ${grpcPort} (NODE_ENV=${process.env.NODE_ENV || 'unset'})`
  )
  startMediaHttpServer(httpPort)
  startGrpcServer(grpcPort)
  // Opt-in only (MEDIA_OUTBOX_PUBLISHER===1); default OFF — no live produce.
  startMediaOutboxPublisher(pool)
  setImmediate(() => {
    void startMediaUserLifecycleConsumer().catch((e) =>
      console.error('[media-service] user lifecycle consumer:', e),
    )
  })
}

void main().catch((e) => {
  console.error('[media-service] fatal startup error:', e)
  process.exit(1)
})
