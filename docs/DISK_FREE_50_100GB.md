# Freeing 50–100 GB When Disk Is Full

When you hit "No space left on device" during transport runs (e.g. BBR vs CUBIC with capture), use these in order.

## Storage report: what’s using space

Run `./scripts/storage-report.sh` for a quick breakdown. Typical large consumers:

| Location | Size | Reclaimable | Notes |
|----------|------|-------------|--------|
| **Cursor Application Support** | **~212 GB** | **~171 GB** | See below |
| ~/.colima (VM disk) | ~24 GB | 0 (keep cluster) | Shrink only by `colima delete` |
| ~/.cursor (cache) | ~5.5 GB | ~5 GB | Clear via Cursor Settings or rm cache dirs |
| Library/Caches/colima | ~5.1 GB | ~5 GB | Colima/Lima caches; safe to clear |
| Library/Caches/Google | ~1.5 GB | ~1.5 GB | Chrome cache |
| Library/Caches/go-build | ~912 MB | ~912 MB | `go clean -cache` |
| Library/Caches/Homebrew | ~408 MB | ~408 MB | `brew cleanup -s` |
| Docker (images/volumes in use) | ~8 GB | ~0.6 GB | `docker system prune -af` (unused only) |
| Applications (Docker, Chrome, etc.) | varies | — | Uninstall unused apps |

**Cursor Application Support** (`~/Library/Application Support/Cursor`):

- **snapshots/codebases** — ~114 GB. Cursor’s indexed codebase snapshots. Deleting forces re-indexing but reclaims space.
- **snapshots/roots** — ~57 GB. Snapshot roots. Same tradeoff.
- **User/globalStorage** — ~40 GB. Extension/global state. Clearing may reset extension data.

To reclaim **~171 GB** from Cursor snapshots (Cursor will re-index when you open projects):

- **Chats/transcripts are safe:** they live under `~/.cursor/projects/.../agent-transcripts/`, not under `Library/Application Support/Cursor`. Deleting the snapshots below does **not** remove current or past chats.

```bash
# Close Cursor first, then:
rm -rf ~/Library/Application\ Support/Cursor/snapshots/codebases/*
rm -rf ~/Library/Application\ Support/Cursor/snapshots/roots/*
```

To reclaim **~5 GB** from Colima’s cache (Colima will re-download if needed):

```bash
rm -rf ~/Library/Caches/colima/caches/*
```

---

## Docker + Colima: same setup so prune works

If `colima list` shows **Running** but `docker system prune -af` says **Cannot connect to the Docker daemon**:

1. **Restart Colima** (keeps cluster and network; re-establishes Docker socket):
   ```bash
   colima stop --force
   colima start
   ```
2. **Use Colima’s Docker** (context is usually set automatically after start):
   ```bash
   docker context use colima   # if needed
   docker system prune -af
   docker builder prune -af
   ```
3. **Socket/context:** Colima forwards the VM’s `/var/run/docker.sock` to `~/.colima/default/docker.sock`. The `colima` context points there. No need to set `DOCKER_HOST` if context is `colima`.

If you see "empty value" from `colima status`, the VM was in a bad state; `colima stop --force` then `colima start` fixes it without deleting the cluster.

---

## Quick wins (run from project root)

```bash
# 1. Emergency cleanup (bench logs, backups, Next.js cache, /tmp packet-capture dirs)
./scripts/emergency-disk-cleanup.sh

# 2. Aggressive (also removes old test-results, rotation-wire, and node_modules — need pnpm install after)
./scripts/emergency-disk-cleanup.sh --aggressive
```

## Big reclaims (50–100 GB)

### Colima VM (~25 GB)

Colima’s default VM disk is under `~/.colima` and is often 20–30 GB.

- **Option A – Delete VM (frees ~25 GB, loses cluster):**
  ```bash
  colima stop
  colima delete
  ```
  Recreate later with `colima start` (and re-apply k8s/MetalLB if needed).

- **Option B – Keep VM, free Docker inside:** start Colima then prune (see Docker section).

### Docker (~13+ GB)

Requires Colima (or Docker) to be running.

```bash
colima start   # if you use Colima
docker system prune -af          # all unused images/containers
docker builder prune -af         # build cache
docker volume prune -f            # unused volumes (⚠️ can remove data)
```

After prune, `~/.colima` may still be large (VM disk); to reclaim that space you need Option A above (colima delete).

### Cursor cache and snapshots (~212 GB total, ~176 GB reclaimable)

- **~/.cursor** (~5.5 GB): In Cursor → **Settings → Cursor Settings → Clear Cache**, or remove `~/.cursor/Cache`, `~/.cursor/CachedData` (not the whole `~/.cursor` folder).
- **Application Support/Cursor/snapshots** (~171 GB): See [Storage report](#storage-report-whats-using-space) above. Delete `snapshots/codebases/*` and `snapshots/roots/*` with Cursor closed to reclaim ~171 GB (Cursor will re-index).

### Homebrew (~400 MB)

```bash
brew cleanup -s
```

### Xcode DerivedData (if you use Xcode)

```bash
rm -rf ~/Library/Developer/Xcode/DerivedData/*
```

## After freeing space

1. Re-run BBR vs CUBIC **without** `--capture` if you only need the comparison (no pcaps), to avoid filling disk again.
2. Or run with `--capture` only after ensuring enough free space (e.g. 10+ GB).
3. `./scripts/emergency-disk-cleanup.sh` now also removes `/tmp/packet-captures-*` and `/tmp/three-layer-capture-*` (Step 7c); run it periodically after transport runs.
