# Storage Cleanup Plan

**Date:** January 8, 2025  
**Current Status:** ⚠️ **CRITICAL - 100% DISK FULL**  
**Free Space:** 1.3GB / 460GB (99.7% used)

---

## 🔴 Critical Situation

Your disk is **completely full** (only 1.3GB free out of 460GB). This can cause:
- System slowdowns
- Application crashes
- Inability to save files
- Docker/build failures

**Immediate Action Required**

---

## 📊 Storage Breakdown

### Top Consumers (Total: ~432GB used)

| Location | Size | % of Total | Priority |
|----------|------|------------|----------|
| **Library/Containers** | 195GB | 45% | 🔴 HIGH |
| **Library/Application Support** | 57GB | 13% | 🟡 MEDIUM |
| **Library/Caches** | 11GB | 3% | 🟢 LOW (safe) |
| **Library/Logs** | 1GB | <1% | 🟢 LOW (safe) |
| **record-platform/backups** | 3.8GB | 1% | 🟡 MEDIUM |
| **Other** | ~164GB | 38% | - |

---

## 🎯 Safe Cleanup Targets (Priority Order)

### 🔴 HIGH PRIORITY: Docker.raw (256GB)

**Location:** `~/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw`

**Status:** Contains your PostgreSQL data (we confirmed this earlier)

**Options:**
1. **Extract data first** (if not already done) - Use existing SQL backups or extract from Docker.raw
2. **Compact Docker.raw** - Use Docker Desktop's disk image compact feature
3. **Archive Docker.raw** - Move to external drive (after data extraction)
4. **Reset Docker** - Only after confirming data is safely backed up

**⚠️ WARNING:** Do NOT delete Docker.raw until PostgreSQL data is extracted!

**Action:**
```bash
# 1. Verify backups exist
ls -lh record-platform/backups/*.sql

# 2. Compact Docker Desktop (if using Docker Desktop)
# Open Docker Desktop → Settings → Resources → Advanced → Compact disk image

# 3. Or move to external drive (if you have one)
# mv ~/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw \
#    /Volumes/ExternalDrive/Docker.raw.backup
```

**Estimated Space Recovered:** 50-200GB (depending on actual usage vs allocated size)

---

### 🟡 MEDIUM PRIORITY: Library/Application Support (57GB)

**Breakdown:**
- **Postgres: 27GB** → `var-16` (Postgres 16 data directory)
- **Cursor: 18GB** → User folder (extensions, workspace data)
- **Other: 12GB** → Java, Code, Google, etc.

**Postgres var-16 (27GB):**
```bash
# Check what's in it
du -sh ~/Library/Application\ Support/Postgres/var-16/* | sort -hr

# ⚠️ IMPORTANT: Postgres 16 IS CURRENTLY RUNNING
# This directory contains active database files (26GB base + 800MB WAL)
# DO NOT DELETE - it's in active use
# If you want to free this space, you'd need to:
#   1. Stop Postgres 16 service
#   2. Confirm you're using Docker/Colima Postgres instead
#   3. Only then consider removing (after backups)
```

**Cursor User (17GB):**
```bash
# Check what's taking space
du -sh ~/Library/Application\ Support/Cursor/User/* | sort -hr

# Likely contains:
# - Extensions (can reinstall)
# - Workspace settings (usually small)
# - Old cache data
# - Large language models (if using AI features)
```

**Action:**
```bash
# See what's taking space
du -sh ~/Library/Application\ Support/* | sort -hr | head -20

# Review Postgres var-16 carefully before deleting
# Review Cursor User folder for old extensions/cache
```

**Estimated Space Recovered:** 20-35GB (if Postgres var-16 not needed)

---

### 🟢 LOW PRIORITY (SAFE): Library/Caches (11GB)

**These can be safely deleted** - macOS will regenerate as needed.

**Action:**
```bash
# Preview what will be deleted (DRY RUN)
du -sh ~/Library/Caches/* | sort -hr

# Clear caches (safe - apps will regenerate)
rm -rf ~/Library/Caches/*

# Or be selective:
# - Clear browser caches (keep bookmarks/history)
# - Clear app-specific caches you don't use
```

**Estimated Space Recovered:** 11GB (immediate)

---

### 🟢 LOW PRIORITY (SAFE): Library/Logs (1GB)

**These can be safely deleted** - logs will regenerate.

**Action:**
```bash
# Clear old logs
rm -rf ~/Library/Logs/*

# Or keep recent logs (last 7 days):
find ~/Library/Logs -type f -mtime +7 -delete
```

**Estimated Space Recovered:** 1GB (immediate)

