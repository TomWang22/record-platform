# Connection-Reset & API-Server Debug Playbook

**5-layer teaching outline.** This is how you teach it without destroying people. Same order as `./scripts/diagnose-reset-by-peer.sh`.

When you see `connection reset by peer` or `apiserver not ready` during reissue/preflight: **do not debug everything at once.** Kill hypotheses layer by layer.

**Mantra:** *Reads test reachability. Writes test stability. Resets test assumptions.*

---

## Rule 0 (teach this first)

**Never debug everything at once. Kill hypotheses layer by layer.**

---

## Layer 1 — Symptom classification (~5 min)

**Goal:** Stop panic.

**Commands:**
```bash
kubectl get nodes
kubectl create ns test
```

**Lesson:** Reads vs writes are different. Success on get nodes ≠ stability on create. Read path OK + write path reset = write-path / tunnel stability (this is what reissue step 2 hits).

| Result | Meaning |
|--------|--------|
| get nodes ❌ | transport / tunnel / kubeconfig |
| get nodes ✅, create ns ❌ | write-path problem (reissue step 2) |
| both ✅ | not this bug right now |

**If stderr says "ServiceUnavailable" or "503" / "unable to handle the request":** That is **not** connection reset — the API server is overloaded or still starting. Run `./scripts/colima-api-status.sh` for k3s status; then wait 30–60s, or `colima ssh -- sudo systemctl restart k3s`, or `./scripts/colima-teardown-and-start.sh`. See Runbook.md "When you see 503 ServiceUnavailable".

---

## Layer 2 — Transport truth (~10 min)

**Goal:** Prove reality.

**Commands:**
```bash
# Terminal 1:
sudo tcpdump -nn -i lo0 tcp port 6443   # 2>&1 | tee /tmp/rst-6443.log

# Terminal 2: run the failing command (preflight or kubectl create secret ...)

# Then:
grep -E 'R |RST|rst' /tmp/rst-6443.log
```

**Lesson:** The network is not flaky. Something is **choosing** to reset. This is where minds snap into place.

If no RST in capture → timeout / drop, not reset; different problem.

---

## Layer 3 — TLS boundary (~10 min)

**Goal:** Eliminate red herrings.

**Commands:**
```bash
openssl s_client -connect 127.0.0.1:6443 -servername kubernetes
curl -k https://127.0.0.1:6443/version
```

**Lesson:** TLS success ≠ app success. Certs are not always the villain. Huge for people who think “TLS broke it”.

| Result | Meaning |
|--------|--------|
| handshake fails | TLS / CA / ALPN |
| handshake succeeds, kubectl still resets | problem is **after** TLS (HTTP/API or tunnel under load) |

---

## Layer 4 — Path divergence (~15 min)

**Goal:** Reveal the real cause.

**Commands:**
```bash
lsof -i :6443
ps aux | grep ssh
colima ssh -- kubectl get nodes
```

**Lesson:** Same API, different access path. Tunnels are stateful. Control plane access path matters. This is where infra thinking is born.

- **Host** `kubectl get nodes` → goes through host kubeconfig (often 127.0.0.1:6443 = SSH tunnel from host to VM).
- **In-VM** `colima ssh -- kubectl get nodes` → uses VM’s kubeconfig (or in-VM port from k3s.yaml).
- If host OK but in-VM **connection refused** to k3s.yaml port (e.g. 49524) → that port is ephemeral or k3s moved; reissue step 2 was using it and failed. **Fix:** use VM default kubeconfig (no `--server`) or host kubectl for step 2.
- If host fails, in-VM OK → tunnel (6443) down; use `colima ssh` for kubectl or `./scripts/colima-forward-6443.sh`.

---

## Layer 5 — Load correlation (~15 min)

**Goal:** Connect cause to timing.

**Commands:**
```bash
# Reproduce / correlate:
pgbench …   # or k6 run …
for i in 1 2 3 4 5; do kubectl create secret generic test-$i --from-literal=a=b -n default; done
# or run full preflight (reissue step 2 is a burst of create secret)
```

**Lesson:** Burst ≠ scale. Resets are a pressure response. Health ≠ capacity. Senior-level insight.

If first few create secret pass then reset → control plane or tunnel under burst (matches reissue step 2).

---

## Diagnostic script (runs all 5 layers)

```bash
./scripts/diagnose-reset-by-peer.sh [PORT]   # PORT defaults to 6443
DEEP=1 DIAG_GATHER=1 ./scripts/diagnose-reset-by-peer.sh 6443   # full + log
TCPDUMP_SEC=10 ./scripts/diagnose-reset-by-peer.sh 6443        # capture packets
```

- **DEEP=1** — Colima status, ports, lsof, path divergence (host vs in-VM, k3s.yaml port), HTTP layer.
- **DIAG_GATHER=1** — write full output to `scripts/diag-reset-YYYYMMDD-HHMMSS.log`. Preflight runs this when reissue fails.

---

## Colima + kubeconfig (when Layer 1 read fails)

**What port is kubeconfig pointing to?**
```bash
kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}'
```
Typical: `https://127.0.0.1:6443` (tunnel) or `https://127.0.0.1:49400` (native).

**Reachability:**
```bash
nc -zv 127.0.0.1 6443
nc -zv 127.0.0.1 49400
```

If 6443 ❌ and native ✅ → pin kubeconfig:  
`kubectl config set-cluster colima --server=https://127.0.0.1:49400`

**Re-establish tunnel:**  
`./scripts/colima-forward-6443.sh`

---

## Tunnel layer (the silent killer)

**Is SSH forwarding still alive?**
```bash
ps aux | grep 'ssh.*6443'
lsof -i :6443
```
If nothing listening on 6443 → tunnel died. Restart: `./scripts/colima-forward-6443.sh`. SSH tunnels die quietly under CPU/IO pressure.

---

## k3s-specific options (when stuck)

**Restart k3s inside Colima:**
```bash
colima ssh
sudo systemctl restart k3s   # or: sudo service k3s restart
exit
```

**Or fully reset:**
```bash
colima stop
colima start --with-kubernetes
```
Or pipeline: `COLIMA_TEARDOWN_FIRST=1` then re-run preflight.

**k3s / API server tuning (resets persist under burst):**
```bash
colima stop
colima start --with-kubernetes --k3s-arg '--kube-apiserver-arg=max-requests-inflight=2000' --k3s-arg '--kube-apiserver-arg=max-mutating-requests-inflight=1000'
./scripts/colima-forward-6443.sh
```
Prefer **path fix first:** preflight uses **REISSUE_STEP2_VIA_SSH=1** so step 2 runs via `colima ssh` (VM path), not the 6443 tunnel — main stability fix. Reissue now prefers VM default kubeconfig over k3s.yaml so the ephemeral port (e.g. 49524) is not used.

---

## Fix pattern (teach explicitly)

1. **Stop retries** (Ctrl+C or let script exhaust).
2. **Re-establish stable API access** — `./scripts/colima-forward-6443.sh` or pin to native port.
3. **Wait for apiserver to settle** (30–60s or until `kubectl get events` is quiet).
4. **Resume with spacing** — reissue already retries; if needed run reissue alone after settle.
5. **Only then** re-run preflight or reissue.

Preflight: step 2 via colima ssh, tunnel re-establish, warm-up, 12× retries. If it still fails, use this sequence then re-run. Last resort: k3s tuning above or COLIMA_TEARDOWN_FIRST=1.

---

## Runbook

Runbook item **32** has the same playbook in short form and exact commands.
