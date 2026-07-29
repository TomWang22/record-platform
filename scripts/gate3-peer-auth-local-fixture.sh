#!/usr/bin/env bash
# Local TLS integration fixture for Gate 3 peer-auth repair (NOT an acceptance root).
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${RP_GATE3_FIXTURE_OUT:-/tmp/record-platform-gate3-rca/local-tls-fixture}"
mkdir -p "$OUT"
cd "$REPO_ROOT/services/common"
pnpm run build >/dev/null

export RP_GATE3_FIXTURE_OUT="$OUT"
export REPO_ROOT
node <<'NODE'
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const { createRpGrpcServer } = require("./dist/grpc-server-factory.js");

const repo = process.env.REPO_ROOT;
const certs = path.join(repo, "certs");
const out = process.env.RP_GATE3_FIXTURE_OUT;

function loadPair(name) {
  const crt = fs.readFileSync(path.join(certs, `${name}.crt`));
  const key = fs.readFileSync(path.join(certs, `${name}.key`));
  const chain = fs.existsSync(path.join(certs, "dev-chain.pem"))
    ? fs.readFileSync(path.join(certs, "dev-chain.pem"))
    : fs.readFileSync(path.join(certs, "dev-root.pem"));
  const intermediate = fs.readFileSync(path.join(certs, "dev-intermediate.pem"));
  return { crt, key, chain, intermediate };
}

function fp(pem) {
  const tmp = path.join(out, `fp-${process.pid}-${Math.random().toString(16).slice(2)}.pem`);
  fs.writeFileSync(tmp, pem);
  try {
    const s = execSync(`openssl x509 -in ${tmp} -noout -fingerprint -sha256`, { encoding: "utf8" });
    return s.split("=")[1].replace(/:/g, "").trim().toLowerCase();
  } finally {
    fs.unlinkSync(tmp);
  }
}

const auth = loadPair("auth-service");
const gateway = loadPair("api-gateway");
const unknownDir = "/tmp/gate3-live-matrix/fixtures/unknown-identity";
const hasUnknown = fs.existsSync(path.join(unknownDir, "tls-chain.crt"));

