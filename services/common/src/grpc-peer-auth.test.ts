import { describe, expect, it, vi, beforeEach } from "vitest";
import * as grpc from "@grpc/grpc-js";
import type { PeerCertificate } from "tls";
import {
  authorizePeerForRpc,
  createPermissionDeniedError,
  createRpGrpcPeerAuthInterceptor,
  deriveCanonicalServiceIdentities,
  extractDnsSans,
  extractPeerCertificateContext,
  extractUriSans,
  isCallerAuthorized,
  isHealthOrReflectionMethod,
  normalizePeerIdentity,
  parsePeerIdentities,
  resetServiceCallGraphCacheForTests,
  terminateDeniedCall,
  type PeerCertificateContext,
  type ServiceCallGraph,
} from "./grpc-peer-auth.js";

const graph: ServiceCallGraph = {
  version: 1,
  healthAndReflectionBypass: true,
  servers: {
    "auth-service": {
      allowedCallers: ["api-gateway", "envoy", "analytics-service"],
      deniedMethods: ["/auth.AuthService/RpGate3ForbiddenProbe"],
      methodAllowedCallers: {
        "/auth.AuthService/RefreshToken": ["api-gateway"],
      },
    },
    "python-ai-service": { allowedCallers: ["api-gateway", "analytics-service"] },
  },
};

function fakeCert(opts: {
  cn?: string;
  san?: string;
  fingerprint256?: string;
}): PeerCertificate {
  const raw = Buffer.from(`fake-cert:${opts.cn || ""}:${opts.san || ""}`);
  return {
    raw,
    subject: { CN: opts.cn || "unknown" },
    issuer: {},
    subjectaltname: opts.san,
    fingerprint256: opts.fingerprint256 || "AA:BB:CC:DD",
    valid_from: "",
    valid_to: "",
    serialNumber: "1",
    fingerprint: "aa",
    fingerprint512: "",
    issuerCertificate: {} as PeerCertificate,
  } as unknown as PeerCertificate;
}

describe("normalize / SAN helpers", () => {
  it("normalizes case-insensitive DNS identities", () => {
    expect(normalizePeerIdentity("API-Gateway")).toBe("api-gateway");
  });

  it("extracts DNS and URI SANs; rejects malformed", () => {
    const san =
      "DNS:api-gateway, DNS:api-gateway.record-platform.svc.cluster.local, URI:spiffe://record-platform.local/ns/record-platform/sa/api-gateway, DNS:bad name, email:x@y";
    expect(extractDnsSans(san)).toEqual([
      "api-gateway",
      "api-gateway.record-platform.svc.cluster.local",
    ]);
    expect(extractUriSans(san)).toEqual([
      "spiffe://record-platform.local/ns/record-platform/sa/api-gateway",
    ]);
  });

  it("deriveCanonicalServiceIdentities keeps DNS+URI and SPIFFE sa short name", () => {
    const ids = deriveCanonicalServiceIdentities({
      dnsSans: ["api-gateway.record-platform.svc.cluster.local"],
      uriSans: ["spiffe://record-platform.local/ns/record-platform/sa/api-gateway"],
      commonName: "api-gateway",
    });
    expect(ids).toContain("api-gateway");
    expect(ids).toContain("api-gateway.record-platform.svc.cluster.local");
    expect(ids).toContain("spiffe://record-platform.local/ns/record-platform/sa/api-gateway");
  });

  it("parsePeerIdentities extracts DNS and short names", () => {
    const ids = parsePeerIdentities(
      "DNS:shopping-service, DNS:shopping-service.record-platform.svc.cluster.local",
    );
    expect(ids).toContain("shopping-service");
    expect(ids).toContain("shopping-service.record-platform.svc.cluster.local");
  });
});

