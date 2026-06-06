# Preflight behavioral diff — `preflight-quic-165415`

- **OCH (staging):** `/Users/tom/bundle-staging/preflight-cluster-quic-scripts-20260418-165415/scripts/run-preflight-scale-and-all-suites.sh`
- **RP (repo):** `/Users/tom/record-platform/scripts/run-preflight-scale-and-all-suites.sh`
- **Normalized fingerprint (OCH):** `24ce3672c88d756c`
- **Normalized fingerprint (RP):** `73a63ef10a478d0b`

## Missing phase blocks / gates (present in OCH, not labeled in RP heuristic)
- _(none detected)_

## Added logic / labels in RP (not in OCH heuristic)
- _(none detected)_

## Missing barrier conditions

Heuristic: OCH mentions `phase-barrier` / `cluster-stability` / `PHASE_BARRIER` without RP counterpart.
- OK: phase / cluster stability
- OK: Jaeger / Step7
- OK: Kafka alignment
- OK: Transport / QUIC
- OK: `set +e` (loosen errexit)

## Missing strict gates / changed exit semantics

- OCH `set -e` present: yes
- RP `set -e` present: yes
- OCH explicit `exit 1` count: 38
- RP explicit `exit 1` count: 38

_This report is heuristic by design; use with code review._
