#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const result = spawnSync(
  process.execPath,
  [join(ROOT, "scripts/performance/run-pgbench-matrix.mjs")],
  { stdio: "inherit", env: process.env },
);
process.exit(result.status ?? 2);
