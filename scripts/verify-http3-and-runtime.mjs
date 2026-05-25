#!/usr/bin/env node
/**
 * HTTP/3 edge validation + UDP port invariant. JSON to stdout; Prometheus text to VERIFY_HTTP3_PROM.
 *
 * Env:
 *   EDGE_LB_MODE — metallb-only (default) or servicelb-nodeport (legacy); controls nodePort assertions
 *   VERIFY_HTTP3_HOST — default record-platform.test (or RP_PUBLIC_HOST)
 *   VERIFY_HTTP3_NAMESPACE — default ingress-nginx
 *   VERIFY_HTTP3_SERVICE — default caddy-h3
 *   VERIFY_HTTP3_PROM — default bench_logs/http3_edge_metrics.prom
 *   VERIFY_HTTP3_SKIP_CURL — 1 skips curl --http3 (still checks svc)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

function sh(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
      ...opts,
    }).trim();
  } catch {
    return null;
  }
}

function resolveCurl() {
  const shim = join(repoRoot, "scripts", "shims", "curl");
  if (existsSync(shim)) return shim;
  const candidates = [
    "/opt/homebrew/opt/curl/bin/curl",
    "/opt/homebrew/bin/curl",
    "/usr/local/opt/curl/bin/curl",
    "/usr/local/bin/curl",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return "curl";
}

function checkHttp3(host) {
  if (process.env.VERIFY_HTTP3_SKIP_CURL === "1") return null;
  const curl = resolveCurl();
  const path = process.env.VERIFY_HTTP3_PATH || "/api/readyz";
  const lbIp = sh("kubectl", [
    "get",
    "svc",
    process.env.VERIFY_HTTP3_SERVICE || "caddy-h3",
    "-n",
    process.env.VERIFY_HTTP3_NAMESPACE || "ingress-nginx",
    "-o",
    "jsonpath={.status.loadBalancer.ingress[0].ip}",
    "--request-timeout=15s",
  ]);
  const args = [
    "--http3",
    "-k",
    "-s",
    "-o",
    "/dev/null",
    "-w",
    "%{http_code}",
    "--connect-timeout",
    "8",
    "--max-time",
    "25",
  ];
  if (lbIp) args.push("--resolve", `${host}:443:${lbIp}`);
  args.push(`https://${host}${path}`);
  const res = sh(curl, args);
  if (res === null) return false;
  return res === "200";
}

function getServicePorts(ns, svc) {
  const raw = sh("kubectl", ["get", "svc", svc, "-n", ns, "-o", "json", "--request-timeout=15s"]);
  if (!raw) return null;
  try {
    return JSON.parse(raw).spec?.ports || [];
  } catch {
    return null;
  }
}

function checkUdpPort(ports) {
  const mode = process.env.EDGE_LB_MODE || "metallb-only";
  const udp = ports.find((p) => p.protocol === "UDP" && (p.port === 443 || p.name === "https-udp"));
  if (!udp) return { ok: false, reason: "udp_port_missing" };
  if (mode === "metallb-only") {
    if (udp.nodePort) return { ok: false, reason: "nodeport_present_in_metallb_mode" };
    return { ok: true, nodePort: null, mode };
  }
  if (!udp.nodePort) return { ok: false, reason: "udp_nodeport_missing" };
  return { ok: true, nodePort: udp.nodePort, mode };
}

function detectK3s() {
  const nodes = sh("kubectl", ["get", "nodes", "-o", "json", "--request-timeout=15s"]);
  if (!nodes) return false;
  try {
    const parsed = JSON.parse(nodes);
    return (parsed.items || []).some((n) => (n.status?.nodeInfo?.kubeletVersion || "").includes("k3s"));
  } catch {
    return false;
  }
}

function classify(durationMs, ok) {
  if (!ok) return "degraded";
  if (durationMs < 5000) return "warm";
  return "cold";
}

function writeProm(metricsPath, data) {
  const dir = dirname(metricsPath);
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  const http3Line =
    data.http3_ok === null
      ? "bootstrap_http3_probe_skipped 1"
      : `bootstrap_http3_ok ${data.http3_ok ? 1 : 0}`;
  const lines = [
    http3Line,
    `bootstrap_udp_port_ok ${data.udp_ok ? 1 : 0}`,
    `bootstrap_startup_duration_ms ${data.duration_ms}`,
    `bootstrap_startup_mode{mode="${data.mode}"} 1`,
  ];
  writeFileSync(metricsPath, `${lines.join("\n")}\n`, "utf8");
}

function main() {
  const host = process.env.VERIFY_HTTP3_HOST || process.env.RP_PUBLIC_HOST || "record-platform.test";
  const ns = process.env.VERIFY_HTTP3_NAMESPACE || "ingress-nginx";
  const svc = process.env.VERIFY_HTTP3_SERVICE || "caddy-h3";
  const metricsPath =
    process.env.VERIFY_HTTP3_PROM || join(repoRoot, "bench_logs", "http3_edge_metrics.prom");

  const start = Date.now();

  const http3Probe = checkHttp3(host);
  const ports = getServicePorts(ns, svc);
  const udpCheck = ports ? checkUdpPort(ports) : { ok: false, reason: "svc_missing" };

  const isK3s = detectK3s();

  const duration = Date.now() - start;
  const overall_ok =
    udpCheck.ok && (http3Probe === null ? true : http3Probe === true);

  const mode = classify(duration, overall_ok);

  const result = {
    ok: overall_ok,
    http3_ok: http3Probe,
    udp_ok: udpCheck.ok,
    udp_reason: udpCheck.reason || null,
    udp_nodeport: udpCheck.nodePort || null,
    k3s_detected: isK3s,
    duration_ms: duration,
    mode,
  };

  const edgeLbMode = process.env.EDGE_LB_MODE || "metallb-only";
  result.edge_lb_mode = edgeLbMode;
  if (isK3s && !udpCheck.ok && edgeLbMode !== "metallb-only") {
    result.warning = "k3s_detected_udp_unreliable_use_nodeport";
  }

  writeProm(metricsPath, result);

  console.log(JSON.stringify(result, null, 2));

  process.exit(overall_ok ? 0 : 1);
}

main();
