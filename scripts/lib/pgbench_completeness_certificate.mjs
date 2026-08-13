/**
 * Gate-3 completeness certificate. Ceiling is evidence-derived only.
 */

export function buildCompletenessCertificate(counts) {
  const expected_total = Number(counts.expected_total);
  const valid_total = Number(counts.valid_total);
  const missing = Number(counts.missing);
  const duplicates = Number(counts.duplicates);
  const invalid_env = Number(counts.invalid_env);
  const interference = Number(counts.interference);
  const legacy_used = Number(counts.legacy_used);
  const prohibited_cross_environment_pairs = Number(counts.prohibited_cross_environment_pairs);
  const anomalies =
    missing !== 0 ||
    duplicates !== 0 ||
    invalid_env !== 0 ||
    interference !== 0 ||
    legacy_used !== 0 ||
    prohibited_cross_environment_pairs !== 0 ||
    Number(counts.source_provenance_mismatches || 0) !== 0 ||
    Number(counts.source_changed_during_cell || 0) !== 0 ||
    valid_total !== expected_total;
  const complete = expected_total === 14616 && valid_total === 14616 && !anomalies;
  return {
    schema: "record-platform-pgbench-completeness-certificate/v1",
    expected_total,
    valid_total,
    missing,
    duplicates,
    invalid_env,
    interference,
    legacy_used,
    prohibited_cross_environment_pairs,
    source_provenance_mismatches: Number(counts.source_provenance_mismatches || 0),
    source_changed_during_cell: Number(counts.source_changed_during_cell || 0),
    status: complete ? "COMPLETE" : "INCOMPLETE",
    pgbench_ceiling_complete: complete,
  };
}

export function buildShaManifest(entries) {
  return {
    schema: "record-platform-sha-manifest/v1",
    files: (entries || []).map((e) => ({ path: e.path, sha256: e.sha256 })),
  };
}

export function buildAllOwnersConcurrentSummary(rows = []) {
  const concurrent = rows.filter((r) => r.mode === "ALL_OWNERS_CONCURRENT" && r.status === "PASS");
  return {
    schema: "record-platform-all-owners-concurrent-summary/v1",
    expected_cells: 1218,
    valid_cells: concurrent.length,
    status: concurrent.length === 1218 ? "COMPLETE" : "INCOMPLETE",
    pgbench_ceiling_complete: false,
  };
}
