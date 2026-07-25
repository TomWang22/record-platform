import type { Application, Request, Response } from "express";
import { rpCheckLocalGrpcMtlsHealth } from "./grpc-local-readiness.js";
import { beginDrain, isDraining } from "./shutdown-coordinator.js";

export type RpHttpHealthGrpcOptions = {
  port: number;
  grpcService: string;
  serverName?: string;
};

export type RpHttpHealthOptions = {
  service: string;
  readiness?: () => Promise<boolean>;
  liveness?: () => Promise<boolean>;
  /** When set, /readyz also requires local mTLS gRPC health SERVING. */
  grpc?: RpHttpHealthGrpcOptions;
};

/** Standard RP HTTP probes: /healthz, /health, /readyz + drain/build-info. */
export function mountRpHttpHealth(app: Application, options: RpHttpHealthOptions): void {
  const { service, readiness, liveness, grpc } = options;

  app.get(["/healthz", "/health"], async (_req: Request, res: Response) => {
    let ok = true;
    if (liveness) {
      try {
        ok = await liveness();
      } catch {
        ok = false;
      }
    }
    res.status(ok ? 200 : 503).json({ ok, service });
  });

  app.get("/readyz", async (_req: Request, res: Response) => {
    if (isDraining()) {
      res.status(503).json({ ok: false, ready: false, service, draining: true });
      return;
    }
    let depsOk = true;
    let grpcOk = true;
    if (readiness) {
      try {
        depsOk = await readiness();
      } catch {
        depsOk = false;
      }
    }
    if (depsOk && grpc) {
      try {
        grpcOk = await rpCheckLocalGrpcMtlsHealth({
          port: grpc.port,
          grpcService: grpc.grpcService,
          serverName: grpc.serverName ?? service,
        });
      } catch {
        grpcOk = false;
      }
    }
    if (depsOk && grpcOk) {
      res.json({ ok: true, ready: true, service, grpc: grpc ? "SERVING" : "skip" });
    } else {
      res.status(503).json({
        ok: false,
        ready: false,
        service,
        deps: depsOk,
        grpc: grpcOk ? "SERVING" : grpc ? "fail" : "skip",
      });
    }
  });

  /** preStop should POST here so readiness fails before SIGTERM. */
  app.post("/internal/drain", (_req: Request, res: Response) => {
    beginDrain("preStop");
    res.status(200).json({ ok: true, draining: true, service });
  });

  app.get("/internal/build-info", (_req: Request, res: Response) => {
    res.json({
      service,
      source_sha: process.env.RP_SOURCE_SHA || process.env.SOURCE_SHA || "unknown",
      image_tag: process.env.RP_IMAGE_TAG || process.env.IMAGE_TAG || "unknown",
      image_digest: process.env.RP_IMAGE_DIGEST || "unknown",
      build_timestamp: process.env.RP_BUILD_TIMESTAMP || "unknown",
      build_id: process.env.RP_BUILD_ID || "unknown",
      pod_name: process.env.POD_NAME || process.env.HOSTNAME || "unknown",
      kafka_client_id_hint: process.env.KAFKA_CLIENT_ID || null,
    });
  });

  app.get("/internal/runtime", (_req: Request, res: Response) => {
    res.json({
      service,
      source_sha: process.env.RP_SOURCE_SHA || process.env.SOURCE_SHA || "unknown",
      image_tag: process.env.RP_IMAGE_TAG || process.env.IMAGE_TAG || "unknown",
      image_digest: process.env.RP_IMAGE_DIGEST || "unknown",
      build_timestamp: process.env.RP_BUILD_TIMESTAMP || "unknown",
      build_id: process.env.RP_BUILD_ID || "unknown",
      draining: isDraining(),
      readiness: isDraining() ? "not_ready" : "ready_unless_deps_fail",
      phase: process.env.RP_SHUTDOWN_PHASE_HINT || (isDraining() ? "DRAINING" : "RUNNING"),
      pod_name: process.env.POD_NAME || process.env.HOSTNAME || "unknown",
      active_request_count: null,
      active_kafka_handler_count: null,
      active_outbox_lease_count: null,
    });
  });
}

/** gRPC block for mountRpHttpHealth from GRPC_PORT / ENABLE_GRPC. */
export function rpGrpcHealthOptions(
  service: string,
  grpcService: string,
  serverName?: string,
): RpHttpHealthGrpcOptions | undefined {
  if (process.env.ENABLE_GRPC === "false") return undefined;
  const port = parseInt(process.env.GRPC_PORT || "0", 10);
  if (!port) return undefined;
  return { port, grpcService, serverName: serverName ?? service };
}

/** Build standard gRPC readiness check from env + contract service name. */
export function rpGrpcReadyFromEnv(
  service: string,
  grpcService: string,
  serverName?: string,
): () => Promise<boolean> {
  return () => {
    const port = parseInt(process.env.GRPC_PORT || "0", 10);
    if (!port) return Promise.resolve(false);
    return rpCheckLocalGrpcMtlsHealth({
      port,
      grpcService,
      serverName: serverName ?? service,
    });
  };
}
