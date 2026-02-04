# Storage Cleanup Action Plan

**Date:** January 8, 2025  
**Status:** 🔴 **CRITICAL - 100% Disk Full (1.3GB free)**  
**Target:** Free up 150-200GB to restore healthy operation

---

## 🎯 Quick Summary

Your disk is **completely full**. Here's what to do:

### Immediate (Do Now) - Recover ~6GB
1. Run the safe cleanup script: `./scripts/quick-cleanup-safe.sh`

### Biggest Impact - Recover ~150GB
2. Compact Docker.raw via Docker Desktop

### Additional - Recover ~10-15GB
3. Review Cursor globalStorage (can remove backup file)

---

## ✅ SAFE CLEANUP (Run First)

### Step 1: Safe Cleanup Script
**Recovers:** ~6GB immediately  
**Risk:** None  
**Time:** 2 minutes

```bash
cd /Users/tom/record-platform
./scripts/quick-cleanup-safe.sh
```

This will:
- Clear development caches (Colima, Go, Node, TypeScript, pip, pnpm)
- Clear old logs (older than 7 days)
- Show before/after free space

---

## 🔴 HIGH IMPACT: Docker.raw (256GB → ~50-100GB)

**Current Size:** 256GB  
**After Compact:** ~50-100GB (depends on actual usage)  
**Recovery:** ~150-200GB  
**Risk:** Low (if PostgreSQL backups verified)

### Prerequisites
✅ Verify PostgreSQL backups exist:
```bash
ls -lh record-platform/backups/*.sql
# Should show 8 files, ~1.9GB total
```

### Method 1: Docker Desktop Compact (Recommended)
1. Open **Docker Desktop**
2. Go to **Settings** (gear icon)
3. Click **Resources** → **Advanced**
4. Click **"Compact disk image"** button
5. Wait for completion (10-30 minutes)

### Method 2: Command Line (if available)
```bash
# If using Docker Desktop CLI
docker system prune -a --volumes --force
# Then compact via Docker Desktop UI
```

### ⚠️ Important Notes
- This compacts the virtual disk image (Docker.raw)
- It doesn't delete containers/images, just removes unused space
- Safe operation - your data is preserved
- Takes time depending on disk size

---

## 🟡 MEDIUM IMPACT: Cursor globalStorage (17GB)

**Location:** `~/Library/Application Support/Cursor/User/globalStorage/`

**Breakdown:**
- `state.vscdb`: 8.6GB (main database - **KEEP**)
- `state.vscdb.backup`: 8.5GB (backup - **CAN REMOVE**)
- `state.vscdb-wal`: 4.3MB (WAL file - small)

### Safe Cleanup
**Recovers:** ~8.5GB  
**Risk:** Low (backup file only)

```bash
# Remove backup file (Cursor will recreate if needed)
rm ~/Library/Application\ Support/Cursor/User/globalStorage/state.vscdb.backup

# After removing, you might want to compact the main database
# (Cursor may do this automatically, or restart Cursor)
```

### ⚠️ Important
- Keep `state.vscdb` - this is the main database
- The backup file is just a safety copy
- Cursor will continue working normally

---

## ⚠️ DO NOT DELETE (Important Files)

These are **in active use** or **critical**:

1. **Postgres var-16 (27GB)** - Postgres 16 is RUNNING, contains active databases
2. **Docker.raw** - Contains PostgreSQL data (compact instead of delete)
3. **record-platform/backups/*.sql** - Your database backups
4. **Cursor state.vscdb** - Main Cursor state database

---

## 📊 Expected Results

### After Safe Cleanup Script
- **Before:** 1.3GB free
- **After:** ~7GB free
- **Recovery:** +6GB

### After Docker.raw Compact
- **Before:** ~7GB free
- **After:** ~157-207GB free
- **Recovery:** +150-200GB

### After Cursor Backup Removal
- **Before:** ~157-207GB free
- **After:** ~165-215GB free
- **Recovery:** +8GB

### **Total Recovery: ~164-214GB**
### **Final Free Space: ~165-215GB** (healthy!)

---

## 🔧 Detailed Breakdown

### Current Storage Usage (432GB / 460GB)

| Item | Size | Action | Recovery |
|------|------|--------|----------|
| Docker.raw | 256GB | Compact | 150-200GB |
| Postgres var-16 | 27GB | **Keep** (in use) | 0GB |
| Cursor globalStorage | 17GB | Remove backup | 8GB |
| Cursor User/other | 1GB | Keep | 0GB |
| Application Support/other | 12GB | Review selectively | 2-5GB |
| Development Caches | 5GB | Clear | 5GB |
| Browser Caches | 2GB | Clear (optional) | 2GB |
| Old Logs | 1GB | Clear | 1GB |
| Other | ~111GB | Various | 0GB |

---

## 📋 Execution Checklist

- [ ] Verify PostgreSQL backups exist (`ls -lh record-platform/backups/*.sql`)
- [ ] Run safe cleanup script (`./scripts/quick-cleanup-safe.sh`)
- [ ] Verify free space increased (~7GB free)
- [ ] Open Docker Desktop
- [ ] Compact Docker.raw (Settings → Resources → Advanced → Compact)
- [ ] Wait for completion (~10-30 minutes)
- [ ] Verify free space increased (~157-207GB free)
- [ ] (Optional) Remove Cursor backup file (~8GB recovery)
- [ ] Verify final free space (~165-215GB free)

---

## 🚨 If Disk Still Full After Cleanup

If you still don't have enough space:

1. **Move Docker.raw to External Drive**
   - Extract PostgreSQL data first
   - Copy Docker.raw to external drive
   - Remove local copy

2. **Archive Old Files**
   - Move old projects to external drive
   - Archive old documents

3. **Review Large Directories**
   ```bash
   du -sh ~/* | sort -hr | head -20
   ```

---

## ✅ Verification Commands

After cleanup, verify results:

```bash
# Check free space
df -h .

# Check Docker.raw size (should be smaller)
ls -lh ~/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw

# Check largest directories
du -sh ~/Library/* | sort -hr | head -10
```

---

## 📚 Related Documentation

- **Full Cleanup Plan:** `STORAGE_CLEANUP_PLAN.md`
- **Data Recovery Status:** `DATA_RECOVERY_STATUS.md`
- **Safe Cleanup Script:** `scripts/quick-cleanup-safe.sh`
- **Postgres Review Script:** `scripts/cleanup-postgres-app-support.sh`

---

## 🎯 Quick Start (Copy & Paste)

```bash
# 1. Verify backups
cd /Users/tom/record-platform
ls -lh backups/*.sql

# 2. Run safe cleanup
./scripts/quick-cleanup-safe.sh

# 3. Compact Docker.raw
# (Open Docker Desktop → Settings → Resources → Advanced → Compact)

# 4. (Optional) Remove Cursor backup
rm ~/Library/Application\ Support/Cursor/User/globalStorage/state.vscdb.backup

# 5. Verify results
df -h .
```

---

**Priority:** 🔴 **URGENT** - Your system is at 100% capacity  
**Estimated Time:** 30-60 minutes total  
**Risk Level:** Low (all actions are safe with backups verified)