---

### 🟡 MEDIUM PRIORITY: Project Backups (3.8GB)

**Location:** `record-platform/backups/`

**Action:**
```bash
# Check what's in backups
du -sh record-platform/backups/*

# Options:
# 1. Keep only the most recent backups
# 2. Compress old backups (gzip)
# 3. Move to external drive
# 4. Delete duplicates (if multiple backups of same database)

# Example: Keep only latest SQL backups
cd record-platform/backups
# Review and delete old/unnecessary backups manually
```

**Estimated Space Recovered:** 1-3GB

---

### 🟡 MEDIUM PRIORITY: Other Large Directories

**Desktop (3.8GB):**
```bash
# Check what's on desktop
du -sh ~/Desktop/* | sort -hr

# Move large files to external drive or archive
```

**Go packages (3.6GB):**
```bash
# Clean Go module cache
go clean -modcache

# Estimated recovery: 1-2GB
```

**Anaconda2 (1.9GB):**
```bash
# If not using, can remove
# conda clean --all

# Estimated recovery: 1.9GB
```

---

## 🚀 Recommended Action Plan

### Phase 1: Immediate (Quick Wins) - ~12GB

1. **Clear caches** (11GB) - SAFE
   ```bash
   rm -rf ~/Library/Caches/*
   ```

2. **Clear old logs** (1GB) - SAFE
   ```bash
   find ~/Library/Logs -type f -mtime +7 -delete
   ```

**Time:** 2 minutes  
**Risk:** None  
**Space Recovered:** ~12GB

---

### Phase 2: Docker Cleanup - 50-200GB

1. **Verify PostgreSQL backups exist**
   ```bash
   ls -lh record-platform/backups/*.sql
   # Should see 8 files, ~1.9GB total
   ```

2. **Compact Docker.raw** (if using Docker Desktop)
   - Open Docker Desktop
   - Settings → Resources → Advanced
   - Click "Compact disk image"
   - This can recover 50-200GB depending on actual usage

3. **OR Archive Docker.raw** (if you have external drive)
   - Extract PostgreSQL data first
   - Move Docker.raw to external drive
   - Free up 256GB

**Time:** 10-30 minutes  
**Risk:** Low (if backups verified)  
**Space Recovered:** 50-200GB

---

### Phase 3: Application Support Cleanup - 10-30GB

1. **Identify large apps**
   ```bash
   du -sh ~/Library/Application\ Support/* | sort -hr | head -20
   ```

2. **Clean specific items:**
   - Xcode DerivedData (if not using)
   - Old simulator data
   - Browser caches (keep profiles)

**Time:** 15-30 minutes  
**Risk:** Medium (review first)  
**Space Recovered:** 10-30GB

---

### Phase 4: Project Cleanup - 2-5GB

1. **Review project backups**
   - Keep only necessary backups
   - Compress old backups

2. **Clean development caches:**
   ```bash
   cd record-platform
   # Clean node_modules (if needed, can reinstall)
   # Clean build artifacts
   # Clean test results (if not needed)
   ```

**Time:** 10 minutes  
**Risk:** Low  
**Space Recovered:** 2-5GB

---

## ⚠️ DO NOT DELETE (Critical Files)

- `Docker.raw` - Contains PostgreSQL data (until extracted)
- `record-platform/backups/*.sql` - Your database backups
- Active project files in `record-platform/`
- Important documents

---

## 🔧 Quick Cleanup Script

A safe script that only clears caches and logs:

```bash
#!/bin/bash
# Safe cleanup - only caches and old logs

echo "Clearing caches (11GB)..."
rm -rf ~/Library/Caches/*

echo "Clearing logs older than 7 days (1GB)..."
find ~/Library/Logs -type f -mtime +7 -delete

echo "Done! Recovered ~12GB"
df -h . | tail -1
```

---

## 📋 Summary

**Current Free Space:** 1.3GB (CRITICAL)

**After Phase 1 (Safe Cleanup):** ~13GB free  
**After Phase 2 (Docker Cleanup):** ~63-213GB free  
**After Phase 3 (App Support):** ~73-243GB free  
**After Phase 4 (Project):** ~75-248GB free

**Recommended Target:** 50-100GB free space for healthy system operation

---

## ✅ Verification

After cleanup, verify:
```bash
# Check free space
df -h .

# Check largest directories
du -sh ~/Library/* | sort -hr | head -10
```

---

**Next Steps:**
1. Start with Phase 1 (caches/logs) - immediate 12GB
2. Verify PostgreSQL backups
3. Compact/move Docker.raw - biggest impact
4. Clean Application Support selectively
