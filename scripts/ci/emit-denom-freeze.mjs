#!/usr/bin/env node
/**
 * Emit denom-freeze CI artifact (master denominators).
 * Never authorizes performance execution.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execSync } from "node:child_process";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");

export const POSTGRES_DATABASES = [
  "postgres-records",
  "postgres-messaging",
  "postgres-listings",
  "postgres-shopping",
  "postgres-auth",
  "postgres-auction-monitor-core",
  "postgres-analytics",
  "postgres-python-ai",
  "postgres-notification",
  "postgres-trust",
  "postgres-media",
];

export const PROTOCOLS_EXPECTED = ["HTTP/1.1", "HTTP/2", "HTTP/3"];

export const FORBIDDEN_FLAGS = {
  execution_authorized: false,
  gate5_ab_started: false,
  gate5_v10_created: false,
  gate6_authorized: false,
  production_approved: false,
};

export function exactSha(repo = REPO) {
  return execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf8" }).trim();
}

export function writeJsonWithSha(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  const raw = `${JSON.stringify(payload, null, 2)}\n`;
  writeFileSync(path, raw);
  writeFileSync(
    `${path}.sha256`,
    `${createHash("sha256").update(raw).digest("hex")}\n`,
  );
  return path;
}

export function buildDenomFreeze({ sha } = {}) {
  const exact_sha = sha || exactSha();
  if (POSTGRES_DATABASES.length !== 11) {
    throw new Error(`denom_length:${POSTGRES_DATABASES.length}!=11`);
  }
  return {
    schema: "record-platform-denom-freeze/v1",
    verdict: "DENOM_FREEZE_PASS",
    exact_sha,
    postgres_databases_expected: 11,
    postgres_databases: [...POSTGRES_DATABASES],
    protocols_expected: [...PROTOCOLS_EXPECTED],
    grpc_in_edge_denominator: false,
    ...FORBIDDEN_FLAGS,
  };
}

function main() {
  const out = join(REPO, "reports/ci/denom-freeze.json");
  writeJsonWithSha(out, buildDenomFreeze());
  console.log(JSON.stringify({ wrote: out, exact_sha: exactSha() }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
