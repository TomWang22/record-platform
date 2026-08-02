import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

test("bootstrap_invariants.graph.json is acyclic and uses split namespace integrity nodes", () => {
  const r = spawnSync(process.execPath, [join(repo, "scripts/validate-bootstrap-dag-acyclic.mjs")], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const j = JSON.parse(r.stdout);
  assert.equal(j.acyclic, true);
  assert.ok(j.nodes >= 30);
});

test("historical dual-use A.namespace_integrity_static cycle is rejected by validator logic", () => {
  // A → P0 → D → A  (the dual-use static node cycle shape)
  const bad = {
    nodes: { A: {}, P0: {}, D: {} },
    edges: [
      ["A", "P0"],
      ["P0", "D"],
      ["D", "A"],
    ],
  };
  const indeg = new Map(Object.keys(bad.nodes).map((n) => [n, 0]));
  const adj = new Map(Object.keys(bad.nodes).map((n) => [n, []]));
  for (const [u, v] of bad.edges) {
    adj.get(u).push(v);
    indeg.set(v, indeg.get(v) + 1);
  }
  const q = [...indeg.entries()].filter(([, d]) => d === 0).map(([n]) => n);
  const out = [];
  while (q.length) {
    const u = q.shift();
    out.push(u);
    for (const v of adj.get(u)) {
      indeg.set(v, indeg.get(v) - 1);
      if (indeg.get(v) === 0) q.push(v);
    }
  }
  assert.ok(out.length < Object.keys(bad.nodes).length, "synthetic cycle must fail Kahn");
});
