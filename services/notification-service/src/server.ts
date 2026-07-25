import "./otel-bootstrap.js";
import "dotenv/config";
import { userLifecycleV1Topic, installShutdownSignalHandlers } from "@common/utils";
import { ensureKafkaBrokerReady } from "@common/utils/kafka";
import { startGrpcServer } from "./grpc-server.js";
import { startNotificationHttpServer } from "./http-server.js";
import { pool } from "./db.js";
import { notificationKafkaTopics, startNotificationConsumer } from "./kafka-consumer.js";
import { startNotificationUserLifecycleConsumer } from "./user-lifecycle-consumer.js";

const HTTP_PORT = Number(process.env.HTTP_PORT || "4015");
const GRPC_PORT = Number(process.env.GRPC_PORT || "50065");

async function main() {
  installShutdownSignalHandlers({ service: "notification-service" });
  startNotificationHttpServer(HTTP_PORT);
  startGrpcServer(GRPC_PORT);
  void (async () => {
    try {
      await ensureKafkaBrokerReady("notification-service", {
        requiredTopics: [...notificationKafkaTopics(), userLifecycleV1Topic()],
      });
    } catch (e) {
      console.error("[notification-service] Kafka not ready (consumer deferred):", e);
    }
  })();
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Defer Kafka consumer so HTTP+gRPC listeners register first.
setImmediate(() => {
  void startNotificationConsumer(pool).then((c) => {
    if (c) {
      const shutdown = async () => {
        try {
          await c.disconnect();
        } catch {
          /* ignore */
        }
        process.exit(0);
      };
      process.on("SIGTERM", shutdown);
      process.on("SIGINT", shutdown);
    }
  });
  void startNotificationUserLifecycleConsumer(pool).catch((e) =>
    console.error("[notification-service] user lifecycle consumer:", e),
  );
});
