# RP service TLS / mTLS — K8s secret model

Source of truth: `infra/contracts/rp-service-runtime-contract.json` (`certPolicy`).

## Disk PKI (B.crypto)

`scripts/dev-generate-certs.sh` issues:

- Root + intermediate + `dev-chain.pem`
- Edge leaf: `record-platform.test.crt` (serverAuth only)
- Service leaves: one `<service>.crt` + `<service>.key` per `certPolicy.mtlsServices` entry (serverAuth + clientAuth)
- Kafka + Envoy client chains (separate; see `certPolicy.specialChains`)

## K8s secrets (`strict-tls-bootstrap.sh`)

**Option A — per service** (preferred for blast-radius):

| Secret | Keys |
|--------|------|
| `service-tls-<service>` | `tls.crt`, `tls.key`, `ca.crt`, `dev-chain.pem` |

**Option B — combined bundle** (audit / tooling):

| Secret | Keys |
|--------|------|
| `rp-service-mtls-bundle` | `<service>.crt`, `<service>.key`, `ca.crt`, `dev-chain.pem` |

**Edge alias** (legacy gateway mounts):

| Secret | Role |
|--------|------|
| `service-tls` | Edge leaf + CA (api-gateway / grpcurl) |
| `edge-service-tls` | Same material as `service-tls` |

Deployments can migrate to per-service mounts over time; audits require bundle + per-service secrets after `strict-tls-bootstrap`.

## Audits

```bash
bash scripts/audit-rp-cert-coverage.sh      # disk — no cluster
bash scripts/audit-rp-k8s-service-tls-secrets.sh  # cluster — after strict-tls-bootstrap
```

## Explicit non-mTLS

Encoded in `certPolicy.nonMtls`: **webapp** (browser → Caddy edge TLS only; server calls via api-gateway), transport-watchdog, ollama stack.

Audit: `bash scripts/audit-rp-webapp-internal-calls.sh` — fails if webapp source references internal `*.svc.cluster.local` unless `webapp.mtlsRequired=true`.
