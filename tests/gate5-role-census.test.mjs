#!/usr/bin/env node
/**
 * Gate 5 role-census regressions: bare suffix may repeat; contract/live IDs must not.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const CENSUS = path.join(REPO, "scripts/lib/gate5_role_census.py");
const IDENTITY = path.join(REPO, "reports/kafka/gate5-v7-service-identity-contract.json");

function evaluate(payload) {
  const r = spawnSync("python3", [CENSUS, "evaluate-json"], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    cwd: REPO,
  });
  assert.equal(r.error, undefined, String(r.error));
  const out = JSON.parse(r.stdout);
  return { code: r.status, out, stderr: r.stderr };
}

describe("gate5 role census identity model", () => {
  it("allows three services sharing producer bare suffix", () => {
    const { out } = evaluate({
      roles_expected: 3,
      contract_roles: [
        {
          service: "analytics-service",
          role: "producer",
          required_client_id_form:
            "record-platform.analytics-service.<pod-uid-prefix>.producer",
        },
        {
          service: "auth-service",
          role: "producer",
          required_client_id_form:
            "record-platform.auth-service.<pod-uid-prefix>.producer",
        },
        {
          service: "listings-service",
          role: "producer",
          required_client_id_form:
            "record-platform.listings-service.<pod-uid-prefix>.producer",
        },
      ],
    });
    assert.equal(out.bare_role_suffix_counts.producer, 3);
    assert.equal(out.unique_contract_role_keys, 3);
    assert.equal(out.unique_bare_role_suffixes, 1);
    assert.notEqual(out.unique_bare_role_suffixes, out.roles_expected);
    assert.equal(out.result, "PASS");
    assert.equal(out.ok, true);
  });

  it("allows shared consumer suffix with distinct groups/services", () => {
    const { out } = evaluate({
      roles_expected: 2,
      contract_roles: [
        {
          service: "media-service",
          role: "consumer",
          group: "media-group",
          required_client_id_form:
            "record-platform.media-service.<pod-uid-prefix>.consumer",
        },
        {
          service: "trust-service",
          role: "consumer",
          group: "trust-group",
          required_client_id_form:
            "record-platform.trust-service.<pod-uid-prefix>.consumer",
        },
      ],
      live_clients: [
        {
          client_id: "record-platform.media-service.aaaa1111.consumer",
          group_id: "media-group",
        },
        {
          client_id: "record-platform.trust-service.bbbb2222.consumer",
          group_id: "trust-group",
        },
      ],
    });
    assert.equal(out.bare_role_suffix_counts.consumer, 2);
    assert.equal(out.unique_contract_role_keys, 2);
    assert.equal(out.duplicate_live_client_ids.length, 0);
    assert.equal(out.result, "PASS");
  });

  it("fails duplicate service-role contract key", () => {
    const { out } = evaluate({
      roles_expected: 2,
      contract_roles: [
        {
          service: "analytics-service",
          role: "producer",
          required_client_id_form:
            "record-platform.analytics-service.<pod-uid-prefix>.producer",
        },
        {
          service: "analytics-service",
          role: "producer",
          required_client_id_form:
            "record-platform.analytics-service.<pod-uid-prefix>.producer-alt",
        },
      ],
    });
    assert.equal(out.result, "FAIL_DUPLICATE_CONTRACT_ROLE");
    assert.equal(out.ok, false);
  });

  it("fails duplicate required_client_id_form", () => {
    const form =
      "record-platform.analytics-service.<pod-uid-prefix>.producer";
    const { out } = evaluate({
      roles_expected: 2,
      contract_roles: [
        { service: "analytics-service", role: "producer", required_client_id_form: form },
        {
          service: "auth-service",
          role: "producer",
          // force same form while different contract key via explicit key override conflict on form only
          contract_role_key: "auth-service:producer",
          required_client_id_form: form,
        },
      ],
    });
    assert.equal(out.result, "FAIL_DUPLICATE_REQUIRED_CLIENT_ID_FORM");
  });

  it("fails duplicate concurrently live full client ID", () => {
    const { out } = evaluate({
      roles_expected: 1,
      contract_roles: [
        {
          service: "analytics-service",
          role: "producer",
          required_client_id_form:
            "record-platform.analytics-service.<pod-uid-prefix>.producer",
        },
      ],
      live_clients: [
        { client_id: "record-platform.analytics-service.aaaa1111.producer" },
        { client_id: "record-platform.analytics-service.aaaa1111.producer" },
      ],
    });
    assert.equal(out.result, "FAIL_DUPLICATE_LIVE_CLIENT_ID");
  });

  it("allows same service/role across two pods with distinct tokens", () => {
    const { out } = evaluate({
      roles_expected: 1,
      contract_roles: [
        {
          service: "analytics-service",
          role: "producer",
          required_client_id_form:
            "record-platform.analytics-service.<pod-uid-prefix>.producer",
        },
      ],
      live_clients: [
        { client_id: "record-platform.analytics-service.pod11111.producer" },
        { client_id: "record-platform.analytics-service.pod22222.producer" },
      ],
    });
    assert.equal(out.roles_discovered, 1);
    assert.equal(Object.keys(out.observed_live_client_id_counts).length, 2);
    assert.equal(out.duplicate_live_client_ids.length, 0);
    assert.equal(out.result, "PASS");
  });

  it("fails generic library client ID", () => {
    const { out } = evaluate({
      roles_expected: 1,
      contract_roles: [
        {
          service: "python-ai-service",
          role: "producer",
          required_client_id_form:
            "record-platform.python-ai-service.<pod-uid-prefix>.producer",
        },
      ],
      live_clients: [{ client_id: "aiokafka-0.11.0" }],
    });
    assert.equal(out.result, "FAIL_GENERIC_CLIENT_ID");
  });

  it("fails missing role suffix", () => {
    const { out } = evaluate({
      roles_expected: 1,
      contract_roles: [{ service: "analytics-service", required_client_id_form: "nope" }],
    });
    assert.equal(out.result, "FAIL_MISSING_ROLE_SUFFIX");
  });

  it("passes nineteen-role production fixture without bare-suffix denominator trap", () => {
    const r = spawnSync("python3", [CENSUS, "production", IDENTITY], {
      encoding: "utf8",
      cwd: REPO,
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const out = JSON.parse(r.stdout);
    assert.equal(out.roles_expected, 19);
    assert.equal(out.roles_discovered, 19);
    assert.equal(out.unique_contract_role_keys, 19);
    assert.equal(out.unique_required_client_id_forms, 19);
    assert.equal(out.duplicate_live_client_ids.length, 0);
    assert.ok(out.duplicate_bare_role_suffixes > 0, "producer/etc must repeat");
    assert.notEqual(out.unique_bare_role_suffixes, out.roles_expected);
    assert.equal(out.result, "PASS");
    assert.equal(out.ok, true);

    // Prove the original bug condition would have failed wrongly
    const producerCount = out.bare_role_suffix_counts.producer || 0;
    assert.ok(producerCount > 1);
    assert.notEqual(producerCount, 1);
  });

  it("documents that bare suffix cardinality is not the logical-role denominator", () => {
    const { out } = evaluate({
      roles_expected: 3,
      contract_roles: [
        {
          service: "a-service",
          role: "producer",
          required_client_id_form: "record-platform.a-service.<pod-uid-prefix>.producer",
        },
        {
          service: "b-service",
          role: "producer",
          required_client_id_form: "record-platform.b-service.<pod-uid-prefix>.producer",
        },
        {
          service: "c-service",
          role: "producer",
          required_client_id_form: "record-platform.c-service.<pod-uid-prefix>.producer",
        },
      ],
    });
    assert.match(out.assert_note, /NOT compared to roles_expected/);
    assert.equal(out.unique_bare_role_suffixes, 1);
    assert.equal(out.roles_expected, 3);
    assert.notEqual(out.unique_bare_role_suffixes, out.roles_expected);
  });
});
