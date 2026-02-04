# Docker.raw Removal Plan - Database Backup First

**Date**: January 8, 2026  
**Status**: Preparing to remove Docker Desktop Docker.raw (256GB) after backing up all databases

## Prerequisites

### ✅ Must Complete Before Removing Docker.raw

1. **All 8 databases running and accessible**
2. **Backups created for all 8 databases**
3. **Backup integrity verified**
4. **Database connection tests passed**

## Databases to Backup

1. **postgres** (main/records database) - Port 5433
2. **postgres-auth** - Port 5437
3. **postgres-social** - Port 5434
4. **postgres-listings** - Port 5435
5. **postgres-shopping** - Port 5436
6. **postgres-analytics** - Port 5439
7. **postgres-auction-monitor** - Port 5438
8. **postgres-python-ai** - Port 5440

## Backup Process

### Step 1: Verify Databases Are Running
```bash
docker compose ps | grep postgres
# Should show all 8 databases running
```

### Step 2: Verify Data Exists
```bash
# Check main records database
docker compose exec -T postgres psql -U postgres -d records -tAc 'SELECT COUNT(*) FROM records.records;'

# Check other databases have tables
for db in auth social listings shopping analytics auction-monitor python-ai; do
  docker compose exec -T postgres-${db} psql -U postgres -d records -tAc 'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '\''public'\'';'
done
```

### Step 3: Create Backups
```bash
BACKUP_DIR="backups/pre-docker-raw-removal-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# Backup all 8 databases
for db in postgres postgres-auth postgres-social postgres-listings \
          postgres-shopping postgres-analytics postgres-auction-monitor \
          postgres-python-ai; do
  db_name=$(echo $db | sed 's/postgres-//' | sed 's/postgres/records/')
  echo "Backing up ${db} (database: ${db_name})..."
  docker compose exec -T $db pg_dump -U postgres -d $db_name > "$BACKUP_DIR/${db_name}-all.sql"
done
```

### Step 4: Verify Backup Integrity
```bash
# Check backup file sizes (should be > 1KB each)
ls -lh "$BACKUP_DIR"

# Verify backups contain data
for backup in "$BACKUP_DIR"/*.sql; do
  size=$(stat -f%z "$backup" 2>/dev/null || stat -c%s "$backup" 2>/dev/null)
  if [ "$size" -gt 1000 ]; then
    echo "✅ $(basename $backup): Valid ($size bytes)"
  else
    echo "⚠️ $(basename $backup): Too small ($size bytes)"
  fi
done
```

### Step 5: Test Database Connectivity
```bash
# Verify all databases are accessible
for db in postgres postgres-auth postgres-social postgres-listings \
          postgres-shopping postgres-analytics postgres-auction-monitor \
          postgres-python-ai; do
  db_name=$(echo $db | sed 's/postgres-//' | sed 's/postgres/records/')
  docker compose exec -T $db psql -U postgres -d $db_name -c 'SELECT 1;' >/dev/null 2>&1
  if [ $? -eq 0 ]; then
    echo "✅ ${db} (${db_name}) - accessible"
  else
    echo "⚠️ ${db} (${db_name}) - connection failed"
  fi
done
```

## After Backups Are Verified

### Safe to Remove Docker.raw

**Only proceed if**:
- ✅ All 8 databases have backups created
- ✅ All backup files are > 1KB (contain data)
- ✅ All databases are accessible

**Remove Docker.raw**:
```bash
# Remove Docker Desktop Docker.raw (256GB)
rm ~/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw

# Verify it's removed
ls -lh ~/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw
# Should show: No such file or directory
```

**Verify disk space freed**:
```bash
df -h / | tail -1
# Should show more free space (256GB freed)
```

## Important Notes

1. **Docker Compose databases are NOT affected**: The databases run via Docker Compose, not Docker Desktop, so removing Docker.raw won't affect them.

2. **Backups are insurance**: Even though databases are safe, backups ensure we can restore if anything goes wrong.

3. **Docker Desktop won't work**: After removing Docker.raw, Docker Desktop won't work until it recreates the file. But we're using Colima, so this is fine.

4. **Data preservation**: All database data is in Docker Compose volumes, not in Docker.raw.

## Recovery Plan (If Needed)

If something goes wrong:

1. **Restore from backups**:
   ```bash
   BACKUP_DIR="backups/pre-docker-raw-removal-YYYYMMDD-HHMMSS"
   
   for backup in "$BACKUP_DIR"/*.sql; do
     db_name=$(basename $backup | sed 's/-all.sql//')
     # Restore logic here
   done
   ```

2. **Docker Desktop recovery**: If you need Docker Desktop again, it will recreate Docker.raw on next startup (but will be empty).

## Verification Checklist

Before removing Docker.raw:
- [ ] All 8 databases running: `docker compose ps | grep postgres`
- [ ] Main database has data: `SELECT COUNT(*) FROM records.records;` > 0
- [ ] All 8 backups created: `ls backups/pre-docker-raw-removal-*/`
- [ ] All backups > 1KB: Verified file sizes
- [ ] All databases accessible: Connection tests passed
- [ ] Backup directory documented: Location saved

After removing Docker.raw:
- [ ] Docker.raw removed: `ls Docker.raw` fails
- [ ] Disk space freed: `df -h /` shows more free space
- [ ] Databases still running: `docker compose ps | grep postgres`
- [ ] Data still accessible: `SELECT COUNT(*) FROM records.records;` works

---

**Last Updated**: January 8, 2026  
**Author**: Tom
