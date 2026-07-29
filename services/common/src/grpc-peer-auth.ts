/**
 * gRPC peer identity authorization: deny callers whose SAN/SPIFFE identity
 * is not in the service-call graph for this server. CA trust alone is insufficient.
 *
 * Identity MUST come from authenticated TLS transport state
 * (`AuthContext.sslPeerCertificate` on @grpc/grpc-js ≥1.14). Caller metadata is never trusted.
 *
 * Health/Check and reflection are intentionally exempt when
 * `healthAndReflectionBypass !== false` (transport-authenticated only). Business edges
 * must use real RPCs — Health is NOT_APPLICABLE_WITH_RATIONALE as authorization proof.
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as grpc from "@grpc/grpc-js";
import type { PeerCertificate } from "tls";
import { EMBEDDED_SERVICE_CALL_GRAPH } from "./rp-service-call-graph.embedded.js";
import { rpGrpcPeerAuthorizationTotal } from "./metrics.js";

export type ServiceCallGraph = {
  version: number;
  servers: Record<
    string,
    {
      allowedCallers: string[];
      /** Full method paths denied to every caller (e.g. /auth.AuthService/RpGate3ForbiddenProbe). */
      deniedMethods?: string[];
      /** If a method is listed, caller must also be in this allowlist (and in allowedCallers). */
      methodAllowedCallers?: Record<string, string[]>;
    }
  >;
  /**
   * When true (default), grpc.health / reflection bypass service-authorization.
   * Trust boundary: cluster-internal mTLS still required by ServerCredentials;
   * exemption is authorization-only, not transport.
   */
  healthAndReflectionBypass?: boolean;
};

export type PeerCertificateContext = {
  transport_authenticated: boolean;
  peer_address: string | null;
  certificate_present: boolean;
  certificate_fingerprint_sha256: string | null;
  certificate_subject: string | null;
  dns_sans: string[];
  uri_sans: string[];
  eku: string[];
  canonical_identities: string[];
  extraction_source: string;
  extraction_error: string | null;
};

export type PeerAuthDecision = {
  allowed: boolean;
  reason: string;
  matchedCaller?: string;
  peer_authentication:
    | "AUTHENTICATED"
    | "AUTHENTICATED_IDENTITY_UNAVAILABLE"
    | "UNAUTHENTICATED"
    | "HEALTH_BYPASS"
    | "DISABLED";
  service_authorization: "ALLOW" | "DENY";
  metric_reason:
    | "allow"
    | "deny_unauthorized"
    | "deny_identity_unavailable"
    | "deny_method_restricted"
    | "deny_check_failed"
    | "health_bypass"
    | "disabled";
};

let cachedGraph: ServiceCallGraph | null = null;

/** Test-only: clear embedded/file graph cache. */
export function resetServiceCallGraphCacheForTests(): void {
  cachedGraph = null;
}

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
  cachedGraph = JSON.parse(JSON.stringify(EMBEDDED_SERVICE_CALL_GRAPH)) as ServiceCallGraph;
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

export function normalizePeerIdentity(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (/[\x00-\x1f]/.test(t)) return null;
  // DNS names and SPIFFE URIs are case-insensitive for matching
  if (t.startsWith("spiffe://") || !t.includes("://")) {
    return t.toLowerCase();
  }
  return t;
}

export function extractDnsSans(subjectAltName: string | undefined | null): string[] {
  if (!subjectAltName) return [];
  const out: string[] = [];
  for (const part of subjectAltName.split(/,\s*/)) {
    const m = part.trim().match(/^DNS:(.+)$/i);
    if (!m) continue;
    const v = m[1].trim();
    if (!v || v.includes(" ")) continue;
    out.push(v);
  }
  return out;
}

export function extractUriSans(subjectAltName: string | undefined | null): string[] {
  if (!subjectAltName) return [];
  const out: string[] = [];
  for (const part of subjectAltName.split(/,\s*/)) {
    const m = part.trim().match(/^URI:(.+)$/i);
    if (!m) continue;
    const v = m[1].trim();
    if (!v || /\s/.test(v)) continue;
    out.push(v);
  }
  return out;
}

