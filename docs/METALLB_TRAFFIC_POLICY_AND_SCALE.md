# MetalLB Traffic Policy and Scaling

**Purpose:** Define how we use MetalLB (L2 pool, priority evaluation) and how traffic policy ties into byte-level encoding and hash-based optimization when we scale to multiple servers.

---

## 1. Custom traffic policy and priority evaluation

### 1.1 What we use today

- **IPAddressPool:** One pool (e.g. `192.168.106.240-192.168.106.250`) for LoadBalancer services. See `infra/k8s/metallb/ipaddresspool.yaml`.
- **L2Advertisement:** Single L2 advertisement for that pool. See `infra/k8s/metallb/l2advertisement.yaml`.

### 1.2 Priority evaluation

- **Node-level priority (multi-node):** When the cluster has 2–3 nodes, we can prefer which nodes announce L2. Use `L2Advertisement.spec.nodeSelector` to select nodes (e.g. `metallb-priority: high`). The speaker runs as a DaemonSet; only nodes matching the selector will announce. So “priority” = which nodes are allowed to serve LoadBalancer IPs.
- **Service-level:** MetalLB does not support per-service “priority” in L2 mode. If we need traffic to prefer certain backends (e.g. by path or header), that is done at the ingress/gateway (e.g. Caddy, API gateway) with routing rules, not in MetalLB. We document “priority” here as: (1) node selector for L2 when multi-node, (2) future: any custom controller that sets annotations/labels for preferred nodes.

### 1.3 Adding priority when you scale

- Add node labels (e.g. `metallb-priority=high`) on nodes that should announce.
- Uncomment and set `spec.nodeSelector` in `l2advertisement.yaml` to match those labels.
- Apply: `kubectl apply -f infra/k8s/metallb/` (after MetalLB is installed).

---

## 2. Multi-server / scale: byte-level encoding and hashcode tricks

When we scale to multiple servers (more replicas, more nodes), we need:

### 2.1 Byte-level encoding

- **Same wire format everywhere:** Use one encoding (e.g. protobuf, or documented binary layout) so all replicas and clients agree. See **`docs/WIRE_FORMAT_AND_SCALING.md`**.
- **Extensive comments:** At encode/decode sites, document byte layout (version, length, payload) so debugging and multi-version interop are clear.

### 2.2 Hashcode tricks for performance

- **Consistent hashing:** For sharding (e.g. cache keys, partition keys), use consistent hashing so adding/removing nodes minimizes reassignment. Document the hash function and ring in code (e.g. “SHA-256 of key mod N” or a proper consistent-hash ring).
- **Hash-based routing / affinity:** Route the same user or session to the same backend when beneficial (e.g. cache affinity). Use a fast hash (e.g. FNV or xxHash) of a stable key (user id, session id) to pick a backend index. Document in code: “Routing: hash(userId) % replica_count.”
- **Optimization:** Prefer a single, documented hash for routing/sharding so we don’t mix multiple schemes. See **`docs/WIRE_FORMAT_AND_SCALING.md`** § Hashcode tricks.

Traffic policy at scale = **L2/node priority (MetalLB)** + **byte-level encoding (wire format)** + **hashcode-based sharding/routing** documented and commented in code.
