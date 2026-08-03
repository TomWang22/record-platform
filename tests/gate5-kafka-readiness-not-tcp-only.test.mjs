#!/usr/bin/env node
/**
 * Regression: Kafka readiness must not be TCP-only (Gate 5 v9 RCA).
 * Authenticated ApiVersions readiness required; no TLS/auth bypass.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const STS = path.join(REPO, "infra/k8s/kafka-kraft-metallb/statefulset.yaml");

describe("kafka broker readiness semantics", () => {
  it("rejects TCP-only readiness on INTERNAL listener", () => {
    const text = fs.readFileSync(STS, "utf8");
    // readinessProbe block must not be solely tcpSocket:9093
    const readyIdx = text.indexOf("readinessProbe:");
    assert.ok(readyIdx > 0);
    const liveIdx = text.indexOf("livenessProbe:", readyIdx);
    const slice = text.slice(readyIdx, liveIdx > readyIdx ? liveIdx : readyIdx + 4000);
    assert.equal(
      /readinessProbe:\s*\n\s*tcpSocket:\s*\{\s*port:\s*9093\s*\}/.test(slice),
      false,
      "readinessProbe must not be TCP-only on 9093",
    );
    assert.match(slice, /kafka-broker-api-versions/);
    assert.match(slice, /security\.protocol=SSL/);
    assert.match(slice, /ssl\.endpoint\.identification\.algorithm=HTTPS/);
    assert.doesNotMatch(slice, /allow\.everyone\.if\.no\.acl\.found\s*=\s*true/);
    assert.doesNotMatch(slice, /ssl\.client\.auth\s*=\s*none/);
  });
});