export function deriveCanonicalServiceIdentities(opts: {
  dnsSans: string[];
  uriSans: string[];
  commonName?: string | null;
  /** PKI contract: CN fallback only when no usable DNS SAN exists. */
  allowCnFallback?: boolean;
}): string[] {
  const ids: string[] = [];
  for (const dns of opts.dnsSans) {
    const n = normalizePeerIdentity(dns);
    if (n) ids.push(n);
    const short = dns.split(".")[0];
    if (short && short !== dns) {
      const sn = normalizePeerIdentity(short);
      if (sn) ids.push(sn);
    }
  }
  for (const uri of opts.uriSans) {
    const n = normalizePeerIdentity(uri);
    if (n) ids.push(n);
    const m = uri.match(/\/sa\/([^/]+)$/);
    if (m) {
      const sn = normalizePeerIdentity(m[1]);
      if (sn) ids.push(sn);
    }
  }
  if (ids.length === 0 && opts.allowCnFallback !== false && opts.commonName) {
    const cn = normalizePeerIdentity(opts.commonName);
    if (cn) {
      ids.push(cn);
      const short = opts.commonName.split(".")[0];
      if (short && short !== opts.commonName) {
        const sn = normalizePeerIdentity(short);
        if (sn) ids.push(sn);
      }
    }
  } else if (opts.commonName && ids.length > 0) {
    // CN is recorded as supplementary when SANs already establish identity
    const cn = normalizePeerIdentity(opts.commonName);
    if (cn) ids.push(cn);
  }
  return [...new Set(ids)].filter(Boolean);
}

function fingerprintSha256(cert: PeerCertificate): string | null {
  if (cert.fingerprint256 && typeof cert.fingerprint256 === "string") {
    return cert.fingerprint256.replace(/:/g, "").toLowerCase();
  }
  if (cert.raw) {
    return crypto.createHash("sha256").update(cert.raw).digest("hex");
  }
  return null;
}

function subjectString(cert: PeerCertificate): string | null {
  const s = cert.subject;
  if (!s) return null;
  if (typeof s === "string") return s;
  const cn = (s as { CN?: string }).CN;
  if (cn) return `CN=${cn}`;
  try {
    return JSON.stringify(s);
  } catch {
    return null;
  }
}

function ekuList(cert: PeerCertificate): string[] {
  const eku = (cert as { ext_key_usage?: string[] }).ext_key_usage;
  if (Array.isArray(eku)) return eku.map(String);
  return [];
}

/**
 * Extract peer certificate context from grpc-js AuthContext (transport-authenticated).
 * Never reads gRPC metadata for identity.
 */
export function extractPeerCertificateContext(opts: {
  authContext: unknown;
  peerAddress?: string | null;
}): PeerCertificateContext {
  const empty = (error: string | null, source: string): PeerCertificateContext => ({
    transport_authenticated: false,
    peer_address: opts.peerAddress ?? null,
    certificate_present: false,
    certificate_fingerprint_sha256: null,
    certificate_subject: null,
    dns_sans: [],
    uri_sans: [],
    eku: [],
    canonical_identities: [],
    extraction_source: source,
    extraction_error: error,
  });

  const auth = opts.authContext as
    | { transportSecurityType?: string; sslPeerCertificate?: PeerCertificate; get?: unknown }
    | null
    | undefined;

  if (!auth || typeof auth !== "object") {
    return empty("auth_context_missing", "none");
  }

  // Reject Map-style / metadata-shaped mistaken APIs — only sslPeerCertificate is authoritative.
  const cert = auth.sslPeerCertificate;
  const transportType = auth.transportSecurityType;
  const transportAuth = transportType === "ssl" || Boolean(cert);

  if (!cert || !cert.raw) {
    return {
      ...empty(
        transportAuth ? "ssl_peer_certificate_missing_or_empty" : "not_tls_transport",
        "authContext.sslPeerCertificate",
      ),
      transport_authenticated: transportAuth,
    };
  }

  const dns = extractDnsSans(cert.subjectaltname);
  const uri = extractUriSans(cert.subjectaltname);
  const cn = (cert.subject as { CN?: string } | undefined)?.CN ?? null;
  const canonical = deriveCanonicalServiceIdentities({
    dnsSans: dns,
    uriSans: uri,
    commonName: cn,
    allowCnFallback: true,
  });

  return {
    transport_authenticated: true,
    peer_address: opts.peerAddress ?? null,
    certificate_present: true,
    certificate_fingerprint_sha256: fingerprintSha256(cert),
    certificate_subject: subjectString(cert),
    dns_sans: dns,
    uri_sans: uri,
    eku: ekuList(cert),
    canonical_identities: canonical,
    extraction_source: "authContext.sslPeerCertificate",
    extraction_error: canonical.length === 0 ? "no_canonical_identities_from_certificate" : null,
  };
}

