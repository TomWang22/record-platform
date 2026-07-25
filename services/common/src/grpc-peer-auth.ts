/**
 * gRPC peer identity authorization: deny callers whose SAN/SPIFFE identity
 * is not in the service-call graph for this server. CA trust alone is insufficient.
 */
import * as fs from "fs";
import * as path from "path";
import * as grpc from "@grpc/grpc-js";

export type ServiceCallGraph = {
  version: number;
  servers: Record<string, { allowedCallers: string[] }>;
  healthAndReflectionBypass?: boolean;
};

let cachedGraph: ServiceCallGraph | null = null;

function resolveGraphPath(): string {
  if (process.env.RP_SERVICE_CALL_GRAPH_PATH) {
    return process.env.RP_SERVICE_CALL_GRAPH_PATH;
  }
  const here = __dirname;
  const candidates = [
    path.resolve(here, "../contracts/rp-service-call-graph.json"),
    path.resolve(here, "../../contracts/rp-service-call-graph.json"),
    path.resolve(here, "../../../../infra/contracts/rp-service-call-graph.json"),
    path.resolve(here, "../../../infra/contracts/rp-service-call-graph.json"),
    "/app/infra/contracts/rp-service-call-graph.json",
    "/app/services/common/contracts/rp-service-call-graph.json",
    "/contracts/rp-service-call-graph.json",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

export function loadServiceCallGraph(): ServiceCallGraph {
  if (cachedGraph) return cachedGraph;
  const p = resolveGraphPath();
  if (!fs.existsSync(p)) {
    throw new Error(`[rp-peer-auth] service call graph missing at ${p}`);
  }
  cachedGraph = JSON.parse(fs.readFileSync(p, "utf8")) as ServiceCallGraph;
  return cachedGraph;
}

/** Extract DNS / SPIFFE identities from openssl-style SAN or auth-context SANs. */
export function parsePeerIdentities(sanRaw: string | undefined | null): string[] {
  if (!sanRaw) return [];
  const out: string[] = [];
  for (const part of sanRaw.split(/[,\n]/)) {
    const t = part.trim();
    if (!t) continue;
    const dns = t.match(/DNS:([^\s,]+)/i);
    if (dns) {
      out.push(dns[1]);
      const host = dns[1].split(".")[0];
      if (host && host !== dns[1]) out.push(host);
      continue;
    }
    const uri = t.match(/URI:([^\s,]+)/i);
    if (uri) {
      out.push(uri[1]);
      const m = uri[1].match(/\/sa\/([^/]+)$/);
      if (m) out.push(m[1]);
      continue;
    }
    if (!t.includes("=") && !t.includes(":")) out.push(t);
  }
  return [...new Set(out)];
}

export function extractPeerIdentitiesFromAuthContext(
  authContext: Map<string, Buffer> | undefined,
): string[] {
  if (!authContext) return [];
  const get = (k: string): string | undefined => {
    const v = authContext.get(k);
    return v ? v.toString("utf8") : undefined;
  };
  const sans =
    get("x509_subject_alternative_name") ||
    get("X509_SUBJECT_ALTERNATIVE_NAME") ||
    "";
  const cn = get("x509_common_name") || get("X509_COMMON_NAME") || "";
  const ids = parsePeerIdentities(sans);
  if (cn) {
    ids.push(cn);
    ids.push(cn.split(".")[0]);
  }
  return [...new Set(ids)];
}

export function isCallerAuthorized(opts: {
  serverServiceName: string;
  peerIdentities: string[];
  methodPath?: string;
  graph?: ServiceCallGraph;
}): { allowed: boolean; reason: string; matchedCaller?: string } {
  const graph = opts.graph ?? loadServiceCallGraph();
  const method = opts.methodPath || "";
  if (
    graph.healthAndReflectionBypass &&
    (method.includes("grpc.health") ||
      method.includes("grpc.reflection") ||
      method.includes("ServerReflection") ||
      method.endsWith("/Check") ||
      method.endsWith("/Watch"))
  ) {
    return { allowed: true, reason: "health_or_reflection_bypass" };
  }

  if (process.env.RP_MTLS_PEER_AUTH_DISABLE === "1") {
    return { allowed: true, reason: "RP_MTLS_PEER_AUTH_DISABLE=1" };
  }

  const server = graph.servers[opts.serverServiceName];
  if (!server) {
    return {
      allowed: false,
      reason: `no_call_graph_entry_for_server:${opts.serverServiceName}`,
    };
  }
  const allowed = new Set(server.allowedCallers);
  for (const id of opts.peerIdentities) {
    if (allowed.has(id)) {
      return { allowed: true, reason: "san_match", matchedCaller: id };
    }
    const short = id.split(".")[0];
    if (allowed.has(short)) {
      return { allowed: true, reason: "san_short_match", matchedCaller: short };
    }
  }
  return {
    allowed: false,
    reason: `unauthorized_peer_identities:${opts.peerIdentities.join("|") || "(none)"}`,
  };
}

/**
 * Server interceptor that enforces the service-call graph against peer cert SANs.
 */
export function createRpGrpcPeerAuthInterceptor(
  serverServiceName: string,
): grpc.ServerInterceptor {
  const graph = loadServiceCallGraph();
  return (methodDescriptor, nextCall) => {
    let denied = false;
    let denyReason = "";

    return new grpc.ServerInterceptingCall(nextCall, {
      start: (next) => {
        next({
          onReceiveMetadata: (metadata, nextMeta) => {
            try {
              const anyCall = nextCall as unknown as {
                getAuthContext?: () => Map<string, Buffer>;
              };
              const auth =
                typeof anyCall.getAuthContext === "function"
                  ? anyCall.getAuthContext()
                  : undefined;
              const identities = extractPeerIdentitiesFromAuthContext(auth);
              const decision = isCallerAuthorized({
                serverServiceName,
                peerIdentities: identities,
                methodPath: methodDescriptor.path,
                graph,
              });
              if (!decision.allowed) {
                denied = true;
                denyReason = decision.reason;
                console.warn(
                  `[rp-peer-auth] DENY server=${serverServiceName} method=${methodDescriptor.path} reason=${decision.reason}`,
                );
                // Still consume metadata path; sendStatus will emit PERMISSION_DENIED.
                nextMeta(metadata);
                return;
              }
            } catch (e) {
              denied = true;
              denyReason = `check_failed:${String(e)}`;
              console.error(`[rp-peer-auth] interceptor error:`, e);
            }
            nextMeta(metadata);
          },
          onReceiveMessage: (message, nextMsg) => {
            if (denied) return;
            nextMsg(message);
          },
          onReceiveHalfClose: (nextHc) => {
            if (denied) return;
            nextHc();
          },
        });
      },
      sendStatus: (status, next) => {
        if (denied) {
          next({
            code: grpc.status.PERMISSION_DENIED,
            details: `mTLS peer identity denied: ${denyReason}`,
            metadata: status.metadata,
          });
          return;
        }
        next(status);
      },
      sendMessage: (message, next) => {
        if (denied) return;
        next(message);
      },
    });
  };
}
