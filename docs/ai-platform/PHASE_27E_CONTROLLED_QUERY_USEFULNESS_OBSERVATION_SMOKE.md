# Phase 27E — controlled query/usefulness observation smoke

**Phase 27E:** PASS  
**Live eval:** NOT RUN  
**57105 replay:** NOT RUN  
**Live RAG call:** NOT RUN (offline write-path smoke only)  
**DB writes:** YES (synthetic local/dev observation rows via implemented write paths)  
**Production default:** keyword  
**Preview UI/API:** KEEP  
**PERCENT=0**  
**ALLOW_PROD_PERCENT=0**  
**Hybrid/vector production default:** NOT APPROVED  
**Artifact SHA unchanged:** 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa  
**Bench logs committed:** NO  
**Raw/private fields stored:** NO  

---

## Method

Offline/unit-level emit through:

```text
write_kpi_query_observation(...)
build_usefulness_observation_payload(...) + write_kpi_usefulness_observation(...)
```

No curl/kubectl, no `/api/ai/rag/query` live call, no 57105 matrix.

## Rows populated (real local/dev DB)

```text
1 query observation HTTP/1.1
1 query observation HTTP/2
1 query observation HTTP/3
1 usefulness observation — H1 baseline 57105/57105
1 usefulness observation — H2 replay 57105/57105
1 usefulness observation — H3 replay 57105/57105
1 usefulness observation — Phase 22C 7200/7200 sample only
```

## Label / redaction checks

```text
H1/H2/H3 labels preserved exactly as evidence_label values
171315 remains labeled sum only (docs/report notes; not rewritten as unlabeled cumulative)
Phase 22C remains sample only
No raw question/answer/response body stored on observation rows
```

## Counts after drill

```text
query: >= 3
usefulness: >= 4
```

## Next

Continue Phase 27F combined KPI report from these controlled rows.