/** @deprecated Prefer extractPeerCertificateContext; retained for SAN string parsing unit tests. */
export function parsePeerIdentities(sanRaw: string | undefined | null): string[] {
  const dns = extractDnsSans(sanRaw);
  const uri = extractUriSans(sanRaw);
  return deriveCanonicalServiceIdentities({ dnsSans: dns, uriSans: uri, allowCnFallback: false });
}

/** @deprecated Prefer extractPeerCertificateContext. */
export function extractPeerIdentitiesFromAuthContext(authContext: unknown): string[] {
  return extractPeerCertificateContext({ authContext }).canonical_identities;
}

export function authorizePeerForRpc(opts: {
  serverServiceName: string;
  peerContext: PeerCertificateContext;
  methodPath?: string;
  graph?: ServiceCallGraph;
}): PeerAuthDecision {
  const graph = opts.graph ?? loadServiceCallGraph();
  const method = opts.methodPath || "";

  if (graph.healthAndReflectionBypass !== false && isHealthOrReflectionMethod(method)) {
    return {
      allowed: true,
      reason: "health_or_reflection_bypass",
      peer_authentication: "HEALTH_BYPASS",
      service_authorization: "ALLOW",
      metric_reason: "health_bypass",
    };
  }

  if (process.env.RP_MTLS_PEER_AUTH_DISABLE === "1") {
    return {
      allowed: true,
      reason: "RP_MTLS_PEER_AUTH_DISABLE=1",
      peer_authentication: "DISABLED",
      service_authorization: "ALLOW",
      metric_reason: "disabled",
    };
  }

  if (!opts.peerContext.transport_authenticated) {
    return {
      allowed: false,
      reason: "unauthenticated_transport",
      peer_authentication: "UNAUTHENTICATED",
      service_authorization: "DENY",
      metric_reason: "deny_check_failed",
    };
  }

  if (!opts.peerContext.certificate_present || opts.peerContext.canonical_identities.length === 0) {
    return {
      allowed: false,
      reason: `authenticated_identity_unavailable:${opts.peerContext.extraction_error || "empty"}`,
      peer_authentication: "AUTHENTICATED_IDENTITY_UNAVAILABLE",
      service_authorization: "DENY",
      metric_reason: "deny_identity_unavailable",
    };
  }

  const identities = opts.peerContext.canonical_identities;

  // Same-service leaf (local readiness / self-probe) is always allowed for non-denied methods.
  for (const id of identities) {
    const short = id.split(".")[0];
    if (id === opts.serverServiceName || short === opts.serverServiceName) {
      const methodGate = evaluateMethodRestrictions({
        serverServiceName: opts.serverServiceName,
        methodPath: method,
        peerIdentities: identities,
        graph,
        matchedCaller: short,
      });
      if (!methodGate.allowed) return methodGate;
      return {
        allowed: true,
        reason: "same_service_identity",
        matchedCaller: short,
        peer_authentication: "AUTHENTICATED",
        service_authorization: "ALLOW",
        metric_reason: "allow",
      };
    }
  }

  const server = graph.servers[opts.serverServiceName];
  if (!server) {
    return {
      allowed: false,
      reason: `no_call_graph_entry_for_server:${opts.serverServiceName}`,
      peer_authentication: "AUTHENTICATED",
      service_authorization: "DENY",
      metric_reason: "deny_unauthorized",
    };
  }

  const deniedMethods = server.deniedMethods || [];
  if (method && deniedMethods.includes(method)) {
    return {
      allowed: false,
      reason: `denied_method:${method}`,
      peer_authentication: "AUTHENTICATED",
      service_authorization: "DENY",
      metric_reason: "deny_method_restricted",
    };
  }

  const allowed = new Set(server.allowedCallers.map((c) => c.toLowerCase()));
  let matched: string | undefined;
  for (const id of identities) {
    if (allowed.has(id)) {
      matched = id;
      break;
    }
    const short = id.split(".")[0];
    if (allowed.has(short)) {
      matched = short;
      break;
    }
  }

  if (!matched) {
    return {
      allowed: false,
      reason: `unauthorized_peer_identities:${identities.join("|") || "(none)"}`,
      peer_authentication: "AUTHENTICATED",
      service_authorization: "DENY",
      metric_reason: "deny_unauthorized",
    };
  }

  const methodGate = evaluateMethodRestrictions({
    serverServiceName: opts.serverServiceName,
    methodPath: method,
    peerIdentities: identities,
    graph,
    matchedCaller: matched,
  });
  if (!methodGate.allowed) return methodGate;

  return {
    allowed: true,
    reason: "san_match",
    matchedCaller: matched,
    peer_authentication: "AUTHENTICATED",
    service_authorization: "ALLOW",
    metric_reason: "allow",
  };
}

