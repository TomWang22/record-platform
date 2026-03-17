# Colima + k3s: concrete reclaim and stabilize plan

**Goal:** Know exactly what you can reclaim, what is **safe to remove**, and in what order — then get Colima/k3s stable again. Use with **scripts/colima-k3s-storage-diagnostic.sh** output.

---

## 1. What the diagnostic shows (and what it means)

From **scripts/colima-k3s-storage-diagnostic.sh** you get:

| Where | What | Your numbers (example) | Reclaimable? |
|-------|------|------------------------|--------------|
| **VM root** (`/dev/root`) | OS + k3s binaries, etcd | 19G, 11% used | No — leave as is. |
| **VM Colima disk** (`/mnt/lima-colima`) | Colima VM data (disks, k3s, containerd) | 252G, 99G used, 41% | Optional: prune inside VM (see below). |
| **Host mount** (`mount0` = /Users/tom) | Your Mac home dir (repo, Docker context) | 461G, 84% | Reclaim on **host** (Docker, caches, repo). |
| **k3s** (`/var/lib/rancher/k3s`) | etcd + k3s data | ~1.1G | Do **not** delete — required. |
| **containerd** (in VM) | Container layers (k3s pods, etc.) | ~5.5G | Do **not** prune from host blindly — k3s uses it. |
| **Docker (host)** | Images, containers, volumes, build cache | 41GB images, 63GB volumes, 19GB build cache | **Yes** — see “Safe to remove” below. |

**Important:** When Docker context is **colima**, `docker` commands run against the Colima VM. So “Docker reclaimable” (images, build cache, stopped containers) is **inside** the Colima disk usage. Reclaiming it frees space in the VM and on the Colima disk.

---

## 2. What you can reclaim (and what is safe to remove)

### 2.1 Safe to remove (no risk to Postgres data or running apps)

| Item | Command / action | Approx. reclaim | Notes |
|------|------------------|------------------|--------|
| **Build cache** | `docker builder prune -af` | Up to ~19GB | Next build will be slower once; cache rebuilds. Safe. |
| **Stopped / unused containers** | `docker container prune -f` | ~0.1GB (you had 109MB reclaimable) | Only removes stopped containers. Safe. |
| **Dangling (untagged) images** | `docker image prune -f` | Variable | Images not used by any container. Safe. |
| **Unused images (not used by any container)** | `docker image prune -a` | Up to ~32GB (you had 32.62GB reclaimable on images) | **Careful:** removes images not referenced by any container. Next pull/build will re-download. Do after stopping non-essential stacks. |
| **Old bench_logs / test results** | `./scripts/cleanup-old-bench-results.sh` or manual rm | Depends | Keep last N days; remove old `bench_logs/`, `test-results/`, `daily-pgbench-*`, `daily-suite-*` older than 7–14 days. |

### 2.2 Do NOT remove (or only with explicit backup)

| Item | Why |
|------|-----|
| **Docker volumes** (e.g. `*_pgdata`, `record-platform_*`) | Postgres and app data. Removing loses DBs. |
| **`/var/lib/rancher/k3s`** in VM | etcd + k3s state. Deleting breaks the cluster. |
| **Running containers** | Needed for platform (Postgres, k3s, app). |

### 2.3 Optional (only if you know you don’t need them)

| Item | Command | When |
|------|----------|------|
| **All unused images** | `docker image prune -a -f` | When you’re OK re-pulling/rebuilding all images. |
| **Old backups** | Keep latest; `rm` old `backups/*.sql` / `*.dump` | After confirming you have a good backup elsewhere. |
| **Repo caches** | `rm -rf .next node_modules` then reinstall | Dev only; rebuilds from scratch. |

---

## 3. Concrete order of operations (reclaim then stabilize)

### Phase A — Reclaim (safe steps only)

Run from repo root. **Optional:** run with `DRY_RUN=1` first to only print what would be done.

1. **See current state**
   ```bash
   ./scripts/colima-k3s-storage-diagnostic.sh
   docker system df
   ```

