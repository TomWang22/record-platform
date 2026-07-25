import * as grpc from "@grpc/grpc-js";
import { createRpGrpcServer } from "@common/utils/grpc-server-factory";
import * as protoLoader from "@grpc/proto-loader";
import {
  registerHealthService,
  resolveProtoPath,
  createRpGrpcServerCredentialsForBind,
} from "@common/utils";
import { pool } from "./db.js";

const NOTIF_PROTO = resolveProtoPath("notification.proto");
const pd = protoLoader.loadSync(NOTIF_PROTO, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const notifProto = grpc.loadPackageDefinition(pd) as any;

/** gRPC `NotificationService` implementation (unit-test via direct `call` / `cb` invocation). */
export const notificationGrpcHandlers = {
  GetUserPreferences(call: grpc.ServerUnaryCall<any, any>, cb: grpc.sendUnaryData<any>) {
    const userId = String(call.request?.user_id || "").trim();
    if (!userId) {
      cb({ code: grpc.status.INVALID_ARGUMENT, message: "user_id required" });
      return;
    }
    if (!pool) {
      return cb(null, { email_enabled: true, sms_enabled: false, push_enabled: true });
    }
    pool
      .query(
        `SELECT email_enabled, sms_enabled, push_enabled FROM notification.user_preferences WHERE user_id = $1::uuid`,
        [userId]
      )
      .then((r) => {
        if (!r.rows.length) {
          return cb(null, { email_enabled: true, sms_enabled: false, push_enabled: true });
        }
        const row = r.rows[0];
        cb(null, {
          email_enabled: !!row.email_enabled,
          sms_enabled: !!row.sms_enabled,
          push_enabled: !!row.push_enabled,
        });
      })
      .catch((e) => {
        console.error("[GetUserPreferences]", e);
        cb({ code: grpc.status.INTERNAL, message: "failed" });
      });
  },
};

/** gRPC health: TLS/listener only. DB readiness is HTTP /healthz (Kafka consumer must not block gRPC SERVING). */
export async function notificationGrpcHealthCheck(): Promise<boolean> {
  return true;
}

export function startGrpcServer(port: number): grpc.Server {
  const server = createRpGrpcServer();
  server.addService(notifProto.notification.NotificationService.service, notificationGrpcHandlers);
  registerHealthService(server, "notification.NotificationService", notificationGrpcHealthCheck);

  let credentials: grpc.ServerCredentials;
  try {
    credentials = createRpGrpcServerCredentialsForBind("notification gRPC");
  } catch (e) {
    console.error(e);
    process.exit(1);
  }

  server.bindAsync(`0.0.0.0:${port}`, credentials, (err, boundPort) => {
    if (err) {
      console.error("[notification gRPC] bind error:", err);
      return;
    }
    console.log(`[notification gRPC] listening on ${boundPort}`);
  });

  return server;
}
