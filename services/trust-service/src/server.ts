import "./otel-bootstrap.js";
import "dotenv/config";
import {
  userLifecycleV1Topic,
  installShutdownSignalHandlers,
  setRpBuildInfoMetric,
} from "@common/utils";
import { ensureKafkaBrokerReady } from "@common/utils/kafka";
import { pool, warmupTrustDb } from "./db.js";
import { startGrpcServer } from "./grpc-server.js";
import { startTrustHttpServer } from "./http-server.js";
import { startTrustUserLifecycleConsumer } from "./user-lifecycle-consumer.js";
import { startTrustOutboxPublisher } from "./outbox/publishOutbox.js";

const HTTP_PORT = Number(process.env.HTTP_PORT || "4016");
const GRPC_PORT = Number(process.env.GRPC_PORT || "50066");

async function main() {
  installShutdownSignalHandlers({ service: "trust-service" });
  setRpBuildInfoMetric("trust-service");
  // gRPC before HTTP so /readyz local mTLS health check can reach a listening server.
  startGrpcServer(GRPC_PORT);
  startTrustHttpServer(HTTP_PORT);

  void (async () => {
    try {
      await ensureKafkaBrokerReady("trust-service", {
        requiredTopics: [userLifecycleV1Topic()],
      });
    } catch (e) {
      console.error("[trust-service] Kafka not ready (consumer deferred):", e);
    }
    void warmupTrustDb().catch((err) => {
      console.error("[trust-service] DB warmup failed (non-fatal)", err);
    });
    // Default OFF: TRUST_OUTBOX_PUBLISHER must be exactly "1". Reuse the
    // existing trust pool — do not open a second pool for the drain.
    startTrustOutboxPublisher(pool);
    void startTrustUserLifecycleConsumer().catch((e) =>
      console.error("[trust-service] user lifecycle consumer:", e),
    );
  })();
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
