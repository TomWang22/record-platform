#!/usr/bin/env bash
# Extract all PostgreSQL databases from Docker volumes
# Creates SQL dumps for all 8 databases with schema and data

set -euo pipefail

# Configuration
BACKUP_DIR="${BACKUP_DIR:-./backups/extracted-$(date +%Y%m%d-%H%M%S)}"
COMPRESS="${COMPRESS:-true}"  # Set to "false" to disable gzip compression
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

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
# Note: Most databases use "public" schema, only postgres-auth has "auth" schema
# We'll try schema extraction first, then fallback to full database dump
declare -a DATABASES=(
  "postgres:5433:postgres:public"
  "postgres-auth:5437:postgres:auth"
  "postgres-social:5434:postgres:public"
  "postgres-listings:5435:postgres:public"
  "postgres-shopping:5436:postgres:public"
  "postgres-auction-monitor:5438:postgres:public"
  "postgres-analytics:5439:postgres:public"
  "postgres-python-ai:5440:postgres:public"
)

# Check prerequisites
check_prerequisites() {
  info "Checking prerequisites..."
  
  if ! command -v docker &> /dev/null; then
    error "Docker is not installed or not in PATH"
    exit 1
  fi
  
  if ! docker compose ps postgres >/dev/null 2>&1; then
    error "Docker Compose is not running. Please start it with: docker compose up -d"
    exit 1
  fi
  
  success "Prerequisites check passed"
}

# Create backup directory
create_backup_dir() {
  info "Creating backup directory: $BACKUP_DIR"
  mkdir -p "$BACKUP_DIR"
  success "Backup directory created"
}

# Extract database
extract_database() {
  local service_name=$1
  local port=$2
  local db_name=$3
  local schema_name=$4
  
  local output_file="${BACKUP_DIR}/${service_name}-${schema_name}-${TIMESTAMP}.sql"
  local compressed_file="${output_file}.gz"
  
  info "Extracting ${service_name} (${schema_name} schema) from port ${port}..."
  
  # Check if container is healthy
  if ! docker compose ps "$service_name" | grep -q "healthy\|running"; then
    warning "Container ${service_name} is not healthy/running. Skipping..."
    return 1
  fi
  
  # Extract with pg_dump
  # Options:
  #   --clean: Drop objects before creating
  #   --if-exists: Use IF EXISTS when dropping
  #   --create: Include CREATE DATABASE statement
  #   --schema: Only dump specified schema
  #   --no-owner: Don't output commands to set ownership
  #   --no-privileges: Don't output commands to set privileges
  #   --verbose: Verbose output
  
  if docker compose exec -T "$service_name" pg_dump \
    -U postgres \
    -d "$db_name" \
    --schema="$schema_name" \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    --verbose \
    > "$output_file" 2>"${output_file}.log"; then
    
    local file_size=$(du -h "$output_file" | cut -f1)
    success "Extracted ${schema_name} schema to ${output_file} (${file_size})"
    
    # Compress if requested
    if [[ "$COMPRESS" == "true" ]]; then
      info "Compressing ${output_file}..."
      if gzip -f "$output_file"; then
        local compressed_size=$(du -h "$compressed_file" | cut -f1)
        success "Compressed to ${compressed_file} (${compressed_size})"
      else
        warning "Compression failed, keeping uncompressed file"
      fi
    fi
    
    return 0
  else
    error "Failed to extract ${schema_name} schema. Check ${output_file}.log for details"
    return 1
  fi
}

# Extract full database (all schemas)
extract_full_database() {
  local service_name=$1
  local port=$2
  local db_name=$3
  
  local output_file="${BACKUP_DIR}/${service_name}-full-${TIMESTAMP}.sql"
  local compressed_file="${output_file}.gz"
  
  info "Extracting full database ${service_name} (all schemas) from port ${port}..."
  
  # Check if container is healthy
  if ! docker compose ps "$service_name" | grep -q "healthy\|running"; then
    warning "Container ${service_name} is not healthy/running. Skipping..."
    return 1
  fi
  
  # Extract full database dump (without --create to avoid database creation issues)
  # This dumps all schemas and data in the database
  if docker compose exec -T "$service_name" pg_dump \
    -U postgres \
    -d "$db_name" \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    --verbose \
    > "$output_file" 2>"${output_file}.log"; then
    
    local file_size=$(du -h "$output_file" | cut -f1)
    success "Extracted full database to ${output_file} (${file_size})"
    
    # Compress if requested
    if [[ "$COMPRESS" == "true" ]]; then
      info "Compressing ${output_file}..."
      if gzip -f "$output_file"; then
        local compressed_size=$(du -h "$compressed_file" | cut -f1)
        success "Compressed to ${compressed_file} (${compressed_size})"
      else
        warning "Compression failed, keeping uncompressed file"
      fi
    fi
    
    return 0
  else
    error "Failed to extract full database. Check ${output_file}.log for details"
    return 1
  fi
}

# Main execution
main() {
  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "  PostgreSQL Database Extraction Script"
  echo "═══════════════════════════════════════════════════════════"
  echo ""
  
  check_prerequisites
  create_backup_dir
  
  echo ""
  info "Starting extraction of all databases..."
  echo ""
  
  local success_count=0
  local fail_count=0
  
  # Extract each database
  for db_config in "${DATABASES[@]}"; do
    IFS=':' read -r service_name port db_name schema_name <<< "$db_config"
    
    # Skip schema extraction and go straight to full database extraction
    # This ensures we get all data regardless of schema structure
    if extract_full_database "$service_name" "$port" "$db_name"; then
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
  success "Successfully extracted: ${success_count} databases"
  if [[ $fail_count -gt 0 ]]; then
    error "Failed to extract: ${fail_count} databases"
  fi
  echo ""
  info "Backup directory: ${BACKUP_DIR}"
  echo ""
  
  # Show extracted files
  info "Extracted files:"
  ls -lh "$BACKUP_DIR" | grep -E "\.(sql|gz)$" | awk '{print "  " $9 " (" $5 ")"}'
  echo ""
  
  # Create a summary file
  local summary_file="${BACKUP_DIR}/extraction-summary.txt"
  {
    echo "PostgreSQL Database Extraction Summary"
    echo "======================================"
    echo "Date: $(date)"
    echo "Backup Directory: ${BACKUP_DIR}"
    echo ""
    echo "Extraction Results:"
    echo "  Successful: ${success_count}"
    echo "  Failed: ${fail_count}"
    echo ""
    echo "Databases Extracted:"
    for db_config in "${DATABASES[@]}"; do
      IFS=':' read -r service_name port db_name schema_name <<< "$db_config"
      echo "  - ${service_name} (port ${port}): ${schema_name} schema"
    done
    echo ""
    echo "Files:"
    ls -lh "$BACKUP_DIR" | grep -E "\.(sql|gz)$" | awk '{print "  " $9 " (" $5 ")"}'
  } > "$summary_file"
  
  success "Summary saved to: ${summary_file}"
  echo ""
  
  if [[ $fail_count -eq 0 ]]; then
    success "All databases extracted successfully! ✓"
    exit 0
  else
    warning "Some databases failed to extract. Please check the logs."
    exit 1
  fi
}

# Run main function
main
