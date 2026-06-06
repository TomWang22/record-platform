#!/usr/bin/env bash
# Extract PostgreSQL data directly from Docker.raw disk image
# This is useful when Docker Compose containers are not accessible
# but the Docker.raw file still contains the volume data

set -euo pipefail

# Configuration
DOCKER_RAW_PATH="${DOCKER_RAW_PATH:-$HOME/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw}"
BACKUP_DIR="${BACKUP_DIR:-./backups/extracted-from-docker-raw-$(date +%Y%m%d-%H%M%S)}"
MOUNT_POINT="${MOUNT_POINT:-/tmp/docker-raw-mount}"

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
  
  if [[ ! -f "$DOCKER_RAW_PATH" ]]; then
    error "Docker.raw file not found at: $DOCKER_RAW_PATH"
    error "Please set DOCKER_RAW_PATH environment variable to the correct path"
    exit 1
  fi
  
  if ! command -v hdiutil &> /dev/null; then
    error "hdiutil is required (macOS only). This script works on macOS."
    exit 1
  fi
  
  # Check if already mounted
  if mount | grep -q "$MOUNT_POINT"; then
    warning "Docker.raw already mounted at $MOUNT_POINT"
    info "Will attempt to unmount first..."
    hdiutil detach "$MOUNT_POINT" 2>/dev/null || true
  fi
  
  success "Prerequisites check passed"
}

# Mount Docker.raw using a Linux container
mount_docker_raw() {
  info "Mounting Docker.raw using Linux container (supports ext4 filesystem)..."
  
  mkdir -p "$MOUNT_POINT"
  
  # Check if we can use Colima or any Docker runtime
  if ! command -v docker &> /dev/null; then
    error "Docker is not available. Need Docker or Colima to mount Docker.raw"
    return 1
  fi
  
  if ! docker info >/dev/null 2>&1; then
    error "Docker daemon is not running"
    error "Please start Docker Desktop or Colima"
    return 1
  fi
  
  # Check if Docker.raw is in use
  if lsof "$DOCKER_RAW_PATH" 2>/dev/null | grep -q .; then
    warning "Docker.raw appears to be in use by another process"
    warning "Please ensure Docker Desktop is fully quit:"
    warning "  osascript -e 'quit app \"Docker\"'"
    warning "  # Wait a few seconds, then kill any remaining processes:"
    warning "  pkill -f 'Docker' || true"
    return 1
  fi
  
  # Use a Linux container with ext4 support to mount the raw disk image
  # We'll use a container with the raw image mounted, then use losetup and mount
  info "Using Linux container to access Docker.raw (ext4 filesystem)..."
  
  # Create a temporary container that can mount the raw image
  local temp_container="docker-raw-extractor-$(date +%s)"
  
  # Mount Docker.raw into container and use losetup to create loop device
  # Then mount the partition
  if docker run --rm --privileged \
    --name "$temp_container" \
    -v "$DOCKER_RAW_PATH:/docker.raw:ro" \
    -v "$(pwd)/${BACKUP_DIR}:/backup" \
    alpine:latest \
    sh -c "
      apk add --no-cache util-linux e2fsprogs >/dev/null 2>&1
      # Create loop device
      losetup -P /dev/loop0 /docker.raw 2>/dev/null || true
      # Mount the first partition (usually contains the filesystem)
      mkdir -p /mnt/docker-raw
      mount -o ro /dev/loop0p1 /mnt/docker-raw 2>/dev/null || mount -o ro /dev/loop0 /mnt/docker-raw 2>/dev/null || {
        echo 'Failed to mount partition' >&2
        exit 1
      }
      # Check if mounted successfully
      if [ -d /mnt/docker-raw/var/lib/docker ]; then
        echo 'Mounted successfully'
        ls -la /mnt/docker-raw/var/lib/docker/volumes 2>/dev/null | head -5
      else
        echo 'Mounted but Docker volumes directory not found' >&2
        exit 1
      fi
    " 2>&1 | tee "${BACKUP_DIR}/mount-log.txt"; then
    
    success "Docker.raw mounted successfully in container"
    MOUNT_CONTAINER="$temp_container"
    return 0
  else
    error "Failed to mount Docker.raw using container method"
    warning "Check ${BACKUP_DIR}/mount-log.txt for details"
    return 1
  fi
}

