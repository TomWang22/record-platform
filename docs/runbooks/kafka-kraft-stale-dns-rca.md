# Runbook: KRaft Kafka — stale DNS / EndpointSlice vs pod IP

## Symptoms

- Controller / inter-broker logs mention **TLS** or **connection could not be established** on internal ports (e.g. **:9095**), **after** a broker restart or reschedule.  
- **Quorum** flaps or **UnderReplicatedPartitions** without obvious disk/network failure.  
- **`nslookup kafka-0.kafka.<ns>.svc.cluster.local`** (from a debug pod) returns an **old** IP vs **`kubectl get pod kafka-0 -o wide`**.

## Root cause

The headless Service **`kafka`** is backed by **EndpointSlices** (`kubernetes.io/service-name=kafka`). If a slice row for **`kafka-N`** still points at a **previous** pod IP, **kube-dns** / **CoreDNS** can serve **stale A records**. Brokers then try to reach peers at wrong addresses → failed TLS handshakes or connection timeouts.

## Fast check

From repo root:

```bash
HOUSING_NS=record-platform ./scripts/validate-kafka-dns.sh
# or: KAFKA_NAMESPACE=record-platform ./scripts/validate-kafka-dns.sh
```

The script compares, for **`kafka-0` … `kafka-2`**:

- **`kubectl get pod … -o jsonpath='{.status.podIP}'`**  
- EndpointSlice endpoint row with matching **hostname**.

Optional auto-remediation (one delete + rollout + re-check):

```bash
PREFLIGHT_KAFKA_DNS_AUTO_REMEDIATE=1 HOUSING_NS=record-platform ./scripts/validate-kafka-dns.sh
```

Preflight step **6a2a** runs the same check with **`PREFLIGHT_KAFKA_DNS_AUTO_REMEDIATE` defaulting to 1** for KRaft.

## Fix (destructive to slices — safe in dev)

```bash
NS=record-platform   # or your namespace
kubectl delete endpointslice -n "$NS" -l kubernetes.io/service-name=kafka
kubectl rollout restart statefulset/kafka -n "$NS"
```

Wait for **StatefulSet** rollout and re-run **`validate-kafka-dns.sh`**. Then run your usual Kafka ritual (**`verify-kafka-cluster.sh`**, **`kafka-runtime-sync.sh --check-only`**, etc.).

## Prevention / monitoring

- After **forced deletes** of broker pods or **node drains**, re-run **`validate-kafka-dns.sh`** before declaring green.  
- Include **`monitoring/prometheus-rules/kafka-kraft-dns.yaml`** in your Prometheus stack (alert on broker errors + quorum risk).  
- Avoid manual edits to EndpointSlices; prefer letting the **endpoint controller** reconcile after **Pod** readiness.

## Related

- **`infra/k8s/kafka-kraft-metallb/kustomization.yaml`** (comment reference to this runbook).  
- **Preflight** Kafka gates — **`scripts/run-preflight-scale-and-all-suites.sh`** (6a2a DNS, 6a2c1 EKU, 6a2c9 **`scripts/tests/kafka-alignment-suite.sh`**).
