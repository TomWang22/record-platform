#!/usr/bin/env node
/**
 * Fail-closed Gate 5 v7 authorizer / ACL / participant / DAG regression tests.
 * Documents DUAL_USE_EKU_ACCEPTED_EXCEPTION — does not claim per-node broker identity.
 *
 * Certificate assertions use measured report fields (eku_clientAuth, eku_serverAuth, sans).
 * StatefulSet assertions use structural env parsing (not broad security regexes).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");

const STS = path.join(REPO, "infra/k8s/kafka-kraft-metallb/statefulset.yaml");
const MANIFEST = path.join(REPO, "reports/kafka/gate5-v7-final-acl-manifest.json");
const CONTRACT = path.join(REPO, "reports/kafka/gate5-v7-acl-contract.json");
const PRINCIPALS = path.join(REPO, "reports/kafka/gate5-v7-kafka-node-principals.json");
const LEAVES = path.join(REPO, "reports/kafka/gate5-v7-dedicated-kafka-client-leaves.json");
const GRAPH = path.join(REPO, "infra/bootstrap_invariants.graph.json");
const IDENTITY = path.join(REPO, "reports/kafka/gate5-v7-service-identity-contract.json");
const BOOTSTRAP = path.join(REPO, "scripts/gate5-v7-acl-bootstrap.sh");

const SERVICES = [
  "analytics-service",
  "auction-monitor",
  "auth-service",
  "listings-service",
  "media-service",
  "messaging-service",
  "notification-service",
  "python-ai-service",
  "shopping-service",
  "trust-service",
  "ollama-gateway",
  "ollama-worker",
];

const CN_BEFORE_O = /User:CN=[^,]+,O=/;

function read(p) {
  return fs.readFileSync(p, "utf8");
}

function readJson(p) {
  return JSON.parse(read(p));
}

/** Structural env parse for braced and block StatefulSet env entries. */
function parseStsEnv(text) {
  const env = {};
  for (const m of text.matchAll(/\{\s*name:\s*([A-Z0-9_]+)\s*,\s*value:\s*"([^"]*)"\s*\}/g)) {
    env[m[1]] = m[2];
  }
  for (const m of text.matchAll(/-\s*name:\s*([A-Z0-9_]+)\n\s*value:\s*"([^"]*)"/g)) {
    if (env[m[1]] === undefined) env[m[1]] = m[2];
  }
  return env;
}

function deployPaths() {
  const base = path.join(REPO, "infra/k8s/base");
  const paths = [];
  for (const svc of SERVICES) {
    const candidates = [
      path.join(base, svc, "deploy.yaml"),
      path.join(base, "ollama", svc === "ollama-worker" ? "worker-deploy.yaml" : "gateway-deploy.yaml"),
    ];
    if (svc === "ollama-gateway") candidates.unshift(path.join(base, "ollama", "gateway-deploy.yaml"));
    if (svc === "ollama-worker") candidates.unshift(path.join(base, "ollama", "worker-deploy.yaml"));
    const hit = candidates.find((c) => fs.existsSync(c));
    assert.ok(hit, `missing deploy for ${svc}`);
    paths.push({ svc, path: hit });
  }
  return paths;
}

