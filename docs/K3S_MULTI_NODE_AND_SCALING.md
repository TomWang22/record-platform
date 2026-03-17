# k3s Multi-Node: 2 Nodes Minimum, 3 Optional — Then MetalLB

**Purpose:** Infra validation (cert reissue, MetalLB, full preflight) runs on **2 nodes minimum**. 3 nodes optional for headroom / future HA. Order of operations is **non-negotiable**; see **`docs/PLATFORM_CLUSTER_AND_METALLB_AI_HANDOFF.md`** for the fixed order and one-command path.

---

## 1. 2 nodes minimum, 3 optional

- **2 nodes** required for: cert reissue, MetalLB, full preflight.
- **3 nodes** optional for: headroom, future HA reasoning. No requirement to run 3 for normal validation.

---

## 2. Default path: k3d, same host, 2 nodes

Use k3d (1 server + 1 agent). Zero VM pain, predictable networking, easy add/remove. Colima or multi-VM only when you explicitly want VM realism or host networking tests.

**One-command path:** `./scripts/k3d-create-2-node-cluster.sh` → `kubectl get nodes -w` → when Ready, `./scripts/install-metallb-chunked.sh`. No tuning beforehand. Full order (deploy workloads → MetalLB → preflight) in the handoff doc.

**Storage:** Docker must have enough disk for 2 nodes. Clean when done: `k3d cluster delete record-platform`, `docker system prune` if needed.

---

## 3. Order of operations (non-negotiable)

1. Bring up 2-node cluster  
2. Verify API stability (simple reads over time)  
3. Apply API server tuning (k3d: baked into create; VMs: same script, multi-node context)  
4. Deploy platform workloads  
5. Only then install MetalLB  
6. Then run full preflight / k6 / pgbench  

Violations → failures expected and ignored. Full detail: **`docs/PLATFORM_CLUSTER_AND_METALLB_AI_HANDOFF.md`**.

---

## 4. k3d: create 2-node (then optional 3rd)

**Create (tuning baked in):**

```bash
./scripts/k3d-create-2-node-cluster.sh
kubectl get nodes -w   # wait both Ready
```

**Optional third node:**

```bash
k3d node create record-platform-agent-2 --cluster record-platform --role agent
```

**MetalLB pool:** Use range in k3d network, e.g. `METALLB_POOL=172.18.0.240-172.18.0.250`. Check `docker network inspect k3d-record-platform` for subnet.

---

## 5. VMs (when you need them)

First VM: k3s server with API args (request-timeout=300s, min-request-timeout=600, max-requests-inflight=1200, max-mutating=300). Second VM: agent join. Optional third. Then follow same order: verify → deploy workloads → MetalLB → preflight. Tuning script: `scripts/apply-k3s-etcd-tuning.sh` on server node(s).

---

## 6. MetalLB after cluster is up

Install **only after** steps 1–4. Chunked or direct; on 2 nodes applies cleanly, chunked optional. If it fails on 2 nodes, then it’s a MetalLB problem (not single-node). Pool/L2: `infra/k8s/metallb/`. Traffic policy: **`docs/METALLB_TRAFFIC_POLICY_AND_SCALE.md`**.

---

## 7. References

- **Single handoff (decisions, order, next step, sanity):** **`docs/PLATFORM_CLUSTER_AND_METALLB_AI_HANDOFF.md`**
- Root issues, hardening: `docs/COLIMA_K3S_ISSUES_AND_FIXES.md`
- Wire format / hashcode: `docs/WIRE_FORMAT_AND_SCALING.md`
