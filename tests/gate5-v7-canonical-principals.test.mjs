#!/usr/bin/env node
/**
 * Fail-closed: active ACL / super.users material must use exact measured
 * Java X500Principal strings from gate5-v7-kafka-node-principals.json.
 * Rejects superseded CN-before-O forms in active manifests.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const PRINCIPALS = path.join(REPO, "reports/kafka/gate5-v7-kafka-node-principals.json");
const MANIFEST = path.join(REPO, "reports/kafka/gate5-v7-final-acl-manifest.json");
const CONTRACT = path.join(REPO, "reports/kafka/gate5-v7-acl-contract.json");

const CN_BEFORE_O = /User:CN=[^,]+,O=/;
const CN_BEFORE_O_DN = /(?:^|,)CN=[^,]+,O=/;

describe("gate5-v7 canonical Kafka principals (O-before-CN)", () => {
  const measured = JSON.parse(fs.readFileSync(PRINCIPALS, "utf8"));
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const contract = JSON.parse(fs.readFileSync(CONTRACT, "utf8"));

  const broker = measured.broker_server_leaf.kafka_acl_principal;
  const admin = measured.recovery_admin.kafka_acl_principal;
  const services = Object.fromEntries(
    measured.service_principals.map((s) => [s.service, s.kafka_acl_principal]),
  );

  it("measures 16 principals (3 node + admin + 12 services)", () => {
    assert.equal(measured.service_principals_measured, 12);
    assert.equal(measured.broker_controller_principals_measured, 3);
    assert.equal(Object.keys(services).length, 12);
    assert.ok(broker.startsWith("User:O="));
    assert.ok(admin.startsWith("User:O="));
    assert.equal(measured.principals_guessed, 0);
    assert.equal(measured.duplicate_service_principals, 0);
    assert.equal(measured.unknown_principals, 0);
  });

  it("manifest super.users match measured broker + recovery-admin only", () => {
    assert.deepEqual(manifest.super_users, [broker, admin]);
    for (const s of manifest.super_users) {
      assert.equal(CN_BEFORE_O.test(s), false, `superseded CN-before-O in super.users: ${s}`);
    }
  });

  it("manifest service principals match measured map exactly", () => {
    const rows = manifest.service_principals || {};
    assert.equal(Object.keys(rows).length, 12);
    for (const [svc, row] of Object.entries(rows)) {
      assert.equal(row.principal, services[svc], `${svc} principal mismatch`);
      assert.equal(CN_BEFORE_O.test(row.principal), false);
      assert.equal(row.super_user, false);
    }
  });

  it("acl-contract dn/principals are O-before-CN and match measured", () => {
    for (const row of contract.target_per_service || []) {
      const expected = services[row.service];
      assert.ok(expected, `missing measured principal for ${row.service}`);
      if (row.kafka_acl_principal) {
        assert.equal(row.kafka_acl_principal, expected);
      }
      const dn = row.principal_dn_fallback || "";
      assert.equal(CN_BEFORE_O_DN.test(dn), false, `CN-before-O dn_fallback: ${dn}`);
      assert.ok(dn.startsWith("O="), `dn_fallback must be O-before-CN: ${dn}`);
    }
  });

  it("rejects active CN-before-O strings in ACL generator inputs", () => {
    const blobs = [
      JSON.stringify(manifest.super_users),
      JSON.stringify(manifest.service_principals),
      JSON.stringify((contract.target_per_service || []).map((r) => ({
        p: r.kafka_acl_principal,
        dn: r.principal_dn_fallback,
      }))),
    ].join("\n");
    assert.equal(CN_BEFORE_O.test(blobs), false);
  });
});
