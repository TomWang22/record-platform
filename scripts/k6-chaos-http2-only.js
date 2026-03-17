// HTTP/2-only chaos script — use when k6-custom lacks xk6-http3 (avoids exit 107).
// Set K6_HTTP2_ONLY=1 in run-k6-chaos.sh or rotation-suite.sh.
// Same as k6-chaos-test.js but H2-only; no "k6/x/http3" import.
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

function inlineTextSummary(data) {
  const lines = ["\n=== k6 summary (H2 only) ==="];
  const fmt = (x) => (x != null && !Number.isNaN(Number(x))) ? Number(x).toFixed(2) : "n/a";
  if (data && data.metrics) {
    for (const [name, m] of Object.entries(data.metrics)) {
      if (m && m.values) {
        const v = m.values;
        const rate = v.rate != null ? ` rate=${fmt(v.rate)}` : "";
        const avg = v.avg != null ? ` avg=${fmt(v.avg)}` : "";
        const p99 = v["p(99)"] != null ? ` p99=${fmt(v["p(99)"])}` : "";
        lines.push(`  ${name}:${rate}${avg}${p99} passes=${v.passes || 0} fails=${v.fails || 0}`);
      }
    }
  }
  return lines.join("\n");
}

let h2_latency = new Trend("h2_latency");
let h2_fail = new Rate("h2_fail");

// K6_RESOLVE: "host:port:ip" — pin hostname to LB IP; TLS still validates hostname (cert match)
const K6_RESOLVE = __ENV.K6_RESOLVE || "";
function parseHostsFromResolve() {
  if (!K6_RESOLVE || typeof K6_RESOLVE !== "string") return {};
  const parts = K6_RESOLVE.split(":");
  if (parts.length < 3) return {};
  const host = parts[0];
  const ip = parts[parts.length - 1];
  if (!host || !ip) return {};
  return { [host]: ip };
}
const HOSTS = parseHostsFromResolve();

const opts = {
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
  },
  thresholds: {
    "h2_fail": ["rate<0.02"],
    "h2_latency": ["p(99)<15000"],
  },
};
if (Object.keys(HOSTS).length) opts.hosts = HOSTS;
export const options = opts;

const HOST = __ENV.HOST || "record.local";
// K6_TARGET_URL: host-based k6 uses https://record.local:443/_caddy/healthz (with K6_RESOLVE for LB IP)
const URL = __ENV.K6_TARGET_URL || "https://caddy-h3.ingress-nginx.svc.cluster.local/_caddy/healthz";

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
  check(res, {
    "H2 status 200": (r) => r.status === 200,
    "H2 protocol HTTP/2": (r) => (r.proto || "").includes("HTTP/2"),
  });
  sleep(Math.random() * 0.01);
}

export function handleSummary(data) {
  const h2 = data.metrics.h2_latency && data.metrics.h2_latency.values ? data.metrics.h2_latency.values : {};
  const h2f = data.metrics.h2_fail && data.metrics.h2_fail.values ? data.metrics.h2_fail.values : {};
  const rate = (data.metrics.http_reqs && data.metrics.http_reqs.values && data.metrics.http_reqs.values.rate) || 0;
  const count = (data.metrics.http_reqs && data.metrics.http_reqs.values && data.metrics.http_reqs.values.count) || 0;
  const Wsec = (h2.avg || 0) / 1000;
  const L = rate * Wsec;
  function pct(v) {
    return {
      p50: v['p(50)'], p90: v['p(90)'], p95: v['p(95)'], p99: v['p(99)'],
      p999: v['p(99.9)'], p9999: v['p(99.99)'], p99999: v['p(99.999)'],
      p999999: v['p(99.9999)'], p9999999: v['p(99.99999)'],
      p100: v['p(100)'] != null ? v['p(100)'] : v.max
    };
  }
  var ph2 = pct(h2);
  var h2Obj = { avg: h2.avg, min: h2.min, max: h2.max, p50: ph2.p50, p90: ph2.p90, p95: ph2.p95, p99: ph2.p99, p999: ph2.p999, p9999: ph2.p9999, p99999: ph2.p99999, p999999: ph2.p999999, p9999999: ph2.p9999999, p100: ph2.p100 };
  const summary = {
    latency: { h2: h2Obj, h3: {} },
    throughput: { rate, count },
    h2: { count: count, fails: h2f.fails || 0 },
    h3: { count: 0, fails: 0, skipped: true, reason: "K6_HTTP2_ONLY=1" },
    littlesLaw: { lambda_per_sec: rate, W_sec: Wsec, L_avg_concurrency: L },
    tls: { strictTLS: true, tls13Only: true },
  };
  const text = inlineTextSummary(data);
  return { stdout: text + "\nROTATION_METRICS_JSON=" + JSON.stringify(summary) + "\n" };
}
