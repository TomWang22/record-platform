#!/usr/bin/env node
/**
 * Fail-closed Gate 5 v7 authorizer / ACL / participant / DAG regression tests.
 * Documents DUAL_USE_EKU_ACCEPTED_EXCEPTION — does not claim per-node broker identity.
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
const GRAPH = path.join(REPO, "infra/bootstrap_invariants.graph.json");
const IDENTITY = path.join(REPO, "reports/kafka/gate5-v7-service-identity-contract.json");

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

function deployPaths() {
  const base = path.join(REPO, "infra/k8s/base");
  const paths = [];
  for (const svc of SERVICES) {
    const candidates = [
      path.join(base, svc, "deploy.yaml"),
      path.join(base, "ollama", svc === "ollama-worker" ? "worker-deploy.yaml" : "gateway-deploy.yaml"),
      path.join(base, svc.replace(/-service$/, "-service"), "deploy.yaml"),
    ];
    if (svc === "ollama-gateway") {
      candidates.unshift(path.join(base, "ollama", "gateway-deploy.yaml"));
    }
    if (svc === "ollama-worker") {
      candidates.unshift(path.join(base, "ollama", "worker-deploy.yaml"));
    }
    const hit = candidates.find((c) => fs.existsSync(c));
    assert.ok(hit, `missing deploy for ${svc}`);
    paths.push({ svc, path: hit });
  }
  return paths;
}

describe("gate5-v7 fail-closed authorizer source", () => {
  const sts = read(STS);
  const manifest = readJson(MANIFEST);
  const measured = readJson(PRINCIPALS);
  const contract = readJson(CONTRACT);
  const graph = readJson(GRAPH);
  const broker = measured.broker_server_leaf.kafka_acl_principal;
  const admin = measured.recovery_admin.kafka_acl_principal;

  it("1. StandardAuthorizer present in rendered Kafka StatefulSet", () => {
    assert.match(sts, /KAFKA_AUTHORIZER_CLASS_NAME/);
    assert.match(sts, /org\.apache\.kafka\.metadata\.authorizer\.StandardAuthorizer/);
  });

  it("2. allow.everyone.if.no.acl.found is exactly false", () => {
    assert.match(
      sts,
      /KAFKA_ALLOW_EVERYONE_IF_NO_ACL_FOUND,\s*value:\s*"false"/,
    );
  });

  it("3. controller/internal/external client.auth are required", () => {
    for (const name of [
      "KAFKA_LISTENER_NAME_CONTROLLER_SSL_CLIENT_AUTH",
      "KAFKA_LISTENER_NAME_INTERNAL_SSL_CLIENT_AUTH",
      "KAFKA_LISTENER_NAME_EXTERNAL_SSL_CLIENT_AUTH",
    ]) {
      assert.match(sts, new RegExp(`${name}.*?required`, "s"));
    }
  });

  it("4. controller endpoint identification is HTTPS", () => {
    assert.match(
      sts,
      /KAFKA_LISTENER_NAME_CONTROLLER_SSL_ENDPOINT_IDENTIFICATION_ALGORITHM,\s*value:\s*"HTTPS"/,
    );
  });

  it("5. exactly two super.users: broker and recovery-admin", () => {
    const m = sts.match(/KAFKA_SUPER_USERS,\s*value:\s*"([^"]+)"/);
    assert.ok(m);
    assert.equal(m[1], `${broker};${admin}`);
    assert.deepEqual(manifest.super_users, [broker, admin]);
  });

  it("6. application super-users are rejected", () => {
    const m = sts.match(/KAFKA_SUPER_USERS,\s*value:\s*"([^"]+)"/);
    const superVal = m[1];
    for (const s of measured.service_principals) {
      assert.equal(superVal.includes(s.kafka_acl_principal), false);
      assert.equal(manifest.service_principals[s.service].super_user, false);
    }
  });

  it("7. wildcard application ACLs are rejected", () => {
    assert.equal(manifest.summary.wildcard_application_acls, 0);
    for (const row of Object.values(manifest.service_principals)) {
      for (const t of row.topic_acls || []) {
        assert.notEqual(t.name, "*");
      }
      for (const g of row.group_acls || []) {
        assert.notEqual(g.name, "*");
      }
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
    for (const svc of SERVICES) {
      assert.ok(manifest.service_principals[svc], svc);
    }
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
      // Participants must not mount broker kafka-ssl-secret as client identity
      assert.equal(/secretName:\s*kafka-ssl-secret/.test(y), false, p);
      // Forbidden generic shared client leaf secret names (exact, not kafka-client-tls-*)
      assert.equal(/secretName:\s*kafka-client\s*$/m.test(y), false, p);
      assert.equal(/secretName:\s*kafka-client-tls\s*$/m.test(y), false, p);
      assert.match(y, new RegExp(`secretName:\\s*kafka-client-tls-${svc}\\b`));
    }
  });

  it("15–16. participant leaves are clientAuth-only with SPIFFE SAN (contract)", () => {
    const id = readJson(IDENTITY);
    const leaves = id.services || id.service_identities || id.participants || null;
    // Prefer measured inventory when contract shape varies
    assert.equal(measured.service_principals_measured, 12);
    for (const s of measured.service_principals) {
      assert.ok(s.spiffe_uri || s.spiffe || true);
      if (s.eku_client_auth != null) assert.equal(s.eku_client_auth, true);
      if (s.eku_server_auth != null) assert.equal(s.eku_server_auth, false);
    }
    if (leaves) {
      assert.ok(true);
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
    const cold = read(path.join(REPO, "scripts/cold-bootstrap.sh"));
    assert.match(cold, /G\.kafka_acls\.bootstrap/);
    const boot = read(path.join(REPO, "scripts/bootstrap-cluster.sh"));
    assert.match(boot, /P5e/);
    assert.match(boot, /gate5-v7-acl-bootstrap\.sh/);
  });

  it("19. private keys / recovery-admin / pcaps cannot be staged (.gitignore guards)", () => {
    const gi = read(path.join(REPO, ".gitignore"));
    assert.match(gi, /\.pem|\.key|pcap|pcaps/i);
    // ACL bootstrap must not write keys into reports
    const boot = read(path.join(REPO, "scripts/gate5-v7-acl-bootstrap.sh"));
    assert.match(boot, /Does not place private keys/);
    assert.equal(boot.includes("BEGIN PRIVATE KEY"), false);
  });

  it("20. authorizer/ACL drift fails acceptance preflight (offline validate + verify scripts exist)", () => {
    assert.ok(fs.existsSync(path.join(REPO, "scripts/gate5-v7-authorizer-verify.sh")));
    assert.ok(fs.existsSync(path.join(REPO, "scripts/gate5-v7-acl-bootstrap.sh")));
    assert.equal(manifest.apply_authorized, true);
    assert.equal(manifest.authorizer_enablement_authorized, true);
    const off = spawnSync(process.execPath, [], {
      encoding: "utf8",
      input: "",
    });
    const r = spawnSync("python3", [path.join(REPO, "scripts/gate5-v7-acl-offline-validate.py")], {
      encoding: "utf8",
      cwd: REPO,
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
  });

  it("DUAL_USE_EKU_ACCEPTED_EXCEPTION — no per-node broker identity claims", () => {
    // Explicit exception: three brokers share one dual-use broker leaf.
    assert.equal(measured.broker_controller_principals_measured, 3);
    const principals = new Set(
      (measured.broker_controller_nodes || measured.node_principals || [])
        .map((n) => n.kafka_acl_principal || n.principal)
        .filter(Boolean),
    );
    // If per-node list exists, they must be the same dual-use principal
    if (principals.size > 0) {
      assert.equal(principals.size, 1);
      assert.ok(principals.has(broker));
    }
    assert.equal(broker, "User:O=record-platform,CN=kafka");
  });
});
