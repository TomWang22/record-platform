# T20.39E — Broader real-participant N=5 telemetry audit

**Status:** Telemetry audit **PASS**  
**Generated:** 2026-07-03  
**Baseline SHA:** `25e5865`  
**Artifact SHA256:** `1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa`

---

## 1. Verdict

```text
T20.39E: PASS
OCH: PASS
Telemetry WARNs: 0
Playwright C-suite: 7/7 PASS
Production default: keyword
PERCENT: 0
```

---

## 2. Live telemetry

| Metric | Result |
|--------|--------|
| T20.39C HTTP 200 | **4320/4320** |
| T20.39C fallback | **0.0%** |
| `final_tagged_plan` fallback | **0** |
| Gate: `preview_opt_in` | **3600** |
| Gate: `allowlist` | **720** |
| `keyword_default` during matrix | **0** |
| Canary errors | **0** |
| Leakage | **PASS** |
| Hybrid p95 | **131.99 ms** |
| Avg quality | **4.0** |
| Worst quality | **4.0** |

---

## 3. OCH / UI / quality

| Gate | Result |
|------|--------|
| OCH decontamination scan | **PASS** (`__SCANNED__=589`) |
| Preview UI smoke | **4/4 PASS** |
| Full C-suite | **7/7 PASS** |
| Telemetry WARNs | **0** |
| Record intelligence score | **3.86** |
| Longform score | **3.67** |
| Final turn score | **4** |

Telemetry report:

```text
WARNs (0): none
Scores — record: 3.86, longform: 3.67, final turn: 4
```

---

## 4. Privacy and rollout state

| Check | Result |
|-------|--------|
| Message-body leakage | **PASS** |
| Proxy/max bid fields exposed | **NO** |
| Anonymous/guest hybrid access | **NO** |
| Permanent allowlist broadened | **NO** |
| `AI_RAG_HYBRID_CANARY_PERCENT` | `0` |
| `AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT` | `0` |
| Production default | `keyword` |
| Vector production default | **NOT APPROVED** |
| Hybrid production default | **NOT APPROVED** |

---

## 5. Final env

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
Production default: keyword
```

