#!/usr/bin/env bash
# Restore PostgreSQL databases from SQL dumps
# Supports both compressed (.sql.gz) and uncompressed (.sql) files

set -euo pipefail

# Configuration
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RESTORE_MODE="${RESTORE_MODE:-schema}"  # "schema" or "full"
FORCE="${FORCE:-false}"  # Set to "true" to skip confirmation prompts

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
info() { echo -e "${BLUE}ℹ${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warning() { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; }

# Database configuration: (service_name, port, database_name, schema_name)
declare -a DATABASES=(
  "postgres:5433:postgres:records"
  "postgres-auth:5437:postgres:auth"
  "postgres-social:5434:postgres:social"
  "postgres-listings:5435:postgres:listings"
  "postgres-shopping:5436:postgres:shopping"
  "postgres-auction-monitor:5438:postgres:auction_monitor"
  "postgres-analytics:5439:postgres:analytics"
  "postgres-python-ai:5440:postgres:python_ai"
)

# Determine compose command (nerdctl for Colima, docker for Docker Desktop)
COMPOSE_CMD="${COMPOSE_CMD:-}"
if [[ -z "$COMPOSE_CMD" ]]; then
  if command -v colima &> /dev/null && colima status &>/dev/null; then
    COMPOSE_CMD="colima nerdctl -- compose"
    info "Using Colima nerdctl for Docker Compose"
  elif command -v docker &> /dev/null; then
    COMPOSE_CMD="docker compose"
    info "Using Docker Compose"
  else
    error "Neither Colima nor Docker found. Please install one of them."
    exit 1
  fi
fi

# Check prerequisites
check_prerequisites() {
  info "Checking prerequisites..."
  
  if ! $COMPOSE_CMD ps postgres >/dev/null 2>&1; then
    error "Docker Compose is not running. Please start it with: $COMPOSE_CMD up -d"
    exit 1
  fi
  
  if [[ ! -d "$BACKUP_DIR" ]]; then
    error "Backup directory does not exist: $BACKUP_DIR"
    exit 1
  fi
  
  success "Prerequisites check passed"
}

# Find backup file for a database
find_backup_file() {
  local service_name=$1
  local schema_name=$2
  
  # Backup files follow pattern: record-platform-<service-name>-1-all-<timestamp>.sql
  # Examples:
  # - record-platform-postgres-1-all-20260101-223214.sql (for postgres/records)
  # - record-platform-postgres-auth-1-all-20260101-223214.sql (for postgres-auth/auth)
  
  # Look for files matching: record-platform-<service-name>-1-all-*.sql
  local full_file=$(find "$BACKUP_DIR" -name "record-platform-${service_name}-1-all-*.sql" -type f | sort -r | head -1)
  
  if [[ -n "$full_file" ]]; then
    echo "$full_file"
    return 0
  fi
  
  # Fallback: try without "record-platform-" prefix
  full_file=$(find "$BACKUP_DIR" -name "*${service_name}*-all-*.sql" -type f | sort -r | head -1)
  if [[ -n "$full_file" ]]; then
    echo "$full_file"
    return 0
  fi
  
  return 1
}

# Restore database
restore_database() {
  local service_name=$1
  local port=$2
  local db_name=$3
  local schema_name=$4
  local backup_file=$5
  
  info "Restoring ${service_name} (${schema_name} schema) from ${backup_file}..."
  
  # Check if container is healthy
  if ! $COMPOSE_CMD ps "$service_name" | grep -q "healthy\|running"; then
    error "Container ${service_name} is not healthy/running. Skipping..."
    return 1
  fi
  
  # Determine if file is compressed
  local decompress_cmd="cat"
  if [[ "$backup_file" == *.gz ]]; then
    decompress_cmd="gunzip -c"
    info "File is compressed, will decompress during restore"
  fi
  
  # Restore the database
  # Note: For schema-only restores, we restore into the existing database
  # For full database restores, pg_restore or psql with CREATE DATABASE is used
  
  if [[ "$RESTORE_MODE" == "full" ]] && grep -q "CREATE DATABASE" <($decompress_cmd "$backup_file" 2>/dev/null | head -20); then
    # Full database restore (includes CREATE DATABASE)
    info "Performing full database restore (will drop and recreate database if needed)..."
    warning "This will destroy existing data in ${db_name}!"
    
    if [[ "$FORCE" != "true" ]]; then
      read -p "Continue? (yes/no): " confirm
      if [[ "$confirm" != "yes" ]]; then
        warning "Restore cancelled by user"
        return 1
      fi
    fi
    
    if $decompress_cmd "$backup_file" | $COMPOSE_CMD exec -T "$service_name" psql -U postgres >"${backup_file}.restore.log" 2>&1; then
      success "Full database restored successfully"
      return 0
    else
      error "Failed to restore full database. Check ${backup_file}.restore.log for details"
      return 1
    fi
  else
    # Schema-only restore
    info "Performing schema restore into existing database..."
    
    # Create schema if it doesn't exist
    $COMPOSE_CMD exec -T "$service_name" psql -U postgres -d "$db_name" -c "CREATE SCHEMA IF NOT EXISTS ${schema_name};" >/dev/null 2>&1 || true
    
    # Filter out CREATE DATABASE, ALTER DATABASE, and \connect commands
    # Backup files may contain these commands but we're restoring into existing postgres database
    # Also filter out database-level settings (ALTER DATABASE) that don't apply to schema restores
    info "Filtering backup file to remove CREATE DATABASE, ALTER DATABASE, and \\connect commands..."
    
    # Restore into the database with filtered SQL
    # Use grep -v to exclude lines, but preserve COPY and INSERT statements
    if $decompress_cmd "$backup_file" | \
      grep -v "^CREATE DATABASE" | \
      grep -v "^ALTER DATABASE" | \
      grep -v "^\\\\connect" | \
      grep -v "^-- Database \".*\" dump" | \
      $COMPOSE_CMD exec -T "$service_name" psql -U postgres -d "$db_name" >"${backup_file}.restore.log" 2>&1; then
      success "Schema restored successfully"
      return 0
    else
      error "Failed to restore schema. Check ${backup_file}.restore.log for details"
      # Show last 20 lines of log for debugging
      if [[ -f "${backup_file}.restore.log" ]]; then
        echo ""
        warning "Last 20 lines of restore log:"
        tail -20 "${backup_file}.restore.log"
        echo ""
      fi
      return 1
    fi
  fi
}

# Main execution
main() {
  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "  PostgreSQL Database Restore Script"
  echo "═══════════════════════════════════════════════════════════"
  echo ""
  
  check_prerequisites
  
  echo ""
  info "Looking for backup files in: ${BACKUP_DIR}"
  echo ""
  
  local success_count=0
  local fail_count=0
  local skip_count=0
  
  # Restore each database
  for db_config in "${DATABASES[@]}"; do
    IFS=':' read -r service_name port db_name schema_name <<< "$db_config"
    
    # Find backup file
    if backup_file=$(find_backup_file "$service_name" "$schema_name"); then
      info "Found backup file: $(basename "$backup_file")"
      
      if restore_database "$service_name" "$port" "$db_name" "$schema_name" "$backup_file"; then
        ((success_count++))
      else
        ((fail_count++))
      fi
    else
      warning "No backup file found for ${service_name} (${schema_name}). Skipping..."
      ((skip_count++))
    fi
    echo ""
  done
  
  # Summary
  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "  Restore Summary"
  echo "═══════════════════════════════════════════════════════════"
  echo ""
  success "Successfully restored: ${success_count} databases"
  if [[ $fail_count -gt 0 ]]; then
    error "Failed to restore: ${fail_count} databases"
  fi
  if [[ $skip_count -gt 0 ]]; then
    warning "Skipped (no backup found): ${skip_count} databases"
  fi
  echo ""
  
  if [[ $fail_count -eq 0 && $success_count -gt 0 ]]; then
    success "All available databases restored successfully! ✓"
    exit 0
  elif [[ $fail_count -gt 0 ]]; then
    error "Some databases failed to restore. Please check the logs."
    exit 1
  else
    warning "No databases were restored."
    exit 0
  fi
}

# Run main function
main
