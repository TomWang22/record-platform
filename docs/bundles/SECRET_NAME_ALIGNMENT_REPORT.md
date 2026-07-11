# Secret name alignment audit

**Repo:** `/Users/tom/record-platform`

## Canonical filenames (informational)

- `infra/k8s/**/kafka-ssl-secret.yaml`: **0** (`—`)
- `infra/k8s/**/edge-service-tls.yaml`: **0** (`—`)

## Matrix: OCH secret traces

| File | OCH Secret | RP Equivalent Exists? | Needs Rewrite? |
|------|------------|-------------------------|----------------|
| `_canonical:och-kafka-ssl-secret` | `och-kafka-ssl-secret` | Yes | No |
| `_canonical:och-service-tls` | `och-service-tls` | Yes | No |

## Deployment / volume secret refs vs static `kind: Secret`

- **Declared Secret names:** 8
- **Referenced secret names:** 29

### Referenced but not defined (and not on dynamic allowlist)
- _(none)_

### Declared Secret names never referenced (informational)
- `alertmanager-rp-slo-example`
- `app-secrets`
- `pg-repl`
- `postgres-superuser`

## Hard failures (deduped)
- _(none)_
