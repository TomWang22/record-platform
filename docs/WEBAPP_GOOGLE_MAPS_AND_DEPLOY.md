# Webapp deploy and Google Maps

## Kubernetes

- Manifest: `infra/k8s/base/webapp/deploy.yaml`
- Maps key: Secret `webapp-runtime-secrets` / key `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (optional in manifest; pod works without it but maps UI is disabled).

Apply or refresh the secret:

```bash
# From webapp/.env.local or env
bash scripts/ensure-webapp-runtime-secrets.sh

# Or inline (avoid committing keys)
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY='YOUR_KEY' bash scripts/ensure-webapp-runtime-secrets.sh
```

## Bootstrap verify

`scripts/verify-google-maps.sh` reads, in order:

1. `GOOGLE_MAPS_API_KEY` / `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` env
2. `webapp/.env.local`

## Local dev

Copy `webapp/env.local.template` to `webapp/.env.local` and set your key. `.env.local` is gitignored.