2. **Safe prune (no volumes, no forced remove of tagged images)**
   ```bash
   docker builder prune -af
   docker container prune -f
   docker image prune -f
   ```
   This reclaims build cache, stopped containers, and dangling images. Typical reclaim: build cache (e.g. ~19GB) + a bit from containers/images.

3. **Optional: remove unused tagged images** (reclaim more, next run will re-pull)
   ```bash
   docker image prune -a -f
   ```
   Only if you’re OK re-pulling images for docker-compose / k8s.

4. **Optional: old results and logs**
   ```bash
   # e.g. keep last 7 days of daily-pgbench and daily-suite
   find /tmp -maxdepth 1 -type d -name 'daily-pgbench-*' -mtime +7 -exec rm -rf {} + 2>/dev/null || true
   find /tmp -maxdepth 1 -type d -name 'daily-suite-*' -mtime +7 -exec rm -rf {} + 2>/dev/null || true
   ```

5. **Re-check**
   ```bash
   docker system df
   ./scripts/colima-k3s-storage-diagnostic.sh
   ```

### Phase B — Stabilize k3s (after reclaim or if API is down)

1. **Restart k3s** (clears in-memory pressure; etcd persists)
   ```bash
   colima ssh -- sudo systemctl restart k3s
   ```
   Wait 60–90s, then:

2. **Re-establish API access**
   ```bash
   ./scripts/colima-forward-6443.sh
   kubectl get nodes
   ```

3. **If API is still down:** full Colima restart (last resort)
   ```bash
   colima stop
   colima start --with-kubernetes
   CONSERVATIVE=1 ./scripts/apply-k3s-etcd-tuning.sh
   ./scripts/colima-forward-6443.sh
   ```

4. **Going forward:** use Phase 1 reissue (health gate + abort) and conservative tuning so you don’t hammer the API. See **docs/ETCD_WRITE_BUDGET_PLAN.md** and **docs/COLIMA_K3S_FORENSIC_AND_TUNING.md**.

---

## 4. One-shot “safe reclaim” script (optional)

You can run the safe steps in one go:

```bash
# Dry run (print only)
echo "Would run: docker builder prune -af, container prune -f, image prune -f"
docker system df

# Execute safe reclaim
docker builder prune -af
docker container prune -f
docker image prune -f
docker system df
```

Or use **scripts/cleanup-docker-storage.sh** (it prunes build cache and dangling images; may prompt for confirmation).

---

## 5. Summary table: safe vs not safe

| Action | Safe? | Reclaim | When to use |
|--------|--------|---------|-------------|
| `docker builder prune -af` | Yes | Build cache (~19GB) | Anytime |
| `docker container prune -f` | Yes | Stopped containers | Anytime |
| `docker image prune -f` | Yes | Dangling images | Anytime |
| `docker image prune -a -f` | Yes, but aggressive | Many GB (e.g. 32GB) | When OK to re-pull images |
| `docker volume rm …` | **No** (unless you know the volume) | — | Never for `*_pgdata` / app data |
| Delete `/var/lib/rancher/k3s` in VM | **No** | — | Never |
| Remove old `/tmp/daily-pgbench-*` (e.g. >7d) | Yes | Depends | When you don’t need old runs |
| `colima ssh -- sudo systemctl restart k3s` | Yes | 0 (stability) | When API is flaky |
| `colima stop && colima start` | Yes | 0 (stability) | Last resort |

---

## 6. References

- **docs/COLIMA_K3S_WHY_UNHAPPY_CHECKLIST.md** — Everything that can make Colima k3s unhappy (disk, write burst, memory, network, etc.).
- **scripts/colima-k3s-storage-diagnostic.sh** — Run first to see VM disk, k3s size, Docker reclaimable.
- **scripts/cleanup-docker-storage.sh** — Safe Docker prune + optional backup cleanup.
- **scripts/cleanup-disk-space.sh** — Docker Desktop removal / Colima-focused cleanup.
- **docs/COLIMA_K3S_FORENSIC_AND_TUNING.md** — Why k3s is unhappy (write budget, not just disk).
- **docs/ETCD_WRITE_BUDGET_PLAN.md** — Health gate, abort, tuning.