function evaluateMethodRestrictions(opts: {
  serverServiceName: string;
  methodPath: string;
  peerIdentities: string[];
  graph: ServiceCallGraph;
  matchedCaller: string;
}): PeerAuthDecision {
  const server = opts.graph.servers[opts.serverServiceName];
  if (!server || !opts.methodPath) {
    return {
      allowed: true,
      reason: "no_method_restriction",
      matchedCaller: opts.matchedCaller,
      peer_authentication: "AUTHENTICATED",
      service_authorization: "ALLOW",
      metric_reason: "allow",
    };
  }
  if ((server.deniedMethods || []).includes(opts.methodPath)) {
    return {
      allowed: false,
      reason: `denied_method:${opts.methodPath}`,
      peer_authentication: "AUTHENTICATED",
      service_authorization: "DENY",
      metric_reason: "deny_method_restricted",
    };
  }
  const methodAllow = server.methodAllowedCallers?.[opts.methodPath];
  if (!methodAllow) {
    return {
      allowed: true,
      reason: "no_method_restriction",
      matchedCaller: opts.matchedCaller,
      peer_authentication: "AUTHENTICATED",
      service_authorization: "ALLOW",
      metric_reason: "allow",
    };
  }
  const allowSet = new Set(methodAllow.map((c) => c.toLowerCase()));
  for (const id of opts.peerIdentities) {
    if (allowSet.has(id) || allowSet.has(id.split(".")[0])) {
      return {
        allowed: true,
        reason: "method_allowlist_match",
        matchedCaller: opts.matchedCaller,
        peer_authentication: "AUTHENTICATED",
        service_authorization: "ALLOW",
        metric_reason: "allow",
      };
    }
  }
  return {
    allowed: false,
    reason: `method_not_allowed_for_caller:${opts.methodPath}`,
    peer_authentication: "AUTHENTICATED",
    service_authorization: "DENY",
    metric_reason: "deny_method_restricted",
  };
}

