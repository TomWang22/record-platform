import { describe, expect, it } from "vitest";
import {
  isCallerAuthorized,
  parsePeerIdentities,
  type ServiceCallGraph,
} from "./grpc-peer-auth.js";

const graph: ServiceCallGraph = {
  version: 1,
  healthAndReflectionBypass: true,
  servers: {
    "auth-service": { allowedCallers: ["api-gateway", "envoy-client"] },
    "python-ai-service": { allowedCallers: ["api-gateway", "analytics-service"] },
  },
};

describe("parsePeerIdentities", () => {
  it("extracts DNS and short names", () => {
    const ids = parsePeerIdentities(
      "DNS:shopping-service, DNS:shopping-service.record-platform.svc.cluster.local",
    );
    expect(ids).toContain("shopping-service");
    expect(ids).toContain("shopping-service.record-platform.svc.cluster.local");
  });
});

describe("isCallerAuthorized", () => {
  it("allows authorized caller", () => {
    const d = isCallerAuthorized({
      serverServiceName: "auth-service",
      peerIdentities: ["api-gateway"],
      methodPath: "/auth.AuthService/GetUser",
      graph,
    });
    expect(d.allowed).toBe(true);
  });

  it("denies same-CA unauthorized service identity", () => {
    const d = isCallerAuthorized({
      serverServiceName: "auth-service",
      peerIdentities: ["analytics-service", "analytics-service.record-platform.svc.cluster.local"],
      methodPath: "/auth.AuthService/GetUser",
      graph,
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("unauthorized_peer_identities");
  });

  it("bypasses health checks", () => {
    const d = isCallerAuthorized({
      serverServiceName: "auth-service",
      peerIdentities: ["analytics-service"],
      methodPath: "/grpc.health.v1.Health/Check",
      graph,
    });
    expect(d.allowed).toBe(true);
  });
});
