import type { Application, Request, Response } from "express";
import { rpCheckLocalGrpcMtlsHealth } from "./grpc-local-readiness.js";

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

/** Standard RP HTTP probes: /healthz, /health, /readyz. */
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
