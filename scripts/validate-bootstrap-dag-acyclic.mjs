#!/usr/bin/env node
/**
 * Fail if infra/bootstrap_invariants.graph.json has a cycle.
 * Regression: the historical A.namespace_integrity_static dual-use edge cycle.
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
  // Explicit regression marker for the known historical cycle
  const hasLegacyDual =
    edges.some(([a, b]) => a === "D.contract_audits" && b === "A.namespace_integrity_static") &&
    edges.some(([a, b]) => a === "A.namespace_integrity_static" && b === "P0.hard_reset");
  if (hasLegacyDual) {
    console.error("REGRESSION: A.namespace_integrity_static dual-use cycle present");
  }
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
if (nodes.includes("G.kafka_authorizer.configure") || nodes.includes("G.kafka_acls.bootstrap")) {
  console.error("FAIL: G nodes must use preflight/offline_validate names");
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      acyclic: true,
      nodes: nodes.length,
      edges: edges.length,
      topological_order_length: out.length,
    },
    null,
    2
  )
);
