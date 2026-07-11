# Phase 32H-E3 — Blocked Targeted Reproduction

```text
Status: BLOCKED (frozen historical evidence)
Valid PASS evidence: NO
Production enablement: NOT APPROVED
```

## Summary

The Phase 32H-E3 targeted reproduction matrix at `/tmp/phase32h-targeted-reproduction` is **not valid PASS evidence** and must not be used for production-readiness or remediation decisions.

The run is preserved only as historical diagnostic evidence for synchronized cross-protocol latency extremes and collector-integrity failures.

## Recorded defects

| Field | Value |
| ----- | ----- |
| Total rows | 17,315 (expected 17,280) |
| Duplicate H1 probe IDs | 35 |
| Wrong infrastructure SHA rows | 20 |
| Extreme events ≥60s | 12 |
| Cross-protocol synchronized clusters | 4 |
| PCAP coverage | PARTIAL (gap during extreme windows) |
| Telemetry gaps | ~350s, ~956s, ~112s, ~577s aligned with clusters |
| Root-cause verdict | F — reproduced but still unresolved |

## Integrity policy

- Matrix JSONL was **not** edited, truncated, deduplicated, or regenerated after freeze.
- Artifacts under the blocked root are hashed in `phase32h-blocked-run-sha256.txt`.
- Freeze marker: `FROZEN_BLOCKED_EVIDENCE`
- Manifest: `phase32h-blocked-run-manifest.json`

## Artifacts

| File | Purpose |
| ---- | ------- |
| `phase32h-blocked-run-manifest.json` | Frozen run metadata |
| `phase32h-blocked-run-sha256.txt` | SHA-256 of all evidence files |
| `phase32h-blocked-run-integrity.json` | Integrity snapshot |
| `phase32h-blocked-run-collector-coverage.json` | Collector coverage at freeze |
| `phase32h-root-cause-verdict.json` | Verdict F — unresolved |
| `phase32h-extreme-clusters.json` | Four all-three-protocol clusters |

## Decision

**BLOCKED permanently.** Do not accept as clean evidence. Do not run H1-only replay. Cross-protocol synchronization is the primary RCA signal and requires H1/H2/H3 together in a fresh R1 validation arm.

## Next step

Phase 32H-R1 host-suspension A/B validation with repaired run and collector integrity.
