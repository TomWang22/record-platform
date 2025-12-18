import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

// Request timeout configuration:
// - Set to 10s to handle rotation overhead and brief Caddy restarts during CA/leaf rotation
// - During rotation, requests may take longer due to:
//   * RollingUpdate pod transitions
//   * Certificate reload operations
//   * Network endpoint updates
// - 10s timeout prevents false failures during legitimate rotation scenarios
// - Normal requests should complete in <500ms (H2) or <800ms (H3) per thresholds

// Metrics
let h2_latency = new Trend("h2_latency");
let h3_latency = new Trend("h3_latency");
let h2_fail = new Rate("h2_fail");
let h3_fail = new Rate("h3_fail");

export const options = {
  // Strict TLS verification (production-grade)
  // CA certificate is mounted via ConfigMap and set via SSL_CERT_FILE
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
    "h2_fail": ["rate==0"],
    "h3_fail": ["rate==0"],
    "h2_latency": ["p(99)<500"],
    "h3_latency": ["p(99)<800"],
  },
};

const HOST = __ENV.HOST || "record.local";
// Use the Host header for SNI, but connect to ClusterIP FQDN
// The certificate is for record.local, so we set Host header for SNI matching
const URL = "https://caddy-h3.ingress-nginx.svc.cluster.local/_caddy/healthz";

// HTTP/2 test
export function h2_request() {
  const res = http.get(URL, {
    headers: { Host: HOST },
    timeout: "10s",  // Increased from 4s to handle rotation overhead and brief Caddy restarts
    httpVersion: "HTTP/2",
    noConnectionReuse: false,
  });

  h2_latency.add(res.timings.duration);
  h2_fail.add(res.status !== 200);
  check(res, { "H2 status 200": (r) => r.status === 200 });

  sleep(Math.random() * 0.01);
}

// HTTP/3 test
export function h3_request() {
  const res = http.get(URL, {
    headers: { Host: HOST },
    timeout: "10s",  // Increased from 4s to handle rotation overhead and brief Caddy restarts
    httpVersion: "HTTP/3",
    noConnectionReuse: false,
  });

  h3_latency.add(res.timings.duration);
  h3_fail.add(res.status !== 200);
  check(res, { "H3 status 200": (r) => r.status === 200 });

  sleep(Math.random() * 0.015);
}
