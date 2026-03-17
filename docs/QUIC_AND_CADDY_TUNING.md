# QUIC & Caddy Tuning for Colima / macOS

When running k6 rotation tests against Caddy (HTTP/2 + HTTP/3) on Colima + k3s, QUIC can saturate under load. This doc explains why and how to tune.

## What’s Actually Happening

- **TLS/ALPN** – Working correctly (TLS 1.3, ALPN h2). Wire capture shows HTTP/2 intent in ClientHello.
- **HTTP/2 frames = 0** – Expected when not using SSLKEYLOGFILE; frames are inside TLS.
- **QUIC stalls** – Resource saturation (CPU, UDP buffers, event loop), not TLS downgrade.
- **Envoy “no QUIC”** – Expected: Client → Caddy (QUIC) → Envoy (HTTP/2) → backend.

## Little’s Law

- λ ≈ 313 req/s, W ≈ 0.15 s → L ≈ 46 concurrent in flight
- With 900 VUs (300 H2 + 600 H3), most VUs are waiting; scheduler thrashes and QUIC starves

## Tuning

### 1. Conservative VU Preset (Colima/macOS)

```bash
K6_CONSERVATIVE=1 ./scripts/rotation-suite.sh
```

Uses lower rates and VUs (H2: 200 req/s / 150 VUs, H3: 100 req/s / 100 VUs) to stay near L≈46.

### 2. Caddy Resources

Caddy with QUIC needs more CPU than default 500m. In `infra/k8s/caddy-h3-deploy.yaml`:

```yaml
resources:
  requests: { cpu: "500m", memory: "256Mi" }
  limits: { cpu: "2", memory: "1Gi" }
```

If CPU stays > 80%, increase limits further or scale replicas.

### 3. UDP Buffers (Colima VM – Linux sysctls)

These are **Linux** parameters; apply them **inside Colima** (not on macOS host):

```bash
./scripts/colima-quic-sysctl.sh
```

Or manually:

```bash
colima ssh -- sudo sysctl -w net.core.rmem_max=67108864
colima ssh -- sudo sysctl -w net.core.wmem_max=67108864
colima ssh -- sudo sysctl -w net.ipv4.udp_mem="262144 524288 1048576"
colima ssh -- sudo sysctl -w net.ipv4.udp_rmem_min=16384
colima ssh -- sudo sysctl -w net.ipv4.udp_wmem_min=16384
```

Then restart Caddy: `./scripts/rollout-caddy.sh`

**Note:** These sysctls reset when Colima VM restarts; re-run after `colima start`.

### 4. HTTP/2 Frame Decryption (Optional)

To prove HTTP/2 frames on wire:

```bash
ROTATION_H2_KEYLOG=1 ./scripts/rotation-suite.sh
```

Requires k6 on host (not in-cluster). TLS keys are written to `SSLKEYLOGFILE` and used by tshark for verification.

### 5. Production-Grade QUIC

For high-throughput QUIC, prefer:

- Linux host (not macOS VM)
- Host networking or minimal layers
- Larger UDP buffers
- CPU pinning
- BBR congestion control (if available)

QUIC performs best on bare Linux; nested virtualization adds overhead.

## Next: Transport-Layer Study

For a full transport-layer analysis (UDP loss %, QUIC CWnd, BBR vs CUBIC, MetalLB vs NodePort, Caddy outside VM), see [TRANSPORT_LAYER_STUDY_PLAN.md](./TRANSPORT_LAYER_STUDY_PLAN.md).