/** Compatibility wrapper used by existing unit tests. */
export function isCallerAuthorized(opts: {
  serverServiceName: string;
  peerIdentities: string[];
  methodPath?: string;
  graph?: ServiceCallGraph;
}): { allowed: boolean; reason: string; matchedCaller?: string } {
  const peerContext: PeerCertificateContext = {
    transport_authenticated: true,
    peer_address: null,
    certificate_present: opts.peerIdentities.length > 0,
    certificate_fingerprint_sha256: null,
    certificate_subject: null,
    dns_sans: opts.peerIdentities,
    uri_sans: [],
    eku: [],
    canonical_identities: opts.peerIdentities.map((i) => normalizePeerIdentity(i) || i),
    extraction_source: "test_peer_identities",
    extraction_error: opts.peerIdentities.length ? null : "empty",
  };
  const d = authorizePeerForRpc({
    serverServiceName: opts.serverServiceName,
    peerContext,
    methodPath: opts.methodPath,
    graph: opts.graph,
  });
  return { allowed: d.allowed, reason: d.reason, matchedCaller: d.matchedCaller };
}

export function createPermissionDeniedError(reason: string): grpc.ServiceError {
  const err = new Error(`mTLS peer identity denied: ${reason}`) as grpc.ServiceError;
  err.code = grpc.status.PERMISSION_DENIED;
  err.details = err.message;
  err.metadata = new grpc.Metadata();
  return err;
}

export function createUnauthenticatedError(reason: string): grpc.ServiceError {
  const err = new Error(`mTLS peer authentication required: ${reason}`) as grpc.ServiceError;
  err.code = grpc.status.UNAUTHENTICATED;
  err.details = err.message;
  err.metadata = new grpc.Metadata();
  return err;
}

/**
 * Terminate a denied intercepting call exactly once with PERMISSION_DENIED (or UNAUTHENTICATED).
 * Must not leave the stream open awaiting a handler that will never run.
 */
export function terminateDeniedCall(opts: {
  nextCall: {
    sendStatus: (status: {
      code: grpc.status;
      details: string;
      metadata: grpc.Metadata;
    }) => void;
  };
  decision: PeerAuthDecision;
  alreadyTerminated: { value: boolean };
}): void {
  if (opts.alreadyTerminated.value) return;
  opts.alreadyTerminated.value = true;
  const code =
    opts.decision.peer_authentication === "UNAUTHENTICATED"
      ? grpc.status.UNAUTHENTICATED
      : grpc.status.PERMISSION_DENIED;
  const prefix =
    code === grpc.status.UNAUTHENTICATED
      ? "mTLS peer authentication required: "
      : "mTLS peer identity denied: ";
  opts.nextCall.sendStatus({
    code,
    details: `${prefix}${opts.decision.reason}`,
    metadata: new grpc.Metadata(),
  });
}

function rpcParts(methodPath: string): { rpc_service: string; rpc_method: string } {
  // /pkg.Service/Method
  const m = methodPath.match(/^\/?([^/]+)\/([^/]+)$/);
  if (!m) return { rpc_service: "unknown", rpc_method: methodPath || "unknown" };
  return { rpc_service: m[1], rpc_method: m[2] };
}

function recordDecisionMetric(opts: {
  target_service: string;
  methodPath: string;
  decision: PeerAuthDecision;
}): void {
  try {
    const { rpc_service, rpc_method } = rpcParts(opts.methodPath);
    rpGrpcPeerAuthorizationTotal.inc({
      target_service: opts.target_service,
      rpc_service,
      rpc_method,
      decision: opts.decision.service_authorization === "ALLOW" ? "ALLOW" : "DENY",
      reason: opts.decision.metric_reason,
    });
  } catch {
    /* metrics must never break auth */
  }
}

