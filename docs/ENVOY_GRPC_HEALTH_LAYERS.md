# Envoy gRPC health check layers (no NodePort)

We use **Envoy** as the in-cluster gRPC proxy (port 10000, HTTP/2 with TLS to backends). NodePort is no longer used for gRPC. Health checks are layered as follows.

---

## Layer 1: Envoy routing health (in-cluster)

- **What:** Envoy is healthy if it is up and can route gRPC (and gRPC health protocol) to backend services.
- **Where:** Envoy deployment in **envoy-test** namespace; Service **envoy-test** (ClusterIP, port 10000). Routes: `/grpc.health.v1.Health/` and path-based `/auth.*`, `/records.*`, `/social.*`, etc., to corresponding service clusters (auth-service, records-service, …).
- **How to check (in-cluster):**
  - From a pod in the cluster: `grpcurl -insecure -d '{}' envoy-test.envoy-test.svc.cluster.local:10000 grpc.health.v1.Health/Check`
  - Or call a service method through Envoy (e.g. auth.HealthCheck) to confirm routing and backend TLS.
- **Kubernetes:** Envoy pod has no gRPC health probe in the current deploy; consider adding a **readiness/liveness** probe that hits Envoy’s listener (e.g. TCP socket 10000 or a small HTTP/gRPC check if Envoy exposes admin/health). This gives Layer 1 “Envoy is up and accepting” in-cluster.

---

## Layer 2: Strict TLS / mTLS in-cluster

- **What:** Envoy → backend services use **strict TLS**: TLS to backend with `sni: record.local` and CA validation (`/etc/certs/ca/dev-root.pem` from dev-root-ca secret). Backends present certificates signed by the same CA.
- **Where:** Envoy cluster config in **infra/k8s/base/envoy-test/deploy.yaml** — each cluster has `transport_socket` with `UpstreamTlsContext` and `validation_context.trusted_ca`.
- **How to check:** Ensure **ensure-strict-tls-mtls-preflight.sh** (and preflight step 5) passes: service-to-service TLS and mTLS with dev-root-ca and record-local identity. gRPC health (grpc-health-probe) to backends uses TLS; Envoy’s upstream is TLS. No HTTP/1.1 on gRPC ports.

---

## Layer 3: External exposure (Caddy + LoadBalancer + MetalLB)

- **What:** External clients reach the platform via **Caddy** (HTTP/2 and HTTP/3, TLS termination) on the **MetalLB LoadBalancer IP** (no NodePort for gRPC).
- **Flow:** Client → Caddy (LB IP:443) → (internal routing) → API Gateway / Envoy. gRPC from gateway to backends goes via Envoy (in-cluster) with Layer 2 TLS.
- **How to check:** From host: curl (HTTP/2 or HTTP/3) to the Caddy LB IP with `SSL_CERT_FILE=certs/dev-root.pem`; **verify-caddy-strict-tls.sh** (or in-cluster equivalent) ensures no exit 28 and strict TLS. Layer 3 is “external exposure” only; gRPC health is still exercised in-cluster (Layer 1) and with TLS (Layer 2).

---

## Summary

| Layer | Scope            | What is checked                                      |
|-------|------------------|------------------------------------------------------|
| L1    | In-cluster       | Envoy up, routing gRPC and health to backends        |
| L2    | In-cluster       | Strict TLS/mTLS Envoy → backends (dev-root-ca)      |
| L3    | External         | Caddy on MetalLB LB IP, strict TLS (no NodePort)     |

**Related:** **scripts/run-preflight-scale-and-all-suites.sh** (steps 4–5: scale, strict TLS/mTLS preflight); **scripts/verify-caddy-strict-tls.sh**; **infra/k8s/base/envoy-test/deploy.yaml**; **docs/PREFLIGHT_AND_DIAGNOSTICS.md**.