describe("extractPeerCertificateContext (grpc-js AuthContext shape)", () => {
  it("A. Positive extraction from sslPeerCertificate", () => {
    const ctx = extractPeerCertificateContext({
      authContext: {
        transportSecurityType: "ssl",
        sslPeerCertificate: fakeCert({
          cn: "api-gateway",
          san: "DNS:api-gateway, DNS:api-gateway.record-platform.svc.cluster.local, URI:spiffe://record-platform.local/ns/record-platform/sa/api-gateway",
          fingerprint256: "11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:01",
        }),
      },
      peerAddress: "10.0.0.1:40000",
    });
    expect(ctx.transport_authenticated).toBe(true);
    expect(ctx.certificate_present).toBe(true);
    expect(ctx.dns_sans).toContain("api-gateway");
    expect(ctx.uri_sans[0]).toContain("spiffe://");
    expect(ctx.canonical_identities).toContain("api-gateway");
    expect(ctx.certificate_fingerprint_sha256).toBe(
      "112233445566778899aabbccddeeff00112233445566778899aabbccddeeff01",
    );
    expect(ctx.extraction_source).toBe("authContext.sslPeerCertificate");
  });

  it("B. Identity unavailable when transport ssl but cert missing", () => {
    const ctx = extractPeerCertificateContext({
      authContext: { transportSecurityType: "ssl" },
    });
    expect(ctx.transport_authenticated).toBe(true);
    expect(ctx.certificate_present).toBe(false);
    expect(ctx.canonical_identities).toEqual([]);
  });

  it("does not trust Map-style x509_* keys (legacy mistaken API)", () => {
    const map = new Map<string, string>([
      ["x509_subject_alternative_name", "DNS:api-gateway"],
      ["x509_common_name", "api-gateway"],
    ]);
    const ctx = extractPeerCertificateContext({ authContext: map });
    expect(ctx.canonical_identities).toEqual([]);
  });

  it("G. Multiple SANs — malformed ignored; permitted kept", () => {
    const ctx = extractPeerCertificateContext({
      authContext: {
        transportSecurityType: "ssl",
        sslPeerCertificate: fakeCert({
          cn: "x",
          san: "DNS:evil.example, DNS:not a host, DNS:api-gateway, URI:spiffe://record-platform.local/ns/record-platform/sa/api-gateway",
        }),
      },
    });
    expect(ctx.dns_sans).toContain("api-gateway");
    expect(ctx.dns_sans).toContain("evil.example");
    expect(ctx.dns_sans).not.toContain("not a host");
    expect(ctx.canonical_identities).toContain("api-gateway");
  });
});

