# P21.3C — Session endpoint hardening

**Generated:** 2026-06-27  
**Baseline SHA:** `41addbf` (pre P21.3C commit)  
**Phase:** 21 — non-vector product track

---

## Bug

During P21.3 acceptance scripting, ad-hoc session query runs against sparse mock SQL rows crashed with:

```text
KeyError: 'checksum'
services/python-ai-service/app/ai/rag_retrieval.py::_rows_to_chunks
```

Full pytest passed at the time because tests used complete `_chunk_row` fixtures; the gap was **optional column tolerance** in row-to-chunk conversion.

---

## Root cause

`_rows_to_chunks` accessed several SQL row fields with `row["key"]`, assuming every SELECT path returns identical columns. Minimal rows (tests, partial queries, or future SQL variants) may omit optional fields like `checksum`, `title`, or `metadata`.

Required fields (`id`, `document_id`, `content`, `source_type`, `source_id`) remain mandatory; missing optional keys raised `KeyError`.

---

## Fix

Added `_row_get(row, key, default)` helper and updated:

- `_rows_to_chunks` — optional fields use safe defaults:
  - `checksum` → `None`
  - `source_refs` → `[]`
  - `metadata` → `{}`
  - `title`, `owner_user_id`, `visibility`, `source_updated_at` → `None`
- `_chunk_passes_privacy` — uses `_row_get` for `metadata` and `score`

Rows with checksum unchanged; existing full SQL paths behave the same.

---

## Tests

| Test | Result |
| ---- | ------ |
| `TestRowsToChunks::test_row_with_checksum` | PASS |
| `TestRowsToChunks::test_row_without_checksum_does_not_crash` | PASS |
| `TestRowsToChunks::test_row_without_freshness_metadata_optional` | PASS |
| `TestSessionMemoryFourTurn::test_session_query_row_without_checksum` | PASS |
| Full suite `pytest tests/ -q` | **215 passed** |

Test isolation: session tests now pin `resolve_model_used` and `get_provider` in `setUp` to avoid ollama leakage from other tests in full-suite runs.

---

## Contract audit

Session endpoints added to `scripts/audit-rp-ai-endpoints-contract.sh`:

| Check | Result |
| ----- | ------ |
| `endpoint_session_start` | PASS |
| `endpoint_session_query` | PASS |
| `endpoint_session_get` | PASS |
| `endpoint_session_reset` | PASS |

Uses `assert_session_envelope` (allows empty `source_refs` for session lifecycle; requires `session_memory` in start/get/query).

---

## Validation

| Script | Result |
| ------ | ------ |
| `pytest tests/ -q` | 215 passed |
| `audit-rp-ai-rag-contract.sh` | PASS |
| `rp-ai-rag-quality-smoke.sh` | PASS |
| `audit-rp-ai-endpoints-contract.sh` | PASS (incl. 4 session endpoints) |
| `rp-rp-decontaminate-scan.sh` | PASS |

Deploy: `python-ai-service:t20-p213c` rolled out to Colima cluster for live endpoint audit.

---

## Final verdict

```text
P21.3 session endpoint hardening: ACCEPTED
Vector rollout: NOT APPROVED
T20.14/T20.15: BLOCKED
```