function boundedDenyLog(opts: {
  serverServiceName: string;
  methodPath: string;
  decision: PeerAuthDecision;
  peerContext: PeerCertificateContext;
  denial_completion_ms: number;
}): void {
  console.warn(
    JSON.stringify({
      msg: "rp_grpc_peer_authorization",
      target_service: opts.serverServiceName,
      rpc: opts.methodPath,
      decision: opts.decision.service_authorization,
      reason: opts.decision.reason,
      peer_authentication: opts.decision.peer_authentication,
      certificate_fingerprint_sha256: opts.peerContext.certificate_fingerprint_sha256,
      canonical_identities: opts.peerContext.canonical_identities.slice(0, 8),
      extraction_source: opts.peerContext.extraction_source,
      denial_completion_ms: opts.denial_completion_ms,
    }),
  );
}

/**
 * Server interceptor that enforces the service-call graph against transport peer cert SANs.
 */
export function createRpGrpcPeerAuthInterceptor(
  serverServiceName: string,
): grpc.ServerInterceptor {
  const graph = loadServiceCallGraph();
  return (methodDescriptor, nextCall) => {
    let denied = false;
    const terminated = { value: false };
    let peerContext: PeerCertificateContext | null = null;
    let lastDecision: PeerAuthDecision | null = null;

    return new grpc.ServerInterceptingCall(nextCall, {
      start: (next) => {
        next({
          onReceiveMetadata: (metadata, nextMeta) => {
            const t0 = Date.now();
            try {
              const methodPath = methodDescriptor.path;
              // Never use caller-controlled metadata for identity (explicitly ignored).
              void metadata;

              if (graph.healthAndReflectionBypass !== false && isHealthOrReflectionMethod(methodPath)) {
                const decision: PeerAuthDecision = {
                  allowed: true,
                  reason: "health_or_reflection_bypass",
                  peer_authentication: "HEALTH_BYPASS",
                  service_authorization: "ALLOW",
                  metric_reason: "health_bypass",
                };
                recordDecisionMetric({ target_service: serverServiceName, methodPath, decision });
                nextMeta(metadata);
                return;
              }

              const auth =
                typeof nextCall.getAuthContext === "function" ? nextCall.getAuthContext() : undefined;
              const peer =
                typeof nextCall.getPeer === "function" ? nextCall.getPeer() : null;
              peerContext = extractPeerCertificateContext({
                authContext: auth,
                peerAddress: peer,
              });
              const decision = authorizePeerForRpc({
                serverServiceName,
                peerContext,
                methodPath,
                graph,
              });
              lastDecision = decision;
              recordDecisionMetric({ target_service: serverServiceName, methodPath, decision });

              if (!decision.allowed) {
                denied = true;
                const elapsed = Date.now() - t0;
                boundedDenyLog({
                  serverServiceName,
                  methodPath,
                  decision,
                  peerContext,
                  denial_completion_ms: elapsed,
                });
                terminateDeniedCall({ nextCall, decision, alreadyTerminated: terminated });
                // Do not forward metadata — prevents handler invocation.
                return;
              }
            } catch (e) {
              if (isHealthOrReflectionMethod(methodDescriptor.path)) {
                console.warn(`[rp-peer-auth] health path ignoring error:`, e);
                nextMeta(metadata);
                return;
              }
              denied = true;
              const decision: PeerAuthDecision = {
                allowed: false,
                reason: `check_failed:${String(e)}`,
                peer_authentication: "AUTHENTICATED_IDENTITY_UNAVAILABLE",
                service_authorization: "DENY",
                metric_reason: "deny_check_failed",
              };
              lastDecision = decision;
              recordDecisionMetric({
                target_service: serverServiceName,
                methodPath: methodDescriptor.path,
                decision,
              });
              terminateDeniedCall({ nextCall, decision, alreadyTerminated: terminated });
              return;
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
          // Status already sent via terminateDeniedCall; swallow duplicates.
          if (!terminated.value && lastDecision) {
            terminateDeniedCall({ nextCall, decision: lastDecision, alreadyTerminated: terminated });
          }
          return;
        }
        next(status);
      },
      sendMessage: (message, next) => {
        if (denied) return;
        next(message);
      },
      sendMetadata: (md, next) => {
        if (denied) return;
        next(md);
      },
    });
  };
}
