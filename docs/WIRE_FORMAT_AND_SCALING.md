# Wire Format and Scaling (Future Multi-Server / Multi-Node)

**Purpose:** When you scale to multiple nodes or multiple servers, byte-level encoding and protocol contracts must be clear so all components interoperate. This doc is the place for that and points to where to add extensive comments in code.

---

## 1. Why byte-level encoding matters at scale

- **Multiple services** (API gateway, auth, listings, shopping, etc.) may be written in different languages or versions; they must agree on how bytes on the wire are interpreted.
- **Replication or sharding** (e.g. multiple API gateway instances, multiple DB replicas) requires unambiguous serialization so no node misreads a message.
- **Debugging and audits** are easier when the wire format is documented and commented in code (e.g. "bytes 0–3: length; bytes 4–7: version; bytes 8..: payload").

---

## 2. What we use today

- **gRPC / Protocol Buffers:** Many services use `.proto` files (see `proto/` and `infra/k8s/base/*/`). The schema is the contract; generated code handles encoding/decoding.
- **JSON over HTTP:** REST endpoints use JSON. For consistency, document the schema (OpenAPI/JSON Schema) and stick to it so future services don’t diverge.

For **any new binary or custom encoding** (e.g. a compact protocol between two components):

1. **Prefer existing standards:** Protobuf, MessagePack, or JSON with a single schema. Document the choice in `ENGINEERING.md` or here.
2. **Document the layout:** In a spec or this doc, describe: field order, lengths, endianness, delimiters, version byte.
3. **Add extensive comments in code:** At every encode/decode site, add comments such as:
   - `// Byte 0: protocol version (1 = v1)`
   - `// Bytes 1–4: payload length, big-endian unsigned 32-bit`
   - `// Bytes 5..: payload (protobuf message X)`
4. **Versioning:** Reserve a version field so you can evolve the format without breaking existing nodes.

---

## 3. Scaling checklist (when you add multi-node or multi-server)

| Area | Action |
|------|--------|
| **Control plane** | Multi-master k3s (or another distro) if you need HA; see `docs/COLIMA_K3S_STABILITY_AND_METALLB.md` §3. |
| **Data plane** | Add worker nodes; MetalLB L2 (or BGP) works across nodes; same encoding on all replicas. |
| **Encoding** | One documented wire format per protocol; extensive comments at encode/decode sites; version field for compatibility. |
| **Observability** | Metrics and tracing (e.g. Prometheus, Otel) so you can see which node/pod is slow or failing when scaled. |

---

## 4. Where to put comments in code

- **Protocol buffer definitions:** In `.proto` files, comment each field and any non-obvious encoding choice.
- **Binary/custom encoders:** In the same file as the encode/decode logic, add a short block comment describing the byte layout (e.g. "Wire format: 1 byte version, 4 bytes length BE, N bytes payload").
- **API contracts:** In OpenAPI or shared types, document optional vs required and any versioning.

This keeps "byte level encoding with extensive comments" in one place conceptually (this doc) and in practice (next to the code that does the encoding).

---

## 5. Hashcode tricks for performance at scale

When you have multiple servers or replicas, **hash-based routing and sharding** optimize performance and reduce thrashing.

### 5.1 Consistent hashing (sharding)

- **Use case:** Shard data or requests across N nodes (e.g. cache shards, partition keys). Adding or removing a node should minimize keys that move.
- **How:** Use a consistent-hash ring (e.g. hash key → point on ring → clockwise next node). Document in code: hash function (e.g. SHA-256 or MurmurHash), ring representation, and how node join/leave is handled.
- **Comment in code:** e.g. `// Shard: consistent_hash(key) → node; ring size 2^16; see docs/WIRE_FORMAT_AND_SCALING.md`

### 5.2 Hash-based routing / session affinity

- **Use case:** Send the same client or session to the same backend for cache affinity or stateful behavior.
- **How:** Fast hash (FNV-1a, xxHash, or high bits of a crypto hash) of a stable key (user id, session id, request id) modulo replica count. Same key → same backend.
- **Comment in code:** e.g. `// Route: backend_index = hash(sessionId) % len(backends); hash = xxHash64 for speed`

### 5.3 One hash strategy per concern

- Use **one** documented hash (and one strategy) for routing and **one** for sharding so behavior is predictable and debuggable. Document both in this doc and in `docs/METALLB_TRAFFIC_POLICY_AND_SCALE.md` when they affect traffic or MetalLB nodes.
