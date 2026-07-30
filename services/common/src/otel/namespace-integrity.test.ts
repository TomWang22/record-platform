import { describe, expect, it } from "vitest";
import {
  assertAllowedNamespaceKey,
  containsForbiddenNamespaceLiteral,
  requireAllowedNamespaceKey,
} from "./namespace-integrity.js";

describe("namespace-integrity", () => {
  it("accepts allowed rp.* attribute", () => {
    expect(assertAllowedNamespaceKey("span_attribute", "rp.transport.edge_protocol")).toEqual({ ok: true });
  });

  it("accepts allowed OpenTelemetry semantic attribute", () => {
    expect(assertAllowedNamespaceKey("span_attribute", "http.method")).toEqual({ ok: true });
    expect(assertAllowedNamespaceKey("span_attribute", "network.protocol.version")).toEqual({ ok: true });
  });

  it("rejects undeclared custom span namespace", () => {
    const d = assertAllowedNamespaceKey("span_attribute", "acme.custom.field");
    expect(d.ok).toBe(false);
  });

  it("rejects undeclared baggage namespace", () => {
    const d = assertAllowedNamespaceKey("baggage", "vendor.trace.flag");
    expect(d.ok).toBe(false);
  });

  it("rejects forbidden historical digest in HTTP header / span keys via char-code construction", () => {
    expect(assertAllowedNamespaceKey("http_header", "x-rp-edge-proto").ok).toBe(true);
    const legacyNs = String.fromCharCode(0x6f, 0x63, 0x68);
    const spanKey = `${legacyNs}.upstream_proto`;
    const headerKey = `x-${legacyNs}-edge-proto`;
    expect(containsForbiddenNamespaceLiteral(spanKey)).toBe(true);
    expect(assertAllowedNamespaceKey("span_attribute", spanKey).ok).toBe(false);
    expect(containsForbiddenNamespaceLiteral(headerKey)).toBe(true);
  });

  it("rejects undeclared gRPC metadata prefix namespace", () => {
    const d = assertAllowedNamespaceKey("envoy_metadata", "vendor.policy");
    expect(d.ok).toBe(false);
  });

  it("rejects undeclared metric namespace", () => {
    const d = assertAllowedNamespaceKey("metric_name", "acme.requests.total");
    expect(d.ok).toBe(false);
  });

  it("rejects undeclared Envoy metadata namespace", () => {
    expect(assertAllowedNamespaceKey("envoy_metadata", "com.example.route").ok).toBe(false);
    expect(assertAllowedNamespaceKey("envoy_metadata", "rp.route.class").ok).toBe(true);
  });

  it("requireAllowedNamespaceKey fails closed", () => {
    expect(() => requireAllowedNamespaceKey("span_attribute", "acme.x")).toThrow(/NAMESPACE_INTEGRITY_VIOLATION/);
  });

  it("does not false-positive common unix timestamp column names", () => {
    expect(containsForbiddenNamespaceLiteral("epoch_ts")).toBe(false);
  });
});