# Find PostgreSQL data directories in mounted volume (using container)
find_postgres_data_dirs() {
  info "Searching for PostgreSQL data directories in Docker.raw..."
  
  # Try to find volumes dynamically, but also have a fallback list
  local volumes_output
  volumes_output=$(docker run --rm --privileged \
    -v "$DOCKER_RAW_PATH:/docker.raw:ro" \
    alpine:latest \
    sh -c "
      apk add --no-cache util-linux e2fsprogs >/dev/null 2>&1
      losetup -P /dev/loop0 /docker.raw 2>/dev/null || true
      sleep 1
      mkdir -p /mnt/docker-raw
      mount -o ro,noload /dev/loop0p1 /mnt/docker-raw 2>/dev/null || exit 1
      find /mnt/docker-raw/docker/volumes -maxdepth 1 -type d -name '*pgdata*' 2>/dev/null
      umount /mnt/docker-raw 2>/dev/null || true
      losetup -d /dev/loop0 2>/dev/null || true
    " 2>&1 | grep pgdata || true)
  
  # Parse volume paths - extract just the volume name
  local volumes=()
  if [[ -n "$volumes_output" ]]; then
    volumes=($(echo "$volumes_output" | sed 's|.*/volumes/||' | sed 's|/_data.*||' | grep -v '^$' | sort -u))
  fi
  
  # Fallback: Use known volume names if dynamic search failed
  if [[ ${#volumes[@]} -eq 0 ]]; then
    warning "Dynamic volume search failed, using known volume list"
    volumes=(
      "record-platform_pgdata"
      "record-platform_pgdata-auth"
      "record-platform_pgdata-social"
      "record-platform_pgdata-listings"
      "record-platform_pgdata-shopping"
      "record-platform_pgdata-auction-monitor"
      "record-platform_pgdata-analytics"
      "record-platform_pgdata-python-ai"
    )
  fi
  
  if [[ ${#volumes[@]} -eq 0 ]]; then
    error "No PostgreSQL volumes found"
    return 1
  fi
  
  info "Found ${#volumes[@]} PostgreSQL volume directories:"
  for vol in "${volumes[@]}"; do
    echo "  - $vol" >&2  # Output to stderr so it's not captured
  done
  
  # Output volumes to stdout (one per line) for array capture
  printf '%s\n' "${volumes[@]}"
  return 0
}

# Extract PostgreSQL data from Docker.raw using container
extract_postgres_data() {
  local volume_name=$1
  
  info "Extracting PostgreSQL data from $volume_name..."
  
  local output_dir="${BACKUP_DIR}/${volume_name}"
  mkdir -p "$output_dir"
  
  # Use container to mount Docker.raw and copy volume data
  if docker run --rm --privileged \
    -v "$DOCKER_RAW_PATH:/docker.raw:ro" \
    -v "$(pwd)/${output_dir}:/backup" \
    alpine:latest \
    sh -c "
      apk add --no-cache util-linux e2fsprogs >/dev/null 2>&1
      losetup -P /dev/loop0 /docker.raw 2>/dev/null || true
      mkdir -p /mnt/docker-raw
      mount -o ro /dev/loop0p1 /mnt/docker-raw 2>/dev/null || mount -o ro /dev/loop0 /mnt/docker-raw 2>/dev/null || exit 1
      
      # Find and copy volume data - try multiple possible paths
      vol_path=\"\"
      if [ -d \"/mnt/docker-raw/docker/volumes/${volume_name}/_data\" ]; then
        vol_path=\"/mnt/docker-raw/docker/volumes/${volume_name}/_data\"
      elif [ -d \"/mnt/docker-raw/var/lib/docker/volumes/${volume_name}/_data\" ]; then
        vol_path=\"/mnt/docker-raw/var/lib/docker/volumes/${volume_name}/_data\"
      else
        echo \"Volume path not found for ${volume_name}\" >&2
        exit 1
      fi
      
      if [ -n \"\$vol_path\" ] && [ -d \"\$vol_path\" ]; then
        cp -r \"\$vol_path\"/* /backup/ 2>/dev/null || true
        echo 'Copied successfully'
      else
        echo \"Volume path not found: \$vol_path\" >&2
        exit 1
      fi
      
      umount /mnt/docker-raw 2>/dev/null || true
    " >"${output_dir}.log" 2>&1; then
    
    # Check if we got data
    if [[ -n "$(ls -A "$output_dir" 2>/dev/null)" ]]; then
      local size=$(du -sh "$output_dir" 2>/dev/null | cut -f1 || echo "unknown")
      success "Extracted $volume_name to $output_dir (${size})"
      return 0
    else
      warning "Volume $volume_name appears to be empty"
      return 1
    fi
  else
    error "Failed to extract $volume_name (check ${output_dir}.log)"
    return 1
  fi
}

# Alternative: Extract using pg_dump if PostgreSQL binaries are available in the mounted image
extract_with_pg_dump() {
  warning "Direct pg_dump from mounted volume is not implemented"
  warning "Use the extract-postgres-databases.sh script instead with running containers"
  return 1
}

# Main execution
main() {
  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "  PostgreSQL Data Extraction from Docker.raw"
  echo "═══════════════════════════════════════════════════════════"
  echo ""
  echo "⚠️  WARNING: This method extracts raw PostgreSQL data files"
  echo "   To restore, you need to copy these files to a PostgreSQL"
  echo "   data directory and start PostgreSQL with them."
  echo ""
  echo "   For SQL dumps (recommended), use:"
  echo "   ./scripts/extract-postgres-databases.sh"
  echo ""
  
  read -p "Continue with raw data extraction? (yes/no): " confirm
  if [[ "$confirm" != "yes" ]]; then
    info "Extraction cancelled"
    exit 0
  fi
  
  info ""
  info "Note: Docker.raw contains a Linux ext4 filesystem"
  info "Direct mounting on macOS is complex. This script will attempt"
  info "to mount it, but if it fails, consider these alternatives:"
  info "  1. Use extract-postgres-databases.sh with Docker Desktop running"
  info "  2. Restore from existing backups in ./backups/"
  info "  3. Use a Linux VM to mount Docker.raw"
  info ""
  
  check_prerequisites
  
  # Create backup directory
  mkdir -p "$BACKUP_DIR"
  info "Backup directory: $BACKUP_DIR"
  
  # Note: We don't need to mount globally - we'll use containers for each operation
  info "Using container-based extraction (no global mount needed)"
  
  # Find PostgreSQL volumes
  info "Scanning Docker.raw for PostgreSQL volumes..."
  local volumes_raw volumes=()
  
  # Capture both return code and output
  volumes_raw=$(find_postgres_data_dirs 2>&1)
  local find_status=$?
  
  if [[ $find_status -ne 0 ]]; then
    error "Could not find PostgreSQL volumes in Docker.raw"
    warning "Docker.raw might be from a different Docker setup"
    warning "Or volumes might be stored differently"
    exit 1
  fi
  
  # Extract volume names (filter out info messages and empty lines)
  readarray -t volumes < <(echo "$volumes_raw" | grep -E "^record-platform_pgdata" | sort -u)
  
  # Fallback if readarray failed
  if [[ ${#volumes[@]} -eq 0 ]]; then
    volumes=($(echo "$volumes_raw" | grep -E "^record-platform_pgdata" | sort -u))
  fi
  
  # Extract each volume
  local success_count=0
  local fail_count=0
  
  echo ""
  info "Starting extraction from Docker.raw..."
  info "This will use Linux containers to read the ext4 filesystem"
  echo ""
  
  for vol in "${volumes[@]}"; do
    if extract_postgres_data "$vol"; then
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
  
  success "Extraction complete! Remember to use extract-postgres-databases.sh"
  success "for SQL dumps which are easier to restore."
}

# Run main function
main
