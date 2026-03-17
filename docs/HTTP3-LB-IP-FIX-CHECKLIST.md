# HTTP/3 via LB IP — Deterministic Fix Checklist

When **HTTP/3 works on NodePort** but **fails on LB IP**, the backend and k3d are fine. The failure is in the path between the host and the NodePort: **loopback alias → socat bind → UDP forward**. Follow this checklist in order. No guessing.

---

## 0. Table setting (before running tests)

Do this once so **HTTP/2** and **HTTP/3** manual curls work and scripts report correctly.

1. **Cluster must be running.**  
   If `kubectl get pods -n ingress-nginx` (or `kubectl get nodes`) shows **connection refused**, or k3d says **Cannot connect to the Docker daemon**, run:
   ```bash
   ./scripts/start-k3d-cluster.sh
   ```
   That script ensures Docker (Colima) is reachable, restarts Colima if needed, then runs `k3d cluster start record-platform` and merges kubeconfig. If the cluster doesn’t exist yet, create it with `./scripts/k3d-create-2-node-cluster.sh` first.

2. **Use Homebrew curl for HTTPS to the LB IP.**  
   System curl (LibreSSL) can give `SSL_ERROR_SYSCALL` (curl 35) to the LB IP even when the cluster is up. Scripts prefer `/opt/homebrew/opt/curl/bin/curl` when present; for **manual** tests use it too:
   ```bash
   export PATH="/opt/homebrew/opt/curl/bin:$PATH"
   ```
   (Or call `/opt/homebrew/opt/curl/bin/curl` explicitly.) HTTP/3 requires this curl (`--http3-only`).

3. **Run reset, then setup** with your MetalLB IP and NodePort:
   ```bash
   export LB_IP=192.168.106.240 NODEPORT=30443
   sudo LB_IP=$LB_IP NODEPORT=$NODEPORT ./scripts/fix-http3-lb-ip-reset.sh
   sudo LB_IP=$LB_IP NODEPORT=$NODEPORT ./scripts/setup-lb-ip-host-access.sh
   ```
   Scripts wait a few seconds and retry the HTTP/2 check; if it still fails, they print a **NodePort** curl so you can confirm Caddy is up.

4. **If HTTP/2 via LB IP still fails**, verify NodePort first (replace `$LB_IP` with your IP if testing manually):
   ```bash
   curl -k --http2 -sS -o /dev/null -w '%{http_code}' --resolve record.local:30443:127.0.0.1 https://record.local:30443/_caddy/healthz
   ```
   If this returns **200**, Caddy is fine and the issue is the alias/socat path; use the diagnostic script.

5. **When host HTTP/3 fails** (NodePort or LB IP returns 000):  
   - **Verify HTTP/3 in-cluster** (bypasses NodePort/host): `./scripts/verify-caddy-http3-in-cluster.sh`  
   - **Bypass NodePort for TCP only:** `CADDY_DIRECT=1 sudo LB_IP=$LB_IP NODEPORT=$NODEPORT ./scripts/setup-lb-ip-host-access.sh` (TCP goes to Caddy via port-forward; HTTP/2 via LB IP works).

6. **macOS + k3d: host HTTP/3 cannot bypass NodePort.** UDP from host → 127.0.0.1:30443 is unreliable (Docker/Colima). There is no UDP port-forward in kubectl. So: use **in-cluster** verification for HTTP/3; use **HTTP/2 via LB IP** from the host. Preflight step 4f verifies HTTP/3 via MetalLB IP from a pod.

7. **Clean slate (duplicate socat / two LB IPs):** If you see two UDP 443 listeners (e.g. 192.168.106.240 and 192.168.106.241) or "Address already in use" in the socat log, stop everything and reset with a single LB_IP:
   ```bash
   STOP_ALL_LB_IP=1 REMOVE_ALIAS=1 ./scripts/stop-lb-ip-host-access.sh
   export LB_IP=192.168.106.240 NODEPORT=30443   # use your current Caddy EXTERNAL-IP
   sudo LB_IP=$LB_IP NODEPORT=$NODEPORT ./scripts/fix-http3-lb-ip-reset.sh
   sudo LB_IP=$LB_IP NODEPORT=$NODEPORT ./scripts/setup-lb-ip-host-access.sh
   ```

---

## 1. Understand the path

```
curl (UDP 443)
   ↓
LB_IP bound to lo0 (alias)
   ↓
socat UDP-LISTEN:443 bind=$LB_IP
   ↓
127.0.0.1:$NODEPORT (UDP)
   ↓
Docker publish
   ↓
k3d serverlb container
   ↓
Caddy pod
```

If NodePort works but LB IP doesn’t: **backend is fine**. The break is in:

**LB_IP → socat → UDP bind → loopback → forwarding.**

---

## 2. Step-by-step checklist

Do these in order. Do not skip.

### 1️⃣ Confirm HTTP/3 works on NodePort

From host (use Homebrew curl so `--http3-only` works; see §0):

```bash
curl --http3-only -k https://record.local:30443/_caddy/healthz \
  --resolve record.local:30443:127.0.0.1
```

