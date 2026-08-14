/**
 * Frozen digest of Gate-3 execution/control-plane source (not workload SQL/JSON).
 */
import { join } from "node:path";
import {
  assertSourceBundleCommitted,
  buildSourceBundle,
  computeBundleSha256,
} from "./pgbench_source_bundle.mjs";

export const CONTROL_PLANE_BUNDLE_SCHEMA = "record-platform-pgbench-control-plane-bundle/v1";

export const CONTROL_PLANE_PATHS = [
  "scripts/lib/pgbench_cell_provenance.mjs",
  "scripts/lib/pgbench_completeness.mjs",
  "scripts/lib/pgbench_completeness_certificate.mjs",
  "scripts/lib/pgbench_contract_runner.mjs",
  "scripts/lib/pgbench_contract_supervisor.mjs",
  "scripts/lib/pgbench_control_plane_bundle.mjs",
  "scripts/lib/pgbench_environment.mjs",
  "scripts/lib/pgbench_in_flight.mjs",
  "scripts/lib/pgbench_latency.mjs",
  "scripts/lib/pgbench_merge.mjs",
  "scripts/lib/pgbench_outbox_tax.mjs",
  "scripts/lib/pgbench_owner_review.mjs",
  "scripts/lib/pgbench_parity_gate.mjs",
  "scripts/lib/pgbench_postgres_sample.mjs",
  "scripts/lib/pgbench_resume.mjs",
  "scripts/lib/pgbench_run_identity.mjs",
  "scripts/lib/pgbench_run_watchdog.mjs",
  "scripts/lib/pgbench_runner.mjs",
  "scripts/lib/pgbench_saturation_knee.mjs",
  "scripts/lib/pgbench_seed_cleanup.mjs",
  "scripts/lib/pgbench_shard.mjs",
  "scripts/lib/pgbench_source_bundle.mjs",
  "scripts/lib/pgbench_wait_event_classifier.mjs",
  "scripts/performance/run-pgbench-matrix.mjs",
  "scripts/performance/supervise-pgbench-contract.mjs",
];

export { computeBundleSha256, assertSourceBundleCommitted };

/**
 * @param {{ repoRoot: string, gitSha?: string }} opts
 */
export function buildControlPlaneBundle(opts) {
  const built = buildSourceBundle({
    repoRoot: opts.repoRoot,
    gitSha: opts.gitSha,
    requiredPaths: CONTROL_PLANE_PATHS,
  });
  return {
    ...built,
    schema: CONTROL_PLANE_BUNDLE_SCHEMA,
    kind: "control_plane",
  };
}

/**
 * Live byte digest only (no git freeze). Used to detect mid-run / resume drift.
 * @param {string} repoRoot
 */
export function hashControlPlaneBytes(repoRoot) {
  return buildSourceBundle({
    repoRoot,
    requiredPaths: CONTROL_PLANE_PATHS,
  });
}

export function controlPlanePathAbs(repoRoot, rel) {
  return join(repoRoot, rel);
}
