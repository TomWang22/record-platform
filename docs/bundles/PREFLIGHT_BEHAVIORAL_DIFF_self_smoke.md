# Preflight behavioral diff — `self_smoke`

- **OCH (staging):** `/Users/tom/record-platform/scripts/run-preflight-scale-and-all-suites.sh`
- **RP (repo):** `/Users/tom/record-platform/scripts/run-preflight-scale-and-all-suites.sh`
- **Fingerprint (normalized body, OCH):** `73a63ef10a478d0b`
- **Fingerprint (normalized body, RP):** `73a63ef10a478d0b`

## Missing Phase Blocks
- _(none by signal heuristics)_

## Missing Barrier Conditions
- _(none beyond phase blocks)_

## Missing Strict Gates
- _(none)_

## Changed Exit Semantics
- **`exit 1` occurrences:** OCH=38 vs RP=38
- **`set +e` occurrences:** OCH=3 vs RP=3 (lower is stricter unless intentionally scoped)
- **`set -euo pipefail` in driver head:** OCH=yes vs RP=yes

## Added Logic in RP (signals present in RP, not in OCH)
- _(none)_

## Removed Logic in RP (signals present in OCH, not in RP)
- _(none)_

_Heuristic diff only — review both scripts for true behavioral parity._