- **If this fails** → stop. Backend or k3d UDP publish problem (see [RCA-HTTP3-QUIC-AND-METALLB-NETWORKING.md](./RCA-HTTP3-QUIC-AND-METALLB-NETWORKING.md)).
- **If this works** → continue.

### 2️⃣ Confirm LB IP is aliased on lo0

```bash
ifconfig lo0 | grep 192.168.106.241
```

If not present:

```bash
sudo ifconfig lo0 alias 192.168.106.241
```

Without this, UDP to the LB IP will never bind correctly.

### 3️⃣ Confirm UDP 443 is actually listening

```bash
sudo lsof -i UDP:443
```

You should see socat (or the forwarder) bound to UDP port 443.

- **If nothing is listening** → socat never started or crashed.
- **If something else is listening** → kill it (step 5), then restart socat.

### 4️⃣ Check socat is bound to the correct IP

Correct command:

```bash
sudo socat -d -d \
  UDP-LISTEN:443,reuseaddr,bind=192.168.106.241 \
  UDP:127.0.0.1:30443
```

Common mistake: **no `bind=LB_IP`** → binds to 0.0.0.0 → routing weirdness. Always use `bind=$LB_IP`.

### 5️⃣ If you see "Address already in use"

Means: stale socat or something else holding UDP 443.

Fix:

```bash
sudo lsof -t -i UDP:443 | xargs sudo kill -9
```

Then restart socat (or run the setup script again).

### 6️⃣ Confirm packets hit the host

```bash
sudo tcpdump -i lo0 udp port 443
```

In another terminal (use Homebrew curl; see §0):

```bash
curl --http3-only -k \
  --resolve record.local:443:192.168.106.241 \
  https://record.local/_caddy/healthz
```

- **If tcpdump shows packets** → traffic is reaching the host.
- **If no packets** → curl is not actually using the LB IP (check `--resolve`, DNS, curl binary).

### 7️⃣ If packets arrive but no forwarding

Check the socat log. If you see **"Connection refused"**:

Nothing is listening on `127.0.0.1:30443` UDP. So either:

- k3d did not publish UDP NodePort → recreate cluster with UDP 30443 (see RCA doc), or
- Docker Desktop for Mac is dropping UDP (see [RCA-HTTP3-QUIC-AND-METALLB-NETWORKING.md](./RCA-HTTP3-QUIC-AND-METALLB-NETWORKING.md) §2.3).

### 8️⃣ On macOS — GSO bug

If you get weird QUIC behaviour:

```bash
export NGTCP2_ENABLE_GSO=0
```

before curl. Our scripts set this automatically.

---

## 3. The three most common root causes

1. **Stale socat holding UDP 443** → kill + restart.
2. **socat not bound to LB_IP** → use `bind=$LB_IP`.
3. **k3d not publishing UDP NodePort** → recreate cluster with UDP 30443.

---

## 4. Clean “reset all holders”

Reset every process holding 443 (TCP and UDP), re-add the alias, and start both forwarders. Best way to get a clean slate and see what’s going on.

```bash
LB_IP=192.168.106.240 NODEPORT=30443   # or your values
sudo LB_IP=$LB_IP NODEPORT=$NODEPORT ./scripts/fix-http3-lb-ip-reset.sh
```

The script: kills existing forwarders (from PID files), kills **all** holders of TCP 443 and UDP 443, re-adds the loopback alias, then starts TCP and UDP forwarders (same as setup). No guessing.

Manual one-shot (replace IP/port with your `LB_IP` and `NODEPORT`):

```bash
sudo lsof -t -i UDP:443 | xargs sudo kill -9 2>/dev/null
sudo lsof -t -i TCP:443 | xargs sudo kill -9 2>/dev/null

sudo ifconfig lo0 -alias 192.168.106.241 2>/dev/null
sudo ifconfig lo0 alias 192.168.106.241

sudo socat -d -d \
  UDP-LISTEN:443,reuseaddr,bind=192.168.106.241 \
  UDP:127.0.0.1:30443
```

Then test again.

---

## 5. Why this felt hard

UDP has no connection state. With TCP you see SYN/ACK; with UDP either a packet arrives or it disappears. So the only truth source is **tcpdump** and **lsof**. The failure is never “HTTP/3” or “QUIC” in this path — it’s **loopback aliasing, UDP binding, stale processes, and Docker publish**.

---

## 6. Scripts reference

| Goal | Script |
|------|--------|
| Full setup (alias + TCP + UDP forwarders) | `scripts/setup-lb-ip-host-access.sh` |
| Reset all holders (kill TCP+UDP 443, re-alias, start both forwarders) | `scripts/fix-http3-lb-ip-reset.sh` |
| Under-the-hood diagnostic (tcpdump, socat log, who holds port) | `scripts/diagnose-http3-lb-ip-under-the-hood.sh` |
| Stop forwarders | `scripts/stop-lb-ip-host-access.sh` |
| Verify k3d publishes TCP+UDP 30443 | `scripts/verify-k3d-30443-udp.sh` |
