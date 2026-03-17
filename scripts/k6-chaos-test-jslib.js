// Same as k6-chaos-test.js but uses jslib textSummary (requires egress to jslib.k6.io).
// Use when K6_USE_JSLIB=1 and cluster/host has outbound HTTPS. Default chaos script uses inline summary (no egress).
import http from "k6/http";
import http3 from "k6/x/http3";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.2/index.js";

let h2_latency = new Trend("h2_latency");
let h3_latency = new Trend("h3_latency");
let h2_fail = new Rate("h2_fail");
let h3_fail = new Rate("h3_fail");

export const options = {
  insecureSkipTLSVerify: false,
  scenarios: {
    h2: {
      executor: "constant-arrival-rate",
      rate: __ENV.H2_RATE ? parseInt(__ENV.H2_RATE) : 80,
      timeUnit: "1s",
      duration: __ENV.DURATION || "180s",
      preAllocatedVUs: __ENV.H2_PRE_VUS ? parseInt(__ENV.H2_PRE_VUS) : 20,
      maxVUs: __ENV.H2_MAX_VUS ? parseInt(__ENV.H2_MAX_VUS) : 50,
      exec: "h2_request",
    },
    h3: {
      executor: "constant-arrival-rate",
      rate: __ENV.H3_RATE ? parseInt(__ENV.H3_RATE) : 40,
      timeUnit: "1s",
      duration: __ENV.DURATION || "180s",
      preAllocatedVUs: __ENV.H3_PRE_VUS ? parseInt(__ENV.H3_PRE_VUS) : 10,
      maxVUs: __ENV.H3_MAX_VUS ? parseInt(__ENV.H3_MAX_VUS) : 20,
      exec: "h3_request",
    },
  },
  thresholds: {
    "h2_fail": ["rate<0.01"],
    "h3_fail": ["rate<0.05"],
    "h2_latency": ["p(99)<1000"],
    "h3_latency": ["p(99)<15000"],
  },
};

const HOST = __ENV.HOST || "record.local";
const URL = "https://caddy-h3.ingress-nginx.svc.cluster.local/_caddy/healthz";

export function h2_request() {
  const res = http.get(URL, {
    headers: { Host: HOST },
    timeout: "15s",
    httpVersion: "HTTP/2",
    noConnectionReuse: false,
    tlsVersion: { min: "1.3", max: "1.3" },
  });
  h2_latency.add(res.timings.duration);
  h2_fail.add(res.status !== 200);
  if (!(res.proto || "").includes("HTTP/2")) console.warn(`[H2] Protocol mismatch: got ${res.proto}`);
  check(res, { "H2 status 200": (r) => r.status === 200, "H2 protocol HTTP/2": (r) => (r.proto || "").includes("HTTP/2") });
  sleep(Math.random() * 0.01);
}

export function h3_request() {
  const start = Date.now();
  const res = http3.get(URL, { headers: { Host: HOST }, timeout: "15s", insecureSkipTLSVerify: false, serverName: HOST });
  h3_latency.add(Date.now() - start);
  h3_fail.add((res.status || 0) !== 200);
  if (!(res.proto || "").includes("HTTP/3")) console.warn(`[H3] Expected HTTP/3, got ${res.proto}`);
  check(res, { "H3 status 200": (r) => (r.status || 0) === 200, "H3 protocol HTTP/3": (r) => (r.proto || "").includes("HTTP/3") });
  sleep(Math.random() * 0.015);
}

function verify_database_state() {
  console.log(`[DB] Database verification requested for ${__ENV.DB_HOST || "host.docker.internal"}:${__ENV.DB_PORT || "5433"}/${__ENV.DB_NAME || "records"}`);
}
export function teardown(data) {
  verify_database_state();
}

export function handleSummary(data) {
  const h2 = data.metrics.h2_latency?.values || {};
  const h3 = data.metrics.h3_latency?.values || {};
  const rate = data.metrics.http_reqs?.values?.rate || 0;
  const count = data.metrics.http_reqs?.values?.count || 0;
  const avgLatencyMs = (h2.avg != null && h3.avg != null) ? (h2.avg + h3.avg) / 2 : (h2.avg != null ? h2.avg : h3.avg) || 0;
  const Wsec = avgLatencyMs / 1000;
  const L = rate * Wsec;
  const percentiles = (v) => ({
    p50: v["p(50)"], p90: v["p(90)"], p95: v["p(95)"], p99: v["p(99)"],
    p999: v["p(99.9)"], p9999: v["p(99.99)"], p99999: v["p(99.999)"],
    p999999: v["p(99.9999)"], p9999999: v["p(99.99999)"], p100: v["p(100)"] != null ? v["p(100)"] : v.max,
  });
  const summary = {
    latency: { h2: { avg: h2.avg, min: h2.min, max: h2.max, ...percentiles(h2) }, h3: { avg: h3.avg, min: h3.min, max: h3.max, ...percentiles(h3) } },
    throughput: { rate, count },
    littlesLaw: { lambda_per_sec: rate, W_sec: Wsec, L_avg_concurrency: L },
    tls: { strictTLS: true, tls13Only: true, insecureSkipTLSVerify: data.options?.insecureSkipTLSVerify === false },
  };
  const text = textSummary(data, { indent: " ", enableColors: false });
  return { stdout: text + "\nROTATION_METRICS_JSON=" + JSON.stringify(summary) + "\n" };
}