describe("authorizePeerForRpc", () => {
  function ctxFromIds(ids: string[], transport = true): PeerCertificateContext {
    return {
      transport_authenticated: transport,
      peer_address: null,
      certificate_present: ids.length > 0,
      certificate_fingerprint_sha256: "abcd",
      certificate_subject: null,
      dns_sans: ids,
      uri_sans: [],
      eku: ["clientAuth"],
      canonical_identities: ids,
      extraction_source: "test",
      extraction_error: ids.length ? null : "empty",
    };
  }

  it("A. permitted RPC authorized", () => {
    const d = authorizePeerForRpc({
      serverServiceName: "auth-service",
      peerContext: ctxFromIds(["api-gateway"]),
      methodPath: "/auth.AuthService/ValidateToken",
      graph,
    });
    expect(d.allowed).toBe(true);
    expect(d.service_authorization).toBe("ALLOW");
  });

  it("B. identity unavailable → DENY PERMISSION path", () => {
    const d = authorizePeerForRpc({
      serverServiceName: "auth-service",
      peerContext: ctxFromIds([], true),
      methodPath: "/auth.AuthService/ValidateToken",
      graph,
    });
    expect(d.allowed).toBe(false);
    expect(d.peer_authentication).toBe("AUTHENTICATED_IDENTITY_UNAVAILABLE");
    expect(d.service_authorization).toBe("DENY");
  });

  it("C. same-CA wrong service", () => {
    const d = authorizePeerForRpc({
      serverServiceName: "auth-service",
      peerContext: ctxFromIds(["shopping-service"]),
      methodPath: "/auth.AuthService/ValidateToken",
      graph,
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("unauthorized_peer_identities");
  });

  it("D. same-CA unauthorized service (analytics allowed for auth; shopping denied on python-ai)", () => {
    const d = authorizePeerForRpc({
      serverServiceName: "python-ai-service",
      peerContext: ctxFromIds(["shopping-service"]),
      methodPath: "/python_ai.PythonAIService/GetTrending",
      graph,
    });
    expect(d.allowed).toBe(false);
  });

  it("E. unknown trusted identity", () => {
    const d = authorizePeerForRpc({
      serverServiceName: "auth-service",
      peerContext: ctxFromIds(["gate3-unknown-caller"]),
      methodPath: "/auth.AuthService/ValidateToken",
      graph,
    });
    expect(d.allowed).toBe(false);
  });

  it("H. RPC-level restriction — service allowed, method denied", () => {
    const d = authorizePeerForRpc({
      serverServiceName: "auth-service",
      peerContext: ctxFromIds(["api-gateway"]),
      methodPath: "/auth.AuthService/RpGate3ForbiddenProbe",
      graph,
    });
    expect(d.allowed).toBe(false);
    expect(d.metric_reason).toBe("deny_method_restricted");
  });

  it("H. methodAllowedCallers — analytics allowed for service but not GetUser", () => {
    const d = authorizePeerForRpc({
      serverServiceName: "auth-service",
      peerContext: ctxFromIds(["analytics-service"]),
      methodPath: "/auth.AuthService/RefreshToken",
      graph,
    });
    expect(d.allowed).toBe(false);
    expect(d.metric_reason).toBe("deny_method_restricted");
  });

  it("bypasses health checks", () => {
    const d = authorizePeerForRpc({
      serverServiceName: "auth-service",
      peerContext: ctxFromIds(["shopping-service"]),
      methodPath: "/grpc.health.v1.Health/Check",
      graph,
    });
    expect(d.allowed).toBe(true);
    expect(d.peer_authentication).toBe("HEALTH_BYPASS");
  });
});

describe("isCallerAuthorized compatibility", () => {
  it("allows authorized caller", () => {
    const d = isCallerAuthorized({
      serverServiceName: "auth-service",
      peerIdentities: ["api-gateway"],
      methodPath: "/auth.AuthService/RefreshToken",
      graph,
    });
    expect(d.allowed).toBe(true);
  });

  it("denies same-CA unauthorized service identity", () => {
    const d = isCallerAuthorized({
      serverServiceName: "auth-service",
      peerIdentities: ["media-service"],
      methodPath: "/auth.AuthService/RefreshToken",
      graph,
    });
    expect(d.allowed).toBe(false);
  });

  it("allows same-service identity", () => {
    const d = isCallerAuthorized({
      serverServiceName: "auth-service",
      peerIdentities: ["auth-service.record-platform.svc.cluster.local"],
      methodPath: "/auth.AuthService/ValidateToken",
      graph,
    });
    expect(d.allowed).toBe(true);
  });
});

describe("terminateDeniedCall / interceptor completion", () => {
  it("B/J. terminates exactly once under 2s with PERMISSION_DENIED", () => {
    const sendStatus = vi.fn();
    const already = { value: false };
    const t0 = Date.now();
    terminateDeniedCall({
      nextCall: { sendStatus },
      decision: {
        allowed: false,
        reason: "authenticated_identity_unavailable:empty",
        peer_authentication: "AUTHENTICATED_IDENTITY_UNAVAILABLE",
        service_authorization: "DENY",
        metric_reason: "deny_identity_unavailable",
      },
      alreadyTerminated: already,
    });
    terminateDeniedCall({
      nextCall: { sendStatus },
      decision: {
        allowed: false,
        reason: "again",
        peer_authentication: "AUTHENTICATED_IDENTITY_UNAVAILABLE",
        service_authorization: "DENY",
        metric_reason: "deny_identity_unavailable",
      },
      alreadyTerminated: already,
    });
    expect(sendStatus).toHaveBeenCalledTimes(1);
    expect(sendStatus.mock.calls[0][0].code).toBe(grpc.status.PERMISSION_DENIED);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(createPermissionDeniedError("x").code).toBe(grpc.status.PERMISSION_DENIED);
  });

  function mockNextCall(auth: unknown) {
    const sendStatus = vi.fn();
    let chainedListener: {
      onReceiveMetadata?: (m: grpc.Metadata) => void;
      onReceiveMessage?: (m: unknown) => void;
      onReceiveHalfClose?: () => void;
    } = {};
    const nextCall = {
      sendStatus,
      getAuthContext: () => auth,
      getPeer: () => "10.0.0.2:1",
      start: (listener: typeof chainedListener) => {
        chainedListener = listener;
      },
      getChainedListener: () => chainedListener,
    };
    return { nextCall, sendStatus };
  }

  function runInterceptorMetadata(opts: {
    auth: unknown;
    methodPath?: string;
    metadata?: grpc.Metadata;
    shape?: { requestStream: boolean; responseStream: boolean };
  }) {
    const { nextCall, sendStatus } = mockNextCall(opts.auth);
    const interceptor = createRpGrpcPeerAuthInterceptor("auth-service");
    const methodDescriptor = {
      path: opts.methodPath || "/auth.AuthService/ValidateToken",
      requestStream: opts.shape?.requestStream ?? false,
      responseStream: opts.shape?.responseStream ?? false,
    } as grpc.ServerMethodDefinition<unknown, unknown>;
    const call = interceptor(methodDescriptor, nextCall as unknown as grpc.ServerInterceptingCallInterface);
    let forwardedMeta = 0;
    let forwardedMsg = 0;
    let forwardedHc = 0;
    call.start({
      onReceiveMetadata: () => {
        forwardedMeta += 1;
      },
      onReceiveMessage: () => {
        forwardedMsg += 1;
      },
      onReceiveHalfClose: () => {
        forwardedHc += 1;
      },
      onCancel: () => undefined,
    });
    const listener = nextCall.getChainedListener();
    listener.onReceiveMetadata?.(opts.metadata || new grpc.Metadata());
    listener.onReceiveMessage?.({});
    listener.onReceiveHalfClose?.();
    return { sendStatus, forwardedMeta, forwardedMsg, forwardedHc };
  }

  it("I. interceptor denies without forwarding metadata (all shapes share listener)", () => {
    resetServiceCallGraphCacheForTests();
    const auth = {
      transportSecurityType: "ssl",
      sslPeerCertificate: fakeCert({
        cn: "not-a-real-caller",
        san: "DNS:not-a-real-caller",
      }),
    };
    const r = runInterceptorMetadata({ auth });
    expect(r.sendStatus).toHaveBeenCalled();
    expect(r.sendStatus.mock.calls[0][0].code).toBe(grpc.status.PERMISSION_DENIED);
    expect(r.forwardedMeta).toBe(0);
    expect(r.forwardedMsg).toBe(0);
    expect(r.forwardedHc).toBe(0);

    for (const shape of [
      { requestStream: false, responseStream: true },
      { requestStream: true, responseStream: false },
      { requestStream: true, responseStream: true },
    ]) {
      const s = runInterceptorMetadata({ auth, shape });
      expect(s.sendStatus).toHaveBeenCalled();
      expect(s.forwardedMeta).toBe(0);
    }
  });

  it("F. metadata spoof does not authorize — transport cert wins", () => {
    const md = new grpc.Metadata();
    md.set("x-rp-peer", "api-gateway");
    md.set("x-service-name", "api-gateway");
    md.set("x-caller-service", "api-gateway");
    const r = runInterceptorMetadata({
      auth: {
        transportSecurityType: "ssl",
        sslPeerCertificate: fakeCert({
          cn: "not-a-real-caller",
          san: "DNS:not-a-real-caller",
        }),
      },
      metadata: md,
    });
    expect(r.sendStatus).toHaveBeenCalled();
    expect(r.forwardedMeta).toBe(0);
  });

  it("A. allowed caller forwards metadata (handler may run)", () => {
    const r = runInterceptorMetadata({
      auth: {
        transportSecurityType: "ssl",
        sslPeerCertificate: fakeCert({
          cn: "api-gateway",
          san: "DNS:api-gateway, DNS:api-gateway.record-platform.svc.cluster.local",
        }),
      },
    });
    expect(r.sendStatus).not.toHaveBeenCalled();
    expect(r.forwardedMeta).toBe(1);
  });
});

describe("health policy", () => {
  it("documents health as authorization-exempt (transport still required)", () => {
    expect(isHealthOrReflectionMethod("/grpc.health.v1.Health/Check")).toBe(true);
    expect(isHealthOrReflectionMethod("/auth.AuthService/ValidateToken")).toBe(false);
  });
});

beforeEach(() => {
  resetServiceCallGraphCacheForTests();
});
