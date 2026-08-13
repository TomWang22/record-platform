#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COLIMA_SEQUENTIAL_RUN_ID,
  PLACEHOLDER_ISOLATED_RUN_ID,
  assertIsolatedRunId,
  validateIsolatedLaunchManifest,
} from "../lib/pgbench_isolated_shard_launcher.mjs";
import { assertIsolatedSourceRevision } from "../lib/pgbench_isolated_source_revision.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath =
  process.env.GATE3_ISOLATED_MANIFEST ||
  "scripts/performance/gate3-isolated-15-vm-launch-manifest.json";
const resume = process.env.GATE3_RESUME_DIR || "";
const reasons = [];

if (resume === PLACEHOLDER_ISOLATED_RUN_ID || resume.endsWith(PLACEHOLDER_ISOLATED_RUN_ID)) {
  reasons.push("GATE3_RESUME_DIR is NEW_RUN_ID_REQUIRED");
}
if (resume.includes(COLIMA_SEQUENTIAL_RUN_ID)) {
  reasons.push("Colima sequential resume dir forbidden for isolated launcher");
}

const absManifest = isAbsolute(manifestPath) ? manifestPath : join(root, manifestPath);
const manifest = JSON.parse(readFileSync(absManifest, "utf8"));
const validated = validateIsolatedLaunchManifest(manifest);
reasons.push(...validated.reasons);
if (manifest.isolated_run_id) {
  const id = assertIsolatedRunId(manifest.isolated_run_id);
  if (!id.ok) reasons.push(...id.reasons);
}

const expectedGitSha = manifest.git_sha || manifest.pins?.git_sha || null;
const source = assertIsolatedSourceRevision({
  expectedGitSha,
  repoRoot: process.env.GATE3_SOURCE_REPO || root,
});
if (!source.ok) reasons.push(...source.reasons);

const refused = reasons.length > 0;
const out = {
  ...validated,
  launch: refused ? "REFUSED" : validated.launch,
  validation: refused ? "REFUSED" : validated.validation,
  launched: false,
  spawn_pgbench: false,
  provision: false,
  spawn_count: 0,
  vm_api_calls: 0,
  source_revision_ok: source.ok,
  tuning: "NO_GO",
  protocol: "NO_GO",
  track_c_acceptance_pass: false,
  platform_pass: false,
  pgbench_ceiling_complete: false,
  reasons,
};
console.log(JSON.stringify(out, null, 2));
process.exit(refused ? 2 : 0);
