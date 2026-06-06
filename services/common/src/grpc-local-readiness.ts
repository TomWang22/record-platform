/**
 * In-process local gRPC mTLS health check for HTTP /readyz (same trust as grpc-health-probe).
 */
import * as fs from "fs";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { resolveProtoPath } from "./proto.js";

const DEFAULT_CA = "/etc/certs/ca.crt";
const DEFAULT_CERT = "/etc/certs/tls.crt";
const DEFAULT_KEY = "/etc/certs/tls.key";

function loadHealthClient() {
  const path = resolveProtoPath("health.proto");
  if (!fs.existsSync(path)) return null;
  const def = protoLoader.loadSync(path, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const pkg = grpc.loadPackageDefinition(def) as {
    grpc?: { health?: { v1?: { Health?: grpc.ServiceClientConstructor } } };
  };
  return pkg.grpc?.health?.v1?.Health ?? null;
}

export type RpGrpcLocalReadinessParams = {
  port: number;
  grpcService: string;
  serverName: string;
  timeoutMs?: number;
};

/** Returns true when grpc.health.v1 Health/Check reports SERVING over local mTLS. */
export async function rpCheckLocalGrpcMtlsHealth(
  params: RpGrpcLocalReadinessParams,
): Promise<boolean> {
  if (process.env.ENABLE_GRPC === "false") return true;

  const Health = loadHealthClient();
  if (!Health) {
    console.warn("[grpc-local-readiness] health.proto unavailable — skip gRPC ready check");
    return true;
  }

  const caPath = process.env.TLS_CA_PATH || DEFAULT_CA;
  const certPath = process.env.TLS_CERT_PATH || DEFAULT_CERT;
  const keyPath = process.env.TLS_KEY_PATH || DEFAULT_KEY;
  for (const p of [caPath, certPath, keyPath]) {
    if (!fs.existsSync(p) || fs.statSync(p).size === 0) {
      console.warn(`[grpc-local-readiness] missing cert file ${p}`);
      return false;
    }
  }

  const creds = grpc.credentials.createSsl(
    fs.readFileSync(caPath),
    fs.readFileSync(keyPath),
    fs.readFileSync(certPath),
  );

  const client = new Health(`127.0.0.1:${params.port}`, creds, {
    "grpc.ssl_target_name_override": params.serverName,
  });

  const deadline = new Date(Date.now() + (params.timeoutMs ?? 4000));
  return new Promise((resolve) => {
    client.check(
      { service: params.grpcService },
      { deadline },
      (err: grpc.ServiceError | null, res: { status?: number } | undefined) => {
      client.close();
      if (err) {
        console.warn(
          `[grpc-local-readiness] ${params.serverName}:${params.port} service=${params.grpcService} err=${err.message}`,
        );
        resolve(false);
        return;
      }
      const status = res?.status;
      resolve(status === 1 || String(status) === "SERVING");
      },
    );
  });
}
