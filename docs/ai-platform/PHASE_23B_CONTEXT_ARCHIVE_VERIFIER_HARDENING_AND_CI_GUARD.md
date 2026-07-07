# Phase 23B — context/archive verifier hardening and CI guard

**Status:** PASS  
**Live eval:** NOT RUN  
**Runtime/env/default/allowlist changes:** NONE  
**Production default:** keyword  
**Preview UI/API:** KEEP  
**PERCENT=0**  
**ALLOW_PROD_PERCENT=0**  
**Hybrid/vector production default:** NOT APPROVED

---

## Verdict

Phase 23B hardens the active-context model so **current repo tip is computed live**, not stored as a stale static HEAD.

The banned label `Current handoff HEAD:` caused drift after every sync commit. Phase 23B replaces it with three separate concepts:

```text
1. Current repo tip — always computed live with git rev-parse --short HEAD
2. Phase handoff lineage — historical commits, allowed to be older than tip
3. Frozen archive heads — immutable closeout commits
```

---

## What changed

- `ACTIVE_CONTEXT.md` now separates current repo tip, phase handoff lineage, and frozen archive heads.
- Phase 22 archive verifier rejects ambiguous `Current handoff HEAD:`.
- Evidence-label guard (`scripts/verify-ai-platform-evidence-labels-readonly.sh`) prevents calling Phase 22C 7200/7200 full parity.
- Makefile archive verification now runs Phase 21 verifier, Phase 22 verifier, and evidence-label guard.

---

## End state after Phase 23B

- Phase 21 archive verifier PASS.
- Phase 22 full protocol parity verifier PASS.
- Evidence-label guard PASS.
- `ACTIVE_CONTEXT.md` is non-self-referential (no stored current repo tip).
- Phase 23C: NOT STARTED.
- No live eval run.
- No runtime/env/default/allowlist/artifact/user changes.

---

## Next approval phrase

```text
Approved: start Phase 23C dry-run resume/checkpoint validation only — no live eval, no runtime changes.
```
