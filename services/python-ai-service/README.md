# Python AI Service

Build **from repo root** (Dockerfile expects monorepo context for `proto/` and `services/`):

```bash
# From repo root:
docker build -f services/python-ai-service/Dockerfile -t python-ai-service:dev .
```

Or use the shared script:

```bash
./scripts/build-and-rollout-colima.sh   # builds all services including this one
```

Do **not** run `docker build -t python-ai-service:dev services/python-ai-service` — the context would be the service directory only and `COPY services/...` / `COPY proto` would fail.
