# HTTP/3 (QUIC) curl exit codes and isolation

When HTTP/3 tests fail with **curl exit 7, 28, or 55**, use this to decode and isolate. No guessing — eliminate one layer at a time.

**Baseline output:** Failed tests show **HTTP status** and **curl exit code** (and for HTTP/3, a short meaning: connection refused / timeout / send failure). On success, DB checks appear as `Test N DB: … (port 54xx)`.

---

## Exit code meanings

| Exit | Meaning | Interpretation |
|------|--------|----------------|
| **7** | Could not connect | No listener on target (host or cluster). Packets never accepted. |
| **28** | Timeout | Curl waited too long. Something is slow or the path is broken mid-flight. |
| **55** | Send failure | For HTTP/3/QUIC: sendto() failed, socket write failure, or UDP path broke after handshake. Transport-layer. |

**You are not in “port not listening” only when you see 7.**  
**28 and 55 mean traffic is reaching something; then we find where it stalls.**

---

## The 3 critical checks (collapse the problem space)

Answer these in order:

1. **Is LB_IP on lo0?**  
   `ifconfig lo0 | grep <LB_IP>`  
   If missing → `sudo ifconfig lo0 alias <LB_IP>`

2. **Is something listening on UDP 443?**  
   `sudo lsof -i UDP:443`  
   You must see socat (or the forwarder). If nothing → socat not running or crashed.

3. **Does NodePort HTTP/3 work without LB?**  
   `NGTCP2_ENABLE_GSO=0 curl --http3-only -k https://127.0.0.1:30443/_caddy/healthz --connect-timeout 5`  
   - If this **fails** → problem is inside cluster or Docker UDP publish (k3d must publish UDP 30443).  
   - If this **works** → LB forward layer (socat / alias) is broken.

---

## Isolation steps (no skipping)

### 1. Is UDP 443 receiving packets?

```bash
sudo tcpdump -i lo0 udp port 443
```

Then in another terminal run your curl to LB_IP.  
- If tcpdump shows packets → client is sending correctly.  
- If no packets → curl not using LB_IP, or firewall, or wrong curl/resolve.

### 2. Is socat logging errors?

Run socat in foreground (verbose):

```bash
sudo socat -d -d \
  UDP-LISTEN:443,reuseaddr,bind=$LB_IP \
  UDP:127.0.0.1:$NODEPORT
```

Then curl again. Watch for: **Connection refused**, **Broken pipe**, or no activity.

### 3. Is UDP NodePort actually open?

```bash
sudo lsof -i UDP:$NODEPORT
docker ps   # ensure 0.0.0.0:30443->30443/udp
```

If UDP 30443 isn’t published, socat sends into a void → timeout (28).

### 4. macOS + QUIC: disable GSO

```bash
export NGTCP2_ENABLE_GSO=0
```

Then test. Scripts already set this; ensure it’s set when you run curl manually.

### 5. Port-forward test (bypass host forwarding)

If **host** HTTP/3 fails, prove HTTP/3 works **inside** the cluster:

```bash
kubectl port-forward -n ingress-nginx svc/caddy-h3 8443:443 &
sleep 2
NGTCP2_ENABLE_GSO=0 curl --http3-only -k https://localhost:8443/_caddy/healthz
kill %1 2>/dev/null
```

- If this **fails** → HTTP/3 not actually working in cluster (Caddy QUIC config or listener).  
- If this **works** → host forwarding layer (socat, alias, Docker UDP) is broken.

### 6. Curl binary (HTTP/3 support)

```bash
curl -V | grep -iE "HTTP3|ngtcp2|nghttp3"
```

If not present → you’re not using an HTTP/3-capable curl (e.g. use Homebrew curl).

---

## What 28 + 55 together usually mean (k3d + socat + macOS)

Often one of:

1. socat running but forwarding to wrong port  
2. UDP NodePort not published  
3. GSO / fragmentation  
4. Multiple socat processes  
5. Wrong curl binary (no HTTP/3)

---

## Scripts reference

| Goal | Script |
|------|--------|
| Full checklist (path, alias, socat, reset) | [HTTP3-LB-IP-FIX-CHECKLIST.md](./HTTP3-LB-IP-FIX-CHECKLIST.md) |
| Under-the-hood diagnostic (tcpdump, socat log, 3 checks, NodePort test) | `scripts/diagnose-http3-lb-ip-under-the-hood.sh` |
| Reset all holders, re-alias, start forwarders | `scripts/fix-http3-lb-ip-reset.sh` |
| Setup LB IP + socat (TCP + UDP) | `scripts/setup-lb-ip-host-access.sh` |
| Verify k3d publishes TCP+UDP 30443 | `scripts/verify-k3d-30443-udp.sh` |

---

## Mental model

- **Exit 7** = nothing listening  
- **Exit 28** = no response (timeout)  
- **Exit 55** = write/send failure  

For each failure, ask: Did the packet leave? Arrive? Get forwarded? Did a response come back?  
Each layer either confirms or eliminates a domain.
