/**
 * gRPC peer identity authorization: deny callers whose SAN/SPIFFE identity
 * is not in the service-call graph for this server. CA trust alone is insufficient.
 *
 * The call graph is embedded in the package so container images never miss the file.
 */
import * as fs from "fs";
import * as path from "path";
import * as grpc from "@grpc/grpc-js";
import { EMBEDDED_SERVICE_CALL_GRAPH } from "./rp-service-call-graph.embedded.js";

export type ServiceCallGraph = {
  version: number;
  servers: Record<string, { allowedCallers: string[] }>;
  healthAndReflectionBypass?: boolean;
};

let cachedGraph: ServiceCallGraph | null = null;

function resolveOptionalGraphPath(): string | null {
  if (process.env.RP_SERVICE_CALL_GRAPH_PATH && fs.existsSync(process.env.RP_SERVICE_CALL_GRAPH_PATH)) {
    return process.env.RP_SERVICE_CALL_GRAPH_PATH;
  }
  const here = __dirname;
  const candidates = [
    path.resolve(here, "rp-service-call-graph.json"),
    path.resolve(here, "../contracts/rp-service-call-graph.json"),
    path.resolve(here, "../../contracts/rp-service-call-graph.json"),
    "/app/infra/contracts/rp-service-call-graph.json",
    "/app/services/common/contracts/rp-service-call-graph.json",
    "/contracts/rp-service-call-graph.json",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export function loadServiceCallGraph(): ServiceCallGraph {
  if (cachedGraph) return cachedGraph;
  const p = resolveOptionalGraphPath();
  if (p) {
    cachedGraph = JSON.parse(fs.readFileSync(p, "utf8")) as ServiceCallGraph;
    return cachedGraph;
  }
  cachedGraph = {
    version: EMBEDDED_SERVICE_CALL_GRAPH.version,
    healthAndReflectionBypass: EMBEDDED_SERVICE_CALL_GRAPH.healthAndReflectionBypass,
    servers: Object.fromEntries(
      Object.entries(EMBEDDED_SERVICE_CALL_GRAPH.servers).map(([k, v]) => [
        k,
        { allowedCallers: [...v.allowedCallers] },
      ]),
    ),
  };
  return cachedGraph;
}

export function isHealthOrReflectionMethod(methodPath: string | undefined | null): boolean {
  const method = methodPath || "";
  return (
    method.includes("grpc.health") ||
    method.includes("grpc.reflection") ||
    method.includes("ServerReflection") ||
    /\/Health\/(Check|Watch)$/.test(method)
  );
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

function authContextEntries(
  authContext: unknown,
): Array<[string, string]> {
  if (!authContext) return [];
  if (authContext instanceof Map) {
    return [...authContext.entries()].map(([k, v]) => [
      String(k),
      Buffer.isBuffer(v) ? v.toString("utf8") : String(v),
    ]);
  }
  if (typeof authContext === "object") {
    const obj = authContext as Record<string, unknown>;
    // grpc-js sometimes exposes a get() method that is not a Map
    if (typeof (obj as { get?: unknown }).get === "function") {
      const getFn = (obj as { get: (k: string) => unknown }).get.bind(obj);
      const keys = [
        "x509_subject_alternative_name",
        "X509_SUBJECT_ALTERNATIVE_NAME",
        "x509_common_name",
        "X509_COMMON_NAME",
      ];
      const out: Array<[string, string]> = [];
      for (const k of keys) {
        try {
          const v = getFn(k);
          if (v == null) continue;
          out.push([k, Buffer.isBuffer(v) ? v.toString("utf8") : String(v)]);
        } catch {
          /* ignore */
        }
      }
      return out;
    }
    return Object.entries(obj).map(([k, v]) => [
      k,
      Buffer.isBuffer(v) ? v.toString("utf8") : String(v ?? ""),
    ]);
  }
  return [];
}

export function extractPeerIdentitiesFromAuthContext(authContext: unknown): string[] {
  const entries = authContextEntries(authContext);
  const byKey = new Map(entries.map(([k, v]) => [k.toLowerCase(), v]));
  const sans =
    byKey.get("x509_subject_alternative_name") ||
    byKey.get("ssl_peer_cert_san") ||
    "";
  const cn = byKey.get("x509_common_name") || "";
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
  if (graph.healthAndReflectionBypass !== false && isHealthOrReflectionMethod(method)) {
    return { allowed: true, reason: "health_or_reflection_bypass" };
  }

  if (process.env.RP_MTLS_PEER_AUTH_DISABLE === "1") {
    return { allowed: true, reason: "RP_MTLS_PEER_AUTH_DISABLE=1" };
  }

  // Same-service leaf (local readiness / self-probe) is always allowed.
  for (const id of opts.peerIdentities) {
    const short = id.split(".")[0];
    if (id === opts.serverServiceName || short === opts.serverServiceName) {
      return { allowed: true, reason: "same_service_identity", matchedCaller: short };
    }
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
              const methodPath = methodDescriptor.path;
              if (graph.healthAndReflectionBypass !== false && isHealthOrReflectionMethod(methodPath)) {
                nextMeta(metadata);
                return;
              }
              const anyCall = nextCall as unknown as {
                getAuthContext?: () => unknown;
              };
              const auth =
                typeof anyCall.getAuthContext === "function"
                  ? anyCall.getAuthContext()
                  : undefined;
              const identities = extractPeerIdentitiesFromAuthContext(auth);
              const decision = isCallerAuthorized({
                serverServiceName,
                peerIdentities: identities,
                methodPath,
                graph,
              });
              if (!decision.allowed) {
                denied = true;
                denyReason = decision.reason;
                console.warn(
                  `[rp-peer-auth] DENY server=${serverServiceName} method=${methodPath} reason=${decision.reason}`,
                );
              }
            } catch (e) {
              // Fail closed for business RPCs, but never take down health probes.
              if (isHealthOrReflectionMethod(methodDescriptor.path)) {
                console.warn(`[rp-peer-auth] health path ignoring error:`, e);
              } else {
                denied = true;
                denyReason = `check_failed:${String(e)}`;
                console.error(`[rp-peer-auth] interceptor error:`, e);
              }
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
