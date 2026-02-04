import http from "k6/http";
import http3 from "k6/x/http3";  // Custom HTTP/3 extension (xk6-http3)
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";
import exec from "k6/execution";

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

// HTTP/2 test with protocol verification
export function h2_request() {
  const res = http.get(URL, {
    headers: { Host: HOST },
    timeout: "10s",  // Increased from 4s to handle rotation overhead and brief Caddy restarts
    httpVersion: "HTTP/2",
    noConnectionReuse: false,
    // Strict TLS 1.3
    tlsVersion: { min: "1.3", max: "1.3" },
  });

  h2_latency.add(res.timings.duration);
  h2_fail.add(res.status !== 200);
  
  // Protocol verification
  const proto = res.proto || "";
  if (!proto.includes("HTTP/2")) {
    console.warn(`[H2] Protocol mismatch: expected HTTP/2, got ${proto}`);
  }
  
  check(res, { 
    "H2 status 200": (r) => r.status === 200,
    "H2 protocol HTTP/2": (r) => (r.proto || "").includes("HTTP/2"),
  });

  sleep(Math.random() * 0.01);
}

// HTTP/3 test with protocol verification using xk6-http3 extension
export function h3_request() {
  const start = Date.now();
  
  // Use xk6-http3 extension for true HTTP/3/QUIC support
  const res = http3.get(URL, {
    headers: { Host: HOST },
    timeout: "10s",
    insecureSkipTLSVerify: false,  // Strict TLS verification
    serverName: HOST,
  });

  const duration = Date.now() - start;
  h3_latency.add(duration);
  
  const status = res.status || 0;
  const proto = res.proto || "";
  h3_fail.add(status !== 200);
  
  // Protocol verification - xk6-http3 always uses HTTP/3
  if (!proto.includes("HTTP/3")) {
    console.warn(`[H3] Expected HTTP/3, got ${proto}`);
  }
  
  check(res, { 
    "H3 status 200": (r) => (r.status || 0) === 200,
    "H3 protocol HTTP/3": (r) => (r.proto || "").includes("HTTP/3"),
  });

  sleep(Math.random() * 0.015);
}

// Database verification function (called in teardown)
function verify_database_state() {
  // Database connection info (from environment or defaults)
  const DB_HOST = __ENV.DB_HOST || "host.docker.internal";
  const DB_PORT = __ENV.DB_PORT || "5433";
  const DB_USER = __ENV.DB_USER || "postgres";
  const DB_PASSWORD = __ENV.DB_PASSWORD || "postgres";
  const DB_NAME = __ENV.DB_NAME || "records";
  
  // Log database verification attempt
  // Full verification will be done in post-test scripts using psql
  console.log(`[DB] Database verification requested for ${DB_HOST}:${DB_PORT}/${DB_NAME}`);
  console.log(`[DB] Note: Full verification should be done in post-test scripts with psql`);
}

// Database verification (run at test end)
export function teardown(data) {
  verify_database_state();
}

// Protocol verification helpers (using curl with explicit flags)
// Note: k6 doesn't have exec() function, so we'll use shell commands via system calls
// For now, protocol verification is done via k6's built-in proto field
// Additional verification can be done in post-test scripts using tshark/tcpdump
