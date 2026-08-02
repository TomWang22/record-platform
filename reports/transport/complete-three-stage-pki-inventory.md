# Complete three-stage PKI inventory

- ts: `2026-08-02T01:59:51Z`
- root_sha256: `E0:D3:94:15:5C:28:84:CA:C5:16:BD:18:1A:0B:79:43:8E:62:3E:33:85:8C:42:C4:A3:C0:DC:C6:28:09:F6:EB`
- intermediate_sha256: `99:18:60:03:76:CA:CF:BC:61:72:A6:6F:F2:1A:40:14:8C:4C:AF:C4:FC:72:00:AA:EF:E7:FA:6E:D5:BD:C6:6F`
- active identities: **37**
- kafka client leaves: **12** (distinct fps **12**)
- invalid chains: **0**
- key/leaf mismatches: **0**
- prior claim reclassification: `PARTIAL_NOT_ACCEPTED_WITHOUT_PER_ROW_ROOT_INTERMEDIATE_LEAF`

Wire semantics: peer presents **leaf + intermediate**; **root** is the verifier trust anchor only.

