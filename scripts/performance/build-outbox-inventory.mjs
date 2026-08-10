#!/usr/bin/env node
/**
 * Track C — outbox owner inventory builder (PREPARED / static).
 * Does not treat auction-monitor canary-v3 as platform-wide outbox PASS.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertOutboxInventory,
  buildPreparedOutboxInventory,
  buildTrackCResult,
  discoverOutboxDdlFiles,
  sha256Json,
} from "../lib/performance_track_c.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");

export {
  assertOutboxInventory,
  buildPreparedOutboxInventory,
  buildTrackCResult,
  discoverOutboxDdlFiles,
};

export function buildPreparedOutboxInventoryForRepo(repoRoot = REPO) {
  return buildPreparedOutboxInventory(repoRoot);
}

function main() {
  const inventory = buildPreparedOutboxInventory(REPO);
  assertOutboxInventory(inventory);
  const out = join(REPO, "reports/performance/outbox-owner-inventory.PREPARED.json");
  mkdirSync(dirname(out), { recursive: true });
  const raw = `${JSON.stringify(inventory, null, 2)}\n`;
  writeFileSync(out, raw);
  writeFileSync(`${out}.sha256`, `${createHash("sha256").update(raw).digest("hex")}\n`);

  const ciOut = join(REPO, "reports/ci/track-c-outbox-inventory-result.json");
  mkdirSync(dirname(ciOut), { recursive: true });
  const result = buildTrackCResult(inventory);
  const resultRaw = `${JSON.stringify(result, null, 2)}\n`;
  writeFileSync(ciOut, resultRaw);
  writeFileSync(`${ciOut}.sha256`, `${createHash("sha256").update(resultRaw).digest("hex")}\n`);

  console.log(
    JSON.stringify(
      {
        wrote: out,
        ci_result: ciOut,
        outboxes_expected: inventory.outboxes_expected,
        outboxes_discovered: inventory.outboxes_discovered,
        inventory_sha256: sha256Json(inventory),
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
