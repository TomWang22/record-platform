/**
 * Gate-3 completeness certificate never sets ceiling true early.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCompletenessCertificate } from "../scripts/lib/pgbench_completeness_certificate.mjs";

describe("Gate-3 completeness certificate", () => {
  it("keeps pgbench_ceiling_complete false while cells remain", () => {
    const r = buildCompletenessCertificate({
      expected_total: 14616,
      valid_total: 668,
      missing: 13948,
      duplicates: 0,
      invalid_env: 0,
      interference: 0,
      legacy_used: 0,
      prohibited_cross_environment_pairs: 0,
    });
    assert.equal(r.pgbench_ceiling_complete, false);
    assert.equal(r.status, "INCOMPLETE");
  });

  it("sets ceiling true only on exact 14616/14616 with zero anomalies", () => {
    const r = buildCompletenessCertificate({
      expected_total: 14616,
      valid_total: 14616,
      missing: 0,
      duplicates: 0,
      invalid_env: 0,
      interference: 0,
      legacy_used: 0,
      prohibited_cross_environment_pairs: 0,
    });
    assert.equal(r.pgbench_ceiling_complete, true);
    assert.equal(r.status, "COMPLETE");
  });

  it("keeps ceiling false when source provenance mismatches exist", () => {
    const r = buildCompletenessCertificate({
      expected_total: 14616,
      valid_total: 14616,
      missing: 0,
      duplicates: 0,
      invalid_env: 0,
      interference: 0,
      legacy_used: 0,
      prohibited_cross_environment_pairs: 0,
      source_provenance_mismatches: 1,
      source_changed_during_cell: 0,
    });
    assert.equal(r.pgbench_ceiling_complete, false);
  });
});
