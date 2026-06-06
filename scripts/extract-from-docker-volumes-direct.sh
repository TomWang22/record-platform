#!/usr/bin/env bash
# Extract PostgreSQL data by directly accessing Docker volume files
# This works when Docker Desktop is running and volumes are accessible
# Alternative to Docker.raw extraction when Docker is running

set -euo pipefail

# Configuration
BACKUP_DIR="${BACKUP_DIR:-./backups/extracted-volumes-direct-$(date +%Y%m%d-%H%M%S)}"
DOCKER_VOLUME_PREFIX="${DOCKER_VOLUME_PREFIX:-record-platform_}"

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

# Check prerequisites
check_prerequisites() {
  info "Checking prerequisites..."
  
  if ! command -v docker &> /dev/null; then
    error "Docker is not installed or not in PATH"
    exit 1
  fi
  
  if ! docker info >/dev/null 2>&1; then
    error "Docker daemon is not running"
    error "Please start Docker Desktop"
    exit 1
  fi
  
  success "Prerequisites check passed"
}

# Find PostgreSQL volumes
find_postgres_volumes() {
  info "Finding PostgreSQL volumes..."
  
  local volumes=($(docker volume ls --format "{{.Name}}" | grep -E "^${DOCKER_VOLUME_PREFIX}pgdata"))
  
  if [[ ${#volumes[@]} -eq 0 ]]; then
    warning "No PostgreSQL volumes found with prefix: ${DOCKER_VOLUME_PREFIX}pgdata"
    info "Available volumes:"
    docker volume ls | head -20
    return 1
  fi
  
  info "Found ${#volumes[@]} PostgreSQL volumes:"
  for vol in "${volumes[@]}"; do
    echo "  - $vol"
  done
  
  echo "${volumes[@]}"
  return 0
}

# Extract volume data using a temporary container
extract_volume_data() {
  local volume_name=$1
  
  info "Extracting data from volume: $volume_name"
  
  local output_dir="${BACKUP_DIR}/${volume_name}"
  mkdir -p "$output_dir"
  
  # Use a temporary container to copy volume data
  # Mount the volume read-only and copy all files
  local temp_container="temp-extract-$(date +%s)"
  
  if docker run --rm \
    --name "$temp_container" \
    -v "${volume_name}:/source:ro" \
    -v "$(pwd)/${output_dir}:/dest" \
    alpine:latest \
    sh -c "cp -r /source/_data/* /dest/ 2>/dev/null || cp -r /source/* /dest/ 2>/dev/null || true" 2>/dev/null; then
    
    # Check if we got any data
    if [[ -n "$(ls -A "$output_dir" 2>/dev/null)" ]]; then
      local size=$(du -sh "$output_dir" 2>/dev/null | cut -f1 || echo "unknown")
      success "Extracted $volume_name to $output_dir (${size})"
      return 0
    else
      warning "Volume $volume_name appears to be empty or inaccessible"
      return 1
    fi
  else
    error "Failed to extract data from $volume_name"
    return 1
  fi
}

# Extract using pg_dump (preferred method)
extract_using_pg_dump() {
  info ""
  info "⚠️  RECOMMENDED: Use extract-postgres-databases.sh instead!"
  info "   This extracts raw PostgreSQL data files (not SQL dumps)"
  info "   For SQL dumps, use: ./scripts/extract-postgres-databases.sh"
  info ""
  
  read -p "Continue with raw file extraction? (yes/no): " confirm
  if [[ "$confirm" != "yes" ]]; then
    info "Extraction cancelled - use extract-postgres-databases.sh for SQL dumps"
    exit 0
  fi
}

# Main execution
main() {
  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "  PostgreSQL Volume Data Extraction (Direct)"
  echo "═══════════════════════════════════════════════════════════"
  echo ""
  
  check_prerequisites
  
  # Warn about using SQL dump method instead
  extract_using_pg_dump
  
  # Create backup directory
  mkdir -p "$BACKUP_DIR"
  info "Backup directory: $BACKUP_DIR"
  
  # Find PostgreSQL volumes
  local volumes
  if ! volumes=($(find_postgres_volumes)); then
    error "Could not find PostgreSQL volumes"
    exit 1
  fi
  
  # Extract each volume
  local success_count=0
  local fail_count=0
  
  echo ""
  info "Starting extraction..."
  echo ""
  
  for vol in "${volumes[@]}"; do
    if extract_volume_data "$vol"; then
      ((success_count++))
    else
      ((fail_count++))
    fi
    echo ""
  done
  
  # Summary
  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "  Extraction Summary"
  echo "═══════════════════════════════════════════════════════════"
  echo ""
  success "Successfully extracted: ${success_count} volumes"
  if [[ $fail_count -gt 0 ]]; then
    error "Failed to extract: ${fail_count} volumes"
  fi
  echo ""
  info "Backup directory: ${BACKUP_DIR}"
  echo ""
  warning "These are raw PostgreSQL data files"
  info "For SQL dumps (recommended), use: ./scripts/extract-postgres-databases.sh"
}

# Run main function
main
