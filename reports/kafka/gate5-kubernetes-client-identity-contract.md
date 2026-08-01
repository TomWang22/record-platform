# Gate 5 Kubernetes client-identity contract

Every Kafka participant receives:

- `RP_SERVICE_NAME` — canonical workload name
- `RP_POD_UID` ← `metadata.uid` (authoritative token)
- `RP_POD_NAME` ← `metadata.name`
- `RP_KAFKA_CLIENT_ID_STRICT=1` in acceptance

Injection: `scripts/rp-patch-runtime-provenance-and-identity.sh` (now includes ollama) plus base/cold-bootstrap manifests for python-ai and ollama.

Format: `record-platform.<service>.<pod-uid-prefix>.<role>`

`client.id` is attribution only; authorization remains certificate + ACL/policy.