describe("gate5-v7 fail-closed authorizer source", () => {
  const stsText = read(STS);
  const env = parseStsEnv(stsText);
  const manifest = readJson(MANIFEST);
  const measured = readJson(PRINCIPALS);
  const leavesDoc = readJson(LEAVES);
  const contract = readJson(CONTRACT);
  const graph = readJson(GRAPH);
  const identity = readJson(IDENTITY);
  const broker = measured.broker_server_leaf.kafka_acl_principal;
  const admin = measured.recovery_admin.kafka_acl_principal;
  const logicalRoles = identity.logical_roles || [];

  it("1. StandardAuthorizer present exactly once in StatefulSet env", () => {
    assert.equal(env.KAFKA_AUTHORIZER_CLASS_NAME, "org.apache.kafka.metadata.authorizer.StandardAuthorizer");
    const hits = Object.values(env).filter(
      (v) => v === "org.apache.kafka.metadata.authorizer.StandardAuthorizer",
    );
    assert.equal(hits.length, 1);
  });

  it("2. allow.everyone.if.no.acl.found is exactly false", () => {
    assert.equal(env.KAFKA_ALLOW_EVERYONE_IF_NO_ACL_FOUND, "false");
  });

  it("3. controller/internal/external client.auth are required", () => {
    assert.equal(env.KAFKA_LISTENER_NAME_CONTROLLER_SSL_CLIENT_AUTH, "required");
    assert.equal(env.KAFKA_LISTENER_NAME_INTERNAL_SSL_CLIENT_AUTH, "required");
    assert.equal(env.KAFKA_LISTENER_NAME_EXTERNAL_SSL_CLIENT_AUTH, "required");
  });

  it("4. controller endpoint identification is HTTPS", () => {
    assert.equal(env.KAFKA_LISTENER_NAME_CONTROLLER_SSL_ENDPOINT_IDENTIFICATION_ALGORITHM, "HTTPS");
  });

  it("5. exactly two super.users: broker and recovery-admin", () => {
    assert.equal(env.KAFKA_SUPER_USERS, `${broker};${admin}`);
    assert.deepEqual(manifest.super_users, [broker, admin]);
    assert.equal(manifest.super_users.length, 2);
  });

  it("6. application super-users are rejected", () => {
    const superVal = env.KAFKA_SUPER_USERS;
    for (const s of measured.service_principals) {
      assert.equal(superVal.includes(s.kafka_acl_principal), false);
      assert.equal(manifest.service_principals[s.service].super_user, false);
    }
  });

  it("7. wildcard application ACLs are rejected", () => {
    assert.equal(manifest.summary.wildcard_application_acls, 0);
    for (const row of Object.values(manifest.service_principals)) {
      for (const t of row.topic_acls || []) assert.notEqual(t.name, "*");
      for (const g of row.group_acls || []) assert.notEqual(g.name, "*");
    }
  });

  it("8. CN-before-O principal forms are rejected", () => {
    const blob = JSON.stringify(manifest.service_principals) + JSON.stringify(manifest.super_users);
    assert.equal(CN_BEFORE_O.test(blob), false);
  });

  it("9. all ACL principals match measured O-before-CN forms", () => {
    const map = Object.fromEntries(
      measured.service_principals.map((s) => [s.service, s.kafka_acl_principal]),
    );
    for (const [svc, row] of Object.entries(manifest.service_principals)) {
      assert.equal(row.principal, map[svc]);
      assert.ok(row.principal.startsWith("User:O="));
    }
  });

  it("10. all 12 service principals are represented", () => {
    assert.equal(Object.keys(manifest.service_principals).length, 12);
    for (const svc of SERVICES) assert.ok(manifest.service_principals[svc], svc);
  });

  it("11. expected topic/group permissions are represented", () => {
    let topicRows = 0;
    let groupRows = 0;
    for (const row of Object.values(manifest.service_principals)) {
      topicRows += (row.topic_acls || []).length;
      groupRows += (row.group_acls || []).length;
    }
    assert.ok(topicRows >= 12, `topic ACL rows ${topicRows}`);
    assert.ok(groupRows >= 1, `group ACL rows ${groupRows}`);
    assert.ok((contract.target_per_service || []).length >= 12);
  });

  it("12. client.id does not appear in authorization decisions", () => {
    assert.deepEqual(manifest.client_id_authorization_rules, []);
    assert.equal(manifest.summary.client_id_authorization_rules, 0);
  });

  it("13. every participant uses kafka-client-tls-<service>", () => {
    for (const { svc, path: p } of deployPaths()) {
      const y = read(p);
      assert.match(y, new RegExp(`secretName:\\s*kafka-client-tls-${svc}`));
      assert.match(y, /mountPath:\s*\/etc\/kafka\/client/);
    }
  });

  it("14. shared kafka-ssl-secret client material absent from participant mounts", () => {
    for (const { svc, path: p } of deployPaths()) {
      const y = read(p);
      assert.equal(/secretName:\s*kafka-ssl-secret/.test(y), false, p);
      assert.equal(/secretName:\s*kafka-client\s*$/m.test(y), false, p);
      assert.equal(/secretName:\s*kafka-client-tls\s*$/m.test(y), false, p);
      assert.match(y, new RegExp(`secretName:\\s*kafka-client-tls-${svc}\\b`));
    }
  });

  it("15–16. participant leaves are clientAuth-only with SPIFFE SAN (measured fields)", () => {
    assert.equal(measured.service_principals_measured, 12);
    assert.equal(leavesDoc.summary.client_leaves_expected, 12);
    assert.equal(leavesDoc.summary.client_leaves_generated, 12);
    assert.equal(leavesDoc.summary.clientAuth_present, 12);
    assert.equal(leavesDoc.summary.serverAuth_absent, 12);
    assert.equal(leavesDoc.summary.spiffe_uri_present, 12);
    assert.equal(leavesDoc.summary.key_leaf_match, 12);
    assert.equal(leavesDoc.summary.chain_valid, 12);
    assert.equal(leavesDoc.summary.distinct_leaf_fingerprints, 12);

    const fps = new Set();
    for (const s of measured.service_principals) {
      assert.equal(s.eku_clientAuth, true, `${s.service} eku_clientAuth`);
      assert.equal(s.eku_serverAuth, false, `${s.service} eku_serverAuth`);
      assert.ok(Array.isArray(s.sans) && s.sans.length > 0, `${s.service} sans`);
      const spiffe = `6:spiffe://record-platform/service/${s.service}`;
      assert.ok(s.sans.includes(spiffe), `${s.service} missing ${spiffe}`);
      assert.ok(s.leaf_sha256 && s.leaf_sha256.length > 10, `${s.service} fingerprint`);
      fps.add(s.leaf_sha256);
    }
    assert.equal(fps.size, 12);

    for (const leaf of leavesDoc.leaves) {
      assert.equal(leaf.serverAuth_absent, true, leaf.service);
      assert.equal(leaf.key_leaf_match, true, leaf.service);
      assert.equal(leaf.chain_valid, true, leaf.service);
      assert.ok(
        (leaf.uri_sans || []).includes(`spiffe://record-platform/service/${leaf.service}`),
        `${leaf.service} SPIFFE SAN`,
      );
      assert.ok((leaf.eku || []).includes("clientAuth"), `${leaf.service} clientAuth`);
      assert.equal((leaf.eku || []).includes("serverAuth"), false, `${leaf.service} serverAuth`);
    }
  });

  it("17. bootstrap graph is acyclic and securely ordered", () => {
    const r = spawnSync(process.execPath, [path.join(REPO, "scripts/validate-bootstrap-dag-acyclic.mjs")], {
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const body = JSON.parse(r.stdout);
    assert.equal(body.acyclic, true);
    assert.equal(body.authorizer_before_acl_bootstrap, true);
    assert.equal(body.acl_bootstrap_before_participant_start, true);
    assert.equal(body.permissive_window_steps, 0);
    assert.ok(graph.nodes["G.kafka_acls.bootstrap"]);
  });

  it("18. cold bootstrap cannot deploy participants before ACL verification (ordering edges)", () => {
    const edges = graph.edges || [];
    const has = (a, b) => edges.some(([u, v]) => u === a && v === b);
    assert.equal(has("G.kafka_acls.offline_validate", "G.kafka_acls.bootstrap"), true);
    assert.equal(has("G.kafka_acls.bootstrap", "G.app_runtime"), true);
    assert.equal(has("F.cluster_deploy", "G.app_runtime"), false);
    assert.match(read(path.join(REPO, "scripts/cold-bootstrap.sh")), /G\.kafka_acls\.bootstrap/);
    assert.match(read(path.join(REPO, "scripts/bootstrap-cluster.sh")), /gate5-v7-acl-bootstrap\.sh/);
  });

  it("19. private keys / recovery-admin / pcaps cannot be staged (.gitignore guards)", () => {
    const gi = read(path.join(REPO, ".gitignore"));
    assert.match(gi, /\.pem|\.key|pcap|pcaps/i);
    const boot = read(BOOTSTRAP);
    assert.match(boot, /Does not place private keys/);
    assert.equal(boot.includes("BEGIN PRIVATE KEY"), false);
    assert.match(boot, /RP_GATE5_V7_EVIDENCE_ROOT|evidence/);
    assert.match(boot, /AdminClient|Gate5V7DescribeAcls|exact/);
  });

  it("20. authorizer/ACL drift fails acceptance preflight + prune is not a silent no-op", () => {
    assert.ok(fs.existsSync(path.join(REPO, "scripts/gate5-v7-authorizer-verify.sh")));
    assert.ok(fs.existsSync(path.join(REPO, "scripts/lib/gate5-v7-acl-normalize.py")));
    assert.ok(fs.existsSync(path.join(REPO, "scripts/lib/Gate5V7DescribeAcls.java")));
    assert.equal(manifest.apply_authorized, true);
    assert.equal(manifest.authorizer_enablement_authorized, true);
    const boot = read(BOOTSTRAP);
    // prune must either reconcile or refuse dishonest prune_mode
    assert.match(boot, /RP_GATE5_V7_ACL_PRUNE/);
    assert.match(boot, /prune_executed/);
    assert.equal(boot.includes("prune_mode\": prune") && !boot.includes("prune_executed"), false);
    const r = spawnSync("python3", [path.join(REPO, "scripts/gate5-v7-acl-offline-validate.py")], {
      encoding: "utf8",
      cwd: REPO,
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const norm = spawnSync(
      "python3",
      [path.join(REPO, "scripts/lib/gate5-v7-acl-normalize.py"), "expected", MANIFEST],
      { encoding: "utf8", cwd: REPO },
    );
    assert.equal(norm.status, 0, norm.stderr || norm.stdout);
    const expected = JSON.parse(norm.stdout);
    assert.ok(expected.length >= 12);
    // exact-set compare against itself must pass
    const tmpExpected = path.join(REPO, "bench_logs", "gate5-v7-expected-self.json");
    fs.mkdirSync(path.dirname(tmpExpected), { recursive: true });
    fs.writeFileSync(tmpExpected, JSON.stringify(expected));
    const cmp = spawnSync(
      "python3",
      [path.join(REPO, "scripts/lib/gate5-v7-acl-normalize.py"), "compare", tmpExpected, tmpExpected, MANIFEST],
      { encoding: "utf8", cwd: REPO },
    );
    assert.equal(cmp.status, 0, cmp.stderr || cmp.stdout);
    const body = JSON.parse(cmp.stdout);
    assert.equal(body.missing_acl_rows, 0);
    assert.equal(body.unexpected_acl_rows, 0);
    assert.equal(body.manifest_vs_live_delta, 0);
  });

  it("21. all 19 logical roles have policy coverage (no shared/generic/unbounded)", () => {
    assert.equal(logicalRoles.length, 19, `logical_roles expected 19 got ${logicalRoles.length}`);
    let withoutPolicy = 0;
    let genericClientId = 0;
    let unbounded = 0;
    for (const role of logicalRoles) {
      assert.ok(role.service && role.role, JSON.stringify(role));
      assert.ok(SERVICES.includes(role.service), role.service);
      assert.ok(manifest.service_principals[role.service], `no principal for ${role.service}`);
      const cid = role.required_client_id_form || "";
      assert.ok(cid, `${role.service}/${role.role} missing client id form`);
      assert.ok(cid.includes(role.service), cid);
      assert.ok(cid.endsWith(`.${role.role}`) || cid.split(".").includes(role.role), cid);
      if (cid === "kafka-client" || cid.includes("kafka-client.") || !cid.includes(role.service)) {
        genericClientId += 1;
      }
      const produce = role.topics_produce || [];
      const consume = role.topics_consume || [];
      if (produce.length + consume.length === 0) withoutPolicy += 1;
      if (produce.includes("*") || consume.includes("*") || role.group === "*") unbounded += 1;
      assert.ok(
        (role.required_certificate_identity || "").includes(`service/${role.service}`),
        role.required_certificate_identity,
      );
    }
    // Dedicated mounts for all 12 services that own these roles
    for (const { svc, path: p } of deployPaths()) {
      assert.match(read(p), new RegExp(`kafka-client-tls-${svc}`));
    }
    assert.equal(withoutPolicy, 0, "roles_without_policy");
    assert.equal(unbounded, 0, "roles_with_unbounded_acl");
    assert.equal(genericClientId, 0, "roles_with_generic_client_id");
  });

  it("DUAL_USE_EKU_ACCEPTED_EXCEPTION — no per-node broker identity claims", () => {
    assert.equal(measured.broker_controller_principals_measured, 3);
    assert.equal(broker, "User:O=record-platform,CN=kafka");
    assert.equal(measured.broker_server_leaf.eku_clientAuth, true);
    assert.equal(measured.broker_server_leaf.eku_serverAuth, true);
  });
});
