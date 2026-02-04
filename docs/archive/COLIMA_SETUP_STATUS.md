# Colima Setup Status

**Date:** January 13, 2025  
**Status:** ✅ COMPLETE - Colima Running with containerd Runtime

---

## ✅ Current Status

### Colima Configuration
- **Runtime:** containerd (✅ Verified)
- **CPU:** 8 cores
- **Memory:** 12GB
- **Disk:** 200GB
- **Kubernetes:** Enabled (k3s)
- **Mount Type:** virtiofs

### Verification Commands
```bash
# Check Colima status
colima status
# Output: runtime: containerd ✅

# List containers (use nerdctl, not docker)
colima nerdctl ps

# Check Kubernetes
kubectl cluster-info
# Output: Kubernetes control plane is running ✅
```

---

## 🔧 Important: Using containerd Runtime

### Key Difference: nerdctl vs docker

With containerd runtime, you **cannot use `docker` commands**. Use `colima nerdctl` instead:

| Docker Command | nerdctl Equivalent |
|----------------|-------------------|
| `docker ps` | `colima nerdctl ps` |
| `docker images` | `colima nerdctl images` |
| `docker build` | `colima nerdctl build` |
| `docker compose up` | `colima nerdctl compose up` |
| `docker-compose up` | `colima nerdctl compose up` |

### Optional: Create Alias
```bash
# Add to ~/.zshrc or ~/.bashrc
alias docker='colima nerdctl'

# Then you can use:
docker ps
docker images
docker compose up
```

---

## 📋 Next Steps

### 1. Restore PostgreSQL Data
**Script:** `./scripts/restore-postgres-databases.sh`

**Important:** Update the script to use `colima nerdctl` instead of `docker`:
```bash
# Before running restore script, update it to use:
colima nerdctl compose up -d  # Instead of docker-compose up -d
colima nerdctl exec ...        # Instead of docker exec
```

**Backups Available:**
- Location: `record-platform/backups/*.sql`
- Size: ~1.9GB (8 databases)
- Date: January 1, 2025

### 2. Set Up Docker Compose Services
Since we're using containerd, update Docker Compose usage:
```bash
# Start services
colima nerdctl compose up -d

# Or create alias first (recommended)
alias docker='colima nerdctl'
docker compose up -d
```

### 3. Build and Load Images
**For Kind cluster:**
```bash
# Build images using nerdctl
colima nerdctl build -t service-name:dev -f services/service-name/Dockerfile .

# Load into Kind (if Kind cluster exists)
kind load docker-image service-name:dev --name h3
```

**Note:** Kind may need Docker socket, not nerdctl. You may need to:
- Use Docker runtime for builds that go to Kind, OR
- Build in Colima then export/import images

---

## 🔍 Verification Results

### Colima Status
```
✅ Runtime: containerd
✅ Kubernetes: enabled
✅ Containerd socket: unix:///Users/tom/.colima/default/containerd.sock
✅ BuildKit socket: unix:///Users/tom/.colima/default/buildkitd.sock
```

### Containerd Info
```
✅ Server Version: v2.1.4
✅ Storage Driver: overlayfs
✅ Cgroup Driver: systemd
```

### Kubernetes
```
✅ Control plane running at https://127.0.0.1:55600
✅ CoreDNS running
✅ Metrics-server running
```

---

## ⚠️ Known Differences from Docker Runtime

1. **No Docker socket** - Cannot use `docker` command directly
2. **Use nerdctl** - All container operations via `colima nerdctl`
3. **Docker Compose** - Use `colima nerdctl compose` instead of `docker-compose`
4. **Kind compatibility** - Kind expects Docker socket; may need workaround for image loading

---

## 📝 Configuration Files

- **Colima config:** `~/.colima/default/colima.yaml`
  - Runtime: `containerd` ✅
  
- **Kubeconfig:** `~/.colima/default/kubernetes/kubeconfig`
  - Auto-configured ✅

---

## 🎯 Migration Checklist

- [x] Colima installed
- [x] Colima configured with containerd runtime
- [x] Kubernetes enabled and verified
- [x] Containerd runtime verified
- [ ] PostgreSQL data restored (next step)
- [ ] Docker Compose services running
- [ ] All services tested and working

---

**Last Updated:** January 13, 2025  
**Status:** ✅ Colima setup complete, ready for data restoration
