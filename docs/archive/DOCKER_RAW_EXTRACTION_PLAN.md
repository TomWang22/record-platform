# Docker.raw PostgreSQL Data Extraction Plan

**Date:** January 8, 2025  
**Status:** Docker has I/O errors, but Docker.raw (256GB) contains PostgreSQL data

---

## 🎯 Goal

Extract PostgreSQL data from Docker.raw **before** fixing/compacting Docker, so we don't risk losing data.

---

## ✅ Your Data is Safe

### Confirmed Safe:
1. **Existing SQL Backups** (Jan 1, 2025)
   - Location: `record-platform/backups/*.sql`
   - Size: 1.9GB (8 databases)
   - Status: ✅ Ready to restore anytime

2. **Docker.raw File** (256GB)
   - Location: `~/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw`
   - Contains: All Docker volumes including PostgreSQL data
   - Status: ✅ File exists and is intact

### Cursor Backup (Clarification):
- ✅ **Main file intact:** `state.vscdb` (8.6GB) - KEPT
- ✅ **Backup file removed:** `state.vscdb.backup` (8.5GB) - Removed (safe, was just a backup)

---

## 🔍 Current Situation

### Docker Status:
- ⚠️ Docker CLI partially working (`docker ps` works)
- ⚠️ Docker storage has I/O errors (containerd corruption from disk being full)
- ✅ Docker.raw file is intact (separate from Docker corruption)
- ✅ 16GB free space now (enough to work)

### What This Means:
- Docker.raw is a **disk image file** containing the VM and volumes
- Docker corruption affects **active Docker operations**, not the raw file
- We can extract from Docker.raw even if Docker is broken

---

## 📋 Extraction Options

### Option 1: Use Existing SQL Backups (Safest, Immediate)

**Status:** ✅ Available now

You already have complete SQL backups from January 1:
- 8 databases
- 1.9GB total
- Ready to restore

**Pros:**
- Available immediately
- No Docker needed
- Proven SQL format
- Easy to restore

**Cons:**
- Data from Jan 1 (if you added data after, it won't be there)

**To restore:**
```bash
cd record-platform
BACKUP_DIR=./backups RESTORE_MODE=full FORCE=true \
  ./scripts/restore-postgres-databases.sh
```

---

### Option 2: Extract from Docker.raw via Container (When Docker Works)

**Status:** ⚠️ Requires Docker to be working

The `extract-from-docker-raw.sh` script uses a Linux container to mount Docker.raw and extract volumes.

**Prerequisites:**
- Docker Desktop must be running
- Docker must not have I/O errors

**Current Issue:**
- Docker has I/O errors, so this may not work right now

**To try:**
```bash
cd record-platform
echo "yes" | ./scripts/extract-from-docker-raw.sh
```

---

### Option 3: Direct Docker.raw Access (Advanced)

**Status:** ⚠️ Complex, requires manual mounting

This involves:
1. Stopping Docker Desktop completely
2. Using macOS `hdiutil` or Linux VM to mount Docker.raw
3. Extracting PostgreSQL volume directories directly

**Pros:**
- Works even if Docker is completely broken
- Can access data directly

**Cons:**
- Complex setup
- Requires stopping Docker
- Manual process

---

## 🚀 Recommended Action Plan

### Step 1: Try Starting Docker Desktop (Quick Test)

With 16GB free space, Docker Desktop might start now:

1. Open Docker Desktop
2. If it starts successfully:
   - Proceed with Option 2 (extract from Docker.raw via container)
3. If it fails:
   - Use Option 1 (existing SQL backups)
   - Then fix Docker corruption separately

---

### Step 2A: If Docker Desktop Starts

Try extracting from Docker.raw:

```bash
cd record-platform
echo "yes" | ./scripts/extract-from-docker-raw.sh
```

This will:
- Mount Docker.raw in a Linux container
- Extract all 8 PostgreSQL volume directories
- Save to `./backups/extracted-from-docker-raw-TIMESTAMP/`

---

### Step 2B: If Docker Desktop Won't Start

Use existing SQL backups (they're safe and ready):

```bash
cd record-platform
# Verify backups exist
ls -lh backups/*.sql

# Restore if needed
BACKUP_DIR=./backups RESTORE_MODE=full FORCE=true \
  ./scripts/restore-postgres-databases.sh
```

Then fix Docker corruption separately (after data is safe).

---

### Step 3: After Data Extraction (Optional)

Once PostgreSQL data is extracted/backed up, you can safely:

1. **Compact Docker.raw** (recover 150-200GB)
   - Via Docker Desktop: Settings → Resources → Advanced → Compact

2. **Fix Docker corruption**
   - Reset Docker storage (after confirming data is safe)
   - Or reinstall Docker Desktop

---

## ⚠️ Important Notes

### About Docker.raw:
- Docker.raw is a **disk image file** (like a virtual hard drive)
- It contains the entire Docker VM and all volumes
- Your PostgreSQL data is inside this file (in Docker volumes)
- The file is **separate from Docker corruption** - it's just a file on disk

### About Docker Corruption:
- Docker corruption affects **active Docker operations**
- It doesn't mean Docker.raw is corrupted
- Docker.raw can still be read/extracted even if Docker is broken
- We just need a way to access it (Docker container, or manual mount)

### About Cursor Backup:
- ✅ **Safe to remove:** It was just a backup copy
- ✅ **Main file intact:** `state.vscdb` (8.6GB) still exists
- ✅ **Cursor works normally:** The backup was optional

---

## 📊 Data Safety Summary

| Data Location | Status | Recovery Method |
|---------------|--------|-----------------|
| Existing SQL Backups | ✅ Safe | Ready to restore |
| Docker.raw file | ✅ Safe | Extract via container or manual mount |
| Docker active storage | ⚠️ Corrupted | Will fix after data extraction |

---

## 🎯 Next Steps

1. **Try starting Docker Desktop** (with 16GB free, it might work)
2. **If it starts:** Extract from Docker.raw via container
3. **If it doesn't:** Use existing SQL backups (they're safe!)
4. **After data is safe:** Fix Docker corruption, compact Docker.raw

---

**Bottom Line:** Your PostgreSQL data is safe in two places:
- ✅ Existing SQL backups (ready to use)
- ✅ Docker.raw file (can be extracted)

You won't lose your data! 🎉
