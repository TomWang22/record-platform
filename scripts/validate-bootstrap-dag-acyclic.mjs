#!/usr/bin/env node
/**
 * Fail if infra/bootstrap_invariants.graph.json has a cycle or insecure Kafka auth ordering.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const graphPath = join(repoRoot, "infra/bootstrap_invariants.graph.json");
const graph = JSON.parse(readFileSync(graphPath, "utf8"));
const nodes = Object.keys(graph.nodes || {});
const edges = graph.edges || [];

const adj = new Map();
const indeg = new Map();
for (const n of nodes) {
  adj.set(n, []);
  indeg.set(n, 0);
}
for (const [u, v] of edges) {
  if (!adj.has(u) || !indeg.has(v)) {
    console.error(`unknown edge node: ${u} -> ${v}`);
    process.exit(1);
  }
  adj.get(u).push(v);
  indeg.set(v, indeg.get(v) + 1);
}

const q = [...indeg.entries()].filter(([, d]) => d === 0).map(([n]) => n).sort();
const out = [];
while (q.length) {
  const u = q.shift();
  out.push(u);
  for (const v of (adj.get(u) || []).slice().sort()) {
    indeg.set(v, indeg.get(v) - 1);
    if (indeg.get(v) === 0) {
      q.push(v);
      q.sort();
    }
  }
}

if (out.length !== nodes.length) {
  const stuck = [...indeg.entries()].filter(([, d]) => d > 0).map(([n]) => n);
  console.error("FAIL: bootstrap DAG has a cycle");
  console.error("stuck_nodes=", stuck.join(","));
  process.exit(1);
}

if (nodes.includes("A.namespace_integrity_static")) {
  console.error("FAIL: legacy node A.namespace_integrity_static must be split");
  process.exit(1);
}
if (!nodes.includes("A.namespace_integrity_static_pre_reset")) {
  console.error("FAIL: missing A.namespace_integrity_static_pre_reset");
  process.exit(1);
}
if (!nodes.includes("D.namespace_integrity_static_prebuild")) {
  console.error("FAIL: missing D.namespace_integrity_static_prebuild");
  process.exit(1);
}
if (!nodes.includes("F.namespace.prepare")) {
  console.error("FAIL: missing F.namespace.prepare");
  process.exit(1);
}
if (nodes.includes("F.kafka_client_workloads.wire")) {
  console.error("FAIL: F.kafka_client_workloads.wire must be renamed to .verify");
  process.exit(1);
}
if (!nodes.includes("G.kafka_authorizer.preflight") && !nodes.includes("G.kafka_authorizer.verify")) {
  console.error("FAIL: missing G.kafka_authorizer.preflight|verify");
  process.exit(1);
}
if (!nodes.includes("G.kafka_acls.bootstrap")) {
  console.error("FAIL: missing G.kafka_acls.bootstrap (fail-closed ACL apply required)");
  process.exit(1);
}
if (!nodes.includes("G.kafka_acls.offline_validate")) {
  console.error("FAIL: missing G.kafka_acls.offline_validate");
  process.exit(1);
}

const hasEdge = (a, b) => edges.some(([u, v]) => u === a && v === b);
const authNode = nodes.includes("G.kafka_authorizer.verify")
  ? "G.kafka_authorizer.verify"
  : "G.kafka_authorizer.preflight";

if (!hasEdge(authNode, "G.kafka_acls.offline_validate") && !hasEdge(authNode, "G.kafka_acls.bootstrap")) {
  console.error("FAIL: authorizer verify must precede ACL offline/bootstrap");
  process.exit(1);
}
if (!hasEdge("G.kafka_acls.offline_validate", "G.kafka_acls.bootstrap")) {
  console.error("FAIL: offline ACL validate must precede ACL bootstrap");
  process.exit(1);
}
if (!hasEdge("G.kafka_acls.bootstrap", "G.app_runtime")) {
  console.error("FAIL: ACL bootstrap must precede G.app_runtime");
  process.exit(1);
}
if (hasEdge("F.cluster_deploy", "G.app_runtime")) {
  console.error("FAIL: F.cluster_deploy must not bypass ACL bootstrap to G.app_runtime");
  process.exit(1);
}

// Topological: authorizer before bootstrap before app_runtime
const idx = Object.fromEntries(out.map((n, i) => [n, i]));
if (!(idx[authNode] < idx["G.kafka_acls.bootstrap"] && idx["G.kafka_acls.bootstrap"] < idx["G.app_runtime"])) {
  console.error("FAIL: insecure topological order for authorizer/ACL/app_runtime");
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      acyclic: true,
      nodes: nodes.length,
      edges: edges.length,
      topological_order_length: out.length,
      authorizer_before_acl_bootstrap: true,
      acl_bootstrap_before_participant_start: true,
      permissive_window_steps: 0,
    },
    null,
    2,
  ),
);
