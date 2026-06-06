# OCH → Record Platform conversion matrix

Canonical string-level targets when **porting** OCH-era lab bundles into this repo.  
Use with `OCH_TO_RP_REWRITE_<stem>.md` reports — **do not** bulk-`sed` without reviewing each path.

| OCH / legacy value | RP / in-repo target | Notes |
|--------------------|---------------------|--------|
| `off-campus-housing-tracker` | `record-platform` | Kubernetes namespace, kustomize, scripts. |
| `off-campus-housing` (as namespace) | `record-platform` | When used as **namespace**, not generic English text. |
| `off-campus-housing.test` | `record.test` | SNI / dev TLS / curl `-H Host:`. |
| `off-campus-housing.local` | `record.test` (or env-specific host) | Align with dev ingress docs. |
| `och-kafka-ssl-secret` | `kafka-ssl-secret` | TLS secret name in KRaft / preflight jobs. |
| `och-preflight` / `och_preflight` | `preflight` / neutral `PREFLIGHT_*` env | Drop `och-` prefix unless comparing to historical bundles. |
| `och-gateway` | `api-gateway` | Service / deployment names. |
| `api-gateway:4020` / `:4020` (gateway) | `api-gateway:4000` | RP default HTTP port for gateway in this monorepo. |
| `HOUSING_NS` defaulting to OCH | `HOUSING_NS=record-platform` | When scripts support the override (see selective merge doc). |
| `.off-campus-housing.` in URLs | `.record.` / `record.test` | Case-by-case in URLs vs prose. |

## Not automatic

- **Golden / combined** tarballs may contain **thousands** of historical paths; treat as **reference**, not import roots.
- Some bundles are already **RP-native** in text; classification still depends on what was **packed**, not what you intend to merge.
- Prefer **`git apply`** / small patches over wholesale copy after mapping hits to paths.

See: `docs/bundles/OCH_RP_ARTIFACT_CONTRACT.md`, `docs/bundles/BUNDLE_INGESTION_POLICY.md`, `docs/bundles/TARBALL_SELECTIVE_MERGE.md`.