const def = protoLoader.loadSync(path.join(repo, "proto/auth.proto"), {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const pkg = grpc.loadPackageDefinition(def);

process.env.SERVICE_NAME = "auth-service";
process.env.OTEL_SERVICE_NAME = "auth-service";

let handlerInvocations = 0;
const server = createRpGrpcServer({ peerAuthServiceName: "auth-service" });
server.addService(pkg.auth.AuthService.service, {
  ValidateToken: (_call, cb) => {
    handlerInvocations += 1;
    cb(null, { valid: false, userId: "", email: "", roles: [] });
  },
  RefreshToken: (_call, cb) => {
    handlerInvocations += 1;
    cb(null, { accessToken: "", refreshToken: "" });
  },
});

const certChain = Buffer.concat([auth.crt, Buffer.from("\n"), auth.intermediate]);
const creds = grpc.ServerCredentials.createSsl(
  auth.chain,
  [{ private_key: auth.key, cert_chain: certChain }],
  true,
);

function listen() {
  return new Promise((resolve, reject) => {
    server.bindAsync("127.0.0.1:0", creds, (err, p) => (err ? reject(err) : resolve(p)));
  });
}

function clientCreds(leafCrt, leafKey, ca) {
  return grpc.credentials.createSsl(ca, leafKey, leafCrt);
}

async function callValidate(name, leafCrt, leafKey, ca, metadata) {
  handlerInvocations = 0;
  const t0 = Date.now();
  const client = new pkg.auth.AuthService(`127.0.0.1:${port}`, clientCreds(leafCrt, leafKey, ca), {
    "grpc.ssl_target_name_override": "auth-service",
    "grpc.default_authority": "auth-service",
  });
  const md = new grpc.Metadata();
  if (metadata) for (const [k, v] of Object.entries(metadata)) md.set(k, v);
  const result = await new Promise((resolve) => {
    client.ValidateToken({ token: "x" }, md, (err) => {
      if (err) resolve({ code: err.code, details: String(err.details || err.message), ok: false });
      else resolve({ code: grpc.status.OK, details: "OK", ok: true });
    });
  });
  try { client.close(); } catch {}
  return {
    name,
    ...result,
    handler_invocations: handlerInvocations,
    elapsed_ms: Date.now() - t0,
    client_fp: fp(leafCrt),
    server_fp: fp(auth.crt),
  };
}

let port;
const rows = [];

(async () => {
  port = await listen();

  rows.push({
    ...(await callValidate("allow_api_gateway", gateway.crt, gateway.key, gateway.chain)),
    expected: "ALLOW",
  });

  if (hasUnknown) {
    rows.push({
      ...(await callValidate(
        "deny_unknown_identity",
        fs.readFileSync(path.join(unknownDir, "tls-chain.crt")),
        fs.readFileSync(path.join(unknownDir, "tls.key")),
        fs.readFileSync(path.join(certs, "dev-chain.pem")),
      )),
      expected: "PERMISSION_DENIED",
    });
  } else {
    rows.push({ name: "deny_unknown_identity", code: -1, details: "missing fixture", handler_invocations: -1, expected: "PERMISSION_DENIED" });
  }

  // 3. service-allowed analytics calling method-restricted GetUser
  {
    const analytics = loadPair("analytics-service");
    handlerInvocations = 0;
    const t0 = Date.now();
    const client = new pkg.auth.AuthService(`127.0.0.1:${port}`, clientCreds(analytics.crt, analytics.key, analytics.chain), {
      "grpc.ssl_target_name_override": "auth-service",
      "grpc.default_authority": "auth-service",
    });
    const result = await new Promise((resolve) => {
      client.RefreshToken({ refresh_token: "x" }, (err) => {
        if (err) resolve({ code: err.code, details: String(err.details || err.message), ok: false });
        else resolve({ code: grpc.status.OK, details: "OK", ok: true });
      });
    });
    try { client.close(); } catch {}
    rows.push({
      name: "deny_forbidden_rpc",
      ...result,
      handler_invocations: handlerInvocations,
      elapsed_ms: Date.now() - t0,
      client_fp: fp(analytics.crt),
      server_fp: fp(auth.crt),
      expected: "PERMISSION_DENIED",
    });
  }

  rows.push({
    ...(await callValidate(
      "deny_metadata_spoof",
      fs.readFileSync(path.join(unknownDir, "tls-chain.crt")),
      fs.readFileSync(path.join(unknownDir, "tls.key")),
      fs.readFileSync(path.join(certs, "dev-chain.pem")),
      { "x-rp-peer": "api-gateway", "x-service-name": "api-gateway", "x-caller-service": "api-gateway" },
    )),
    expected: "PERMISSION_DENIED",
  });

  {
    const t0 = Date.now();
    let code = -1;
    let details = "";
    const client = new pkg.auth.AuthService(`127.0.0.1:${port}`, grpc.credentials.createSsl(gateway.chain), {
      "grpc.ssl_target_name_override": "auth-service",
      "grpc.default_authority": "auth-service",
    });
    await new Promise((resolve) => {
      client.ValidateToken({ token: "x" }, (err) => {
        code = err?.code ?? grpc.status.OK;
        details = String(err?.details || err?.message || "OK");
        resolve();
      });
    });
    try { client.close(); } catch {}
    rows.push({
      name: "tls_no_client_cert",
      ok: false,
      code,
      details,
      handler_invocations: 0,
      elapsed_ms: Date.now() - t0,
      expected: "TLS_REJECTION",
    });
  }

  {
    const t0 = Date.now();
    let code = -1;
    let details = "";
    const client = new pkg.auth.AuthService(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        code = grpc.status.DEADLINE_EXCEEDED;
        details = "timeout";
        resolve();
      }, 2000);
      client.ValidateToken({ token: "x" }, (err) => {
        clearTimeout(timer);
        code = err?.code ?? grpc.status.OK;
        details = String(err?.details || err?.message || "OK");
        resolve();
      });
    });
    try { client.close(); } catch {}
    rows.push({
      name: "plaintext_rejection",
      ok: false,
      code,
      details,
      handler_invocations: 0,
      elapsed_ms: Date.now() - t0,
      expected: "REJECTION",
    });
  }

  function passRow(r) {
    if (r.name === "allow_api_gateway") return r.code === grpc.status.OK && r.handler_invocations === 1;
    if (r.name === "deny_unknown_identity") return r.code === grpc.status.PERMISSION_DENIED && r.handler_invocations === 0;
    if (r.name === "deny_forbidden_rpc") return r.code === grpc.status.PERMISSION_DENIED && r.handler_invocations === 0;
    if (r.name === "deny_metadata_spoof") return r.code === grpc.status.PERMISSION_DENIED && r.handler_invocations === 0;
    if (r.name === "tls_no_client_cert") return r.code !== grpc.status.OK;
    if (r.name === "plaintext_rejection") return r.code !== grpc.status.OK;
    return false;
  }

  const evaluated = rows.map((r) => ({ ...r, passed: passRow(r) }));
  const summary = {
    fixture: "gate3-peer-auth-local-tls",
    port,
    rows_expected: 6,
    rows_tested: evaluated.length,
    rows_passed: evaluated.filter((r) => r.passed).length,
    rows_failed: evaluated.filter((r) => !r.passed).length,
    DeadlineExceeded_on_authz_deny: evaluated.filter(
      (r) => String(r.name).startsWith("deny_") && r.code === grpc.status.DEADLINE_EXCEEDED,
    ).length,
    rows: evaluated,
  };
  fs.writeFileSync(path.join(out, "fixture-result.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
  server.tryShutdown(() => {
    process.exit(summary.rows_failed === 0 ? 0 : 1);
  });
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
NODE
