/**
 * Generic namespace integrity policy for Record Platform telemetry and config.
 *
 * Allowed custom namespaces: rp.*, record-platform.*, and OpenTelemetry semantic conventions.
 * Forbidden historical literals are never stored in-repo; compare SHA-256 only.
 */

import { createHash } from "node:crypto";

/** SHA-256 digests of lowercase forbidden historical tokens (LEGACY_NAMESPACE_1 family). */
export const FORBIDDEN_NAMESPACE_SHA256 = new Set<string>([
  "cc31fac3f71e9bf4e174207e628ff222a1dfcb23ce087e63aa13c1861b8c863e",
  "55cd49b74bf3313c7e88b417ced661c04b867f8e510bf64fdb0c70e9a4ff44e1",
  "459e4444021f14b4bc11e3f6bf7ff428f68a3bfc6203c5332da27bfaa38b4adc",
  "8ae163ed2b1cd473af869e55884e5288faa389074955e864fc0d869e149eab21",
  "c6ffe7c05ea0b0a98bafc969e74bbdeb2553d3d42dead013cfda93b16ba5dd0e",
  "ca3d4729dd15cdb834f33ca581e79b6b6d826a49421ba6995b771ae4ebe2630c",
  "bb47728c5edba01b0ff990987ac4f77c71c16ba2361ea09c10d0405ae8a4a2ca",
  "41fc53994dec5cc3ef8acda847d3ea8bfcb2d62ba65bf711b6ef64ac5ae0bd15",
  "03b30f82ecdad1178192751e4b1c61cf19c05cf8c8d704260ccf33603279f7e0",
  "d9de6cd76622cd84c677fd34b7cd245805c384937371be1fb65271f21155e6a3",
  "a0c7ca7c9030fb457e7509ab7364a707431c8d7906e524eda33f9ba1ae024901",
  "cec92af72d6ef1f1c6384b42964bbd2c5c6983a42d6596528f5e51ef557f2495",
]);

const OTEL_SEMCONV_PREFIXES = [
  "http.",
  "net.",
  "network.",
  "rpc.",
  "db.",
  "messaging.",
  "exception.",
  "code.",
  "service.",
  "telemetry.",
  "otel.",
  "url.",
  "user_agent.",
  "server.",
  "client.",
  "peer.",
  "thread.",
  "process.",
  "host.",
  "k8s.",
  "cloud.",
  "faas.",
  "enduser.",
  "deployment.",
  "browser.",
  "device.",
  "os.",
  "debug.",
] as const;

export type NamespaceKind =
  | "span_attribute"
  | "resource_attribute"
  | "baggage"
  | "http_header"
  | "grpc_metadata"
  | "envoy_metadata"
  | "metric_name"
  | "metric_label"
  | "log_field"
  | "kafka_header";

export type NamespaceDecision = { ok: true } | { ok: false; reason: string };

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** True if any sliding window of `value` hashes to a forbidden digest (word-boundary aware for short tokens). */
export function containsForbiddenNamespaceLiteral(value: string): boolean {
  const low = value.toLowerCase();
  for (let n = 3; n <= 21; n++) {
    for (let i = 0; i <= low.length - n; i++) {
      const window = low.slice(i, i + n);
      if (!FORBIDDEN_NAMESPACE_SHA256.has(sha256Hex(window))) continue;
      if (n <= 4) {
        const prev = i > 0 ? low[i - 1]! : "";
        if (/[a-z0-9]/.test(prev)) continue;
      }
      return true;
    }
  }
  return false;
}

function isAllowedCustomKey(key: string): boolean {
  const k = key.trim();
  if (!k) return false;
  if (k.startsWith("rp.")) return true;
  if (k.startsWith("record-platform.")) return true;
  if (OTEL_SEMCONV_PREFIXES.some((p) => k.startsWith(p))) return true;
  // Un-namespaced simple keys (status, error, etc.) — allow only if no forbidden substring
  if (!k.includes(".") && !k.includes("_") && !k.includes("-")) return true;
  // Single-segment keys already covered; multi-segment without allowed prefix is undeclared
  if (!k.includes(".")) return !containsForbiddenNamespaceLiteral(k);
  return false;
}

export function assertAllowedNamespaceKey(kind: NamespaceKind, key: string): NamespaceDecision {
  if (containsForbiddenNamespaceLiteral(key)) {
    return { ok: false, reason: `${kind} key matches forbidden historical namespace digest` };
  }
  const normalized =
    kind === "http_header" || kind === "grpc_metadata" || kind === "kafka_header"
      ? key.toLowerCase().replace(/^x-/, "")
      : key;

  if (kind === "http_header" || kind === "grpc_metadata" || kind === "kafka_header") {
    const hk = key.toLowerCase();
    if (hk.startsWith("x-rp-") || hk.startsWith("rp-")) return { ok: true };
    if (hk.startsWith("traceparent") || hk.startsWith("tracestate") || hk === "baggage") return { ok: true };
    if (hk.startsWith("x-") && !hk.startsWith("x-rp-") && !hk.startsWith("x-request") && !hk.startsWith("x-forwarded") && !hk.startsWith("x-debug")) {
      // Custom x-* other than approved must not encode forbidden namespaces (already checked)
      // Undeclared custom header prefix outside x-rp / known hop headers
      if (!hk.startsWith("x-request") && !hk.startsWith("x-forwarded") && !hk.startsWith("x-debug") && !hk.startsWith("x-correlation")) {
        // allow standard hop; reject unknown custom namespaces only when dotted/legacy-like
        if (containsForbiddenNamespaceLiteral(hk)) {
          return { ok: false, reason: `${kind} contains forbidden namespace` };
        }
      }
    }
    return { ok: true };
  }

  if (kind === "metric_name" || kind === "metric_label") {
    if (key.startsWith("rp_") || key.startsWith("http_") || key.startsWith("rpc_") || key.startsWith("nodejs_")) {
      return { ok: true };
    }
    if (isAllowedCustomKey(key.replace(/_/g, "."))) return { ok: true };
    if (containsForbiddenNamespaceLiteral(key)) {
      return { ok: false, reason: `${kind} forbidden` };
    }
    // Undeclared custom metric namespace (non rp_/otel-ish)
    if (/^[a-z]+\./i.test(key) && !isAllowedCustomKey(key)) {
      return { ok: false, reason: `${kind} undeclared custom namespace` };
    }
    return { ok: true };
  }

  if (kind === "envoy_metadata") {
    if (key.startsWith("rp.") || key.startsWith("envoy.") || key.startsWith("com.record-platform.")) {
      return { ok: true };
    }
    return { ok: false, reason: "envoy metadata undeclared custom namespace" };
  }

  if (!isAllowedCustomKey(normalized) && key.includes(".")) {
    return { ok: false, reason: `${kind} undeclared custom namespace: ${key}` };
  }
  return { ok: true };
}

/** Fail-closed helper for startup / middleware. */
export function requireAllowedNamespaceKey(kind: NamespaceKind, key: string): void {
  const d = assertAllowedNamespaceKey(kind, key);
  if (!d.ok) {
    throw new Error(`NAMESPACE_INTEGRITY_VIOLATION: ${d.reason}`);
  }
}
