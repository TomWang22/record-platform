/**
 * Shared Jaeger HTTP helpers for trace validators (no Vitest / Rollup).
 */
export async function fetchJson(url, timeoutMs = 45_000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
}

export function buildTracesUrl(base, service, lookbackSec, limit) {
  const end = Date.now() * 1000;
  const start = (Date.now() - lookbackSec * 1000) * 1000;
  const enc = encodeURIComponent(service);
  return `${base.replace(/\/$/, "")}/api/traces?service=${enc}&start=${start}&end=${end}&limit=${limit}`;
}

export function tagValue(span, wantKey) {
  const tags = span.tags || [];
  const w = wantKey.toLowerCase();
  for (const t of tags) {
    if (String(t.key || "").toLowerCase() === w) return t.value;
  }
  return undefined;
}

export function serviceName(span, processes) {
  const pid = span.processID;
  const p = processes?.[pid];
  return p?.serviceName || "";
}

export function spanMap(spans) {
  const m = new Map();
  for (const s of spans) {
    m.set(String(s.spanID), s);
    if (s.spanID != null) m.set(s.spanID, s);
  }
  return m;
}

/** Jaeger trace: { traceID, spans, processes } */
export function normalizeTrace(raw) {
  if (!raw) return null;
  if (raw.traceID && raw.spans) return raw;
  if (Array.isArray(raw.spans) && raw.spans[0]?.traceID) {
    return {
      traceID: raw.spans[0].traceID,
      spans: raw.spans,
      processes: raw.processes || {},
    };
  }
  return null;
}
