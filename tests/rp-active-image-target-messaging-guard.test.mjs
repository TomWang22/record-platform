#!/usr/bin/env node
/**
 * Guard: messaging-service must remain an active RP image target.
 * reservation-mesh remains the only legacy peer skipped as inactive.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const build = read("scripts/build-record-platform-images-k3s.sh");
const audit = read("scripts/audit-rp-image-freshness.sh");
const targets = read("scripts/lib/rp-active-image-targets.sh");

assert.match(
  targets,
  /^\s*messaging-service\s*$/m,
  "rp-active-image-targets must list messaging-service",
);
assert.match(targets, /^\s*transport-watchdog\s*$/m);
assert.match(targets, /^\s*webapp\s*$/m);

const expected = [
  "analytics-service",
  "api-gateway",
  "auction-monitor",
  "auth-service",
  "listings-service",
  "media-service",
  "messaging-service",
  "notification-service",
  "python-ai-service",
  "records-service",
  "shopping-service",
  "trust-service",
  "webapp",
  "transport-watchdog",
];
for (const name of expected) {
  assert.match(
    targets,
    new RegExp(`^\\s*${name}\\s*$`, "m"),
    `missing active image target: ${name}`,
  );
}

assert.doesNotMatch(
  build,
  /reservation-mesh \|\| "\$s" == "messaging-service"/,
  "build script must not skip messaging-service with reservation-mesh",
);
assert.match(
  build,
  /if \[\[ "\$s" == "reservation-mesh" \]\]; then/,
  "build script must skip only reservation-mesh as inactive",
);

assert.doesNotMatch(
  audit,
  /for forbidden in reservation-mesh messaging-service/,
  "freshness audit must not forbid messaging-service",
);
assert.match(
  audit,
  /for forbidden in reservation-mesh; do/,
  "freshness audit must forbid only reservation-mesh",
);
assert.doesNotMatch(
  audit,
  /"\$svc" == "reservation-mesh" \|\| "\$svc" == "messaging-service"/,
  "freshness audit must not classify messaging-service as inactive target",
);

console.log(
  JSON.stringify({
    ok: true,
    image_targets_expected: 14,
    messaging_service_active: true,
    inactive_peer: "reservation-mesh",
  }),
);
