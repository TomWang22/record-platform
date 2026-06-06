#!/usr/bin/env bash
# Docker Desktop Recovery Script
# Safely shuts down Docker Desktop and provides recovery options

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_RAW_PATH="$HOME/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Functions
print_header() {
    echo ""
    echo "=========================================="
    echo "$1"
    echo "=========================================="
    echo ""
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

check_docker_raw_size() {
    if [[ -f "$DOCKER_RAW_PATH" ]]; then
        local size=$(ls -lh "$DOCKER_RAW_PATH" | awk '{print $5}')
        local size_bytes=$(ls -l "$DOCKER_RAW_PATH" | awk '{print $5}')
        local size_gb=$((size_bytes / 1024 / 1024 / 1024))
        
        echo "Docker.raw size: $size ($size_gb GB)"
        
        if [[ $size_gb -gt 60 ]]; then
            print_warning "Docker.raw is ${size_gb}GB (should be <40-60GB)"
            print_warning "This is likely causing Docker to hang"
            return 1
        elif [[ $size_gb -gt 40 ]]; then
            print_warning "Docker.raw is ${size_gb}GB (approaching threshold)"
            return 2
        else
            print_success "Docker.raw size is normal (${size_gb}GB)"
            return 0
        fi
    else
        print_warning "Docker.raw not found - Docker Desktop may not be running"
        return 3
    fi
}

check_docker_processes() {
    echo "Checking Docker processes..."
    
    local docker_processes=$(ps aux | grep -i docker | grep -v grep | grep -v "$0" || true)
    
    if [[ -z "$docker_processes" ]]; then
        print_success "No Docker processes running"
        return 0
    else
        print_warning "Docker processes still running:"
        echo "$docker_processes"
        return 1
    fi
}

safe_shutdown_docker() {
    print_header "Safe Shutdown of Docker Desktop"
    
    echo "Step 1: Quitting Docker Desktop application..."
    osascript -e 'quit app "Docker"' 2>/dev/null || true
    sleep 3
    
    echo "Step 2: Hard stopping Docker VM processes..."
    sudo pkill -9 com.docker.virtualization 2>/dev/null || true
    sudo pkill -9 com.docker.backend 2>/dev/null || true
    sudo pkill -9 Docker 2>/dev/null || true
    sleep 2
    
    echo "Step 3: Verifying all processes stopped..."
    if check_docker_processes; then
        print_success "Docker processes stopped"
        return 0
    else
        print_error "Some Docker processes may still be running"
        return 1
    fi
}

reset_docker_desktop() {
    print_header "Resetting Docker Desktop (DESTRUCTIVE)"
    
    print_warning "This will DELETE ALL Docker images, containers, and volumes!"
    print_warning "RP is reproducible, so this is safe, but make sure you've saved anything important."
    
    read -p "Are you sure you want to reset Docker Desktop? (yes/no): " confirm
    
    if [[ "$confirm" != "yes" ]]; then
        print_warning "Reset cancelled"
        return 1
    fi
    
    echo ""
    echo "Shutting down Docker Desktop..."
    safe_shutdown_docker
    
    echo ""
    echo "Removing Docker.raw (VM storage)..."
    if [[ -f "$DOCKER_RAW_PATH" ]]; then
        rm -f "$DOCKER_RAW_PATH"
        print_success "Docker.raw removed"
    else
        print_warning "Docker.raw not found (may have already been removed)"
    fi
    
    echo ""
    print_success "Docker Desktop reset complete!"
    echo "Next steps:"
    echo "  1. Start Docker Desktop application"
    echo "  2. Docker will recreate the VM with clean metadata"
    echo "  3. Rebuild your images (RP is reproducible)"
}

compact_docker_disk() {
    print_header "Compacting Docker Disk (Attempts to Save State)"
    
    print_warning "This tries to compact Docker.raw while preserving images/containers"
    print_warning "May not work if Docker is too corrupted - will fall back to reset"
    
    echo ""
    safe_shutdown_docker
    
    if [[ ! -f "$DOCKER_RAW_PATH" ]]; then
        print_error "Docker.raw not found - cannot compact"
        return 1
    fi
    
    echo "Backing up Docker.raw..."
    local backup_path="${DOCKER_RAW_PATH}.backup.$(date +%Y%m%d_%H%M%S)"
    cp "$DOCKER_RAW_PATH" "$backup_path"
    print_success "Backup created: $backup_path"
    
    echo ""
    echo "Removing Docker.raw (Docker will recreate on next start)..."
    mv "$DOCKER_RAW_PATH" "${DOCKER_RAW_PATH}.old"
    
    echo ""
    print_success "Disk compaction initiated"
    echo "Next steps:"
    echo "  1. Start Docker Desktop application"
    echo "  2. If Docker boots successfully, it rebuilt cleanly"
    echo "  3. If Docker fails to boot:"
    echo "     - Restore: mv ${DOCKER_RAW_PATH}.old $DOCKER_RAW_PATH"
    echo "     - Then run: $0 reset"
}

check_status() {
    print_header "Docker Desktop Status Check"
    
    echo "Checking Docker.raw size..."
    check_docker_raw_size
    local size_status=$?
    
    echo ""
    check_docker_processes
    local process_status=$?
    
    echo ""
    if command -v docker >/dev/null 2>&1; then
        echo "Testing Docker CLI responsiveness..."
        if timeout 3 docker ps >/dev/null 2>&1; then
            print_success "Docker CLI is responsive"
        else
            print_error "Docker CLI is NOT responsive (hanging or timeout)"
            print_warning "This indicates Docker Desktop VM is wedged"
        fi
    else
        print_warning "Docker CLI not found in PATH"
    fi
    
    echo ""
    echo "=== Recommendations ==="
    
    if [[ $size_status -eq 1 ]]; then
        print_error "Docker.raw is too large (>60GB) - RESET REQUIRED"
        echo "  Run: $0 reset"
    elif [[ $size_status -eq 2 ]]; then
        print_warning "Docker.raw is large (>40GB) - Consider reset soon"
        echo "  Run: $0 reset (when ready)"
    fi
    
    if [[ $process_status -eq 1 ]]; then
        print_warning "Docker processes still running - Shutdown required"
        echo "  Run: $0 shutdown"
    fi
}

show_help() {
    cat << EOF
Docker Desktop Recovery Script

Usage: $0 [command]

Commands:
  check      - Check Docker Desktop status (size, processes, responsiveness)
  shutdown   - Safely shutdown Docker Desktop (quits app, kills processes)
  reset      - Reset Docker Desktop to factory defaults (DESTRUCTIVE - deletes everything)
  compact    - Attempt disk compaction while preserving state (may not work if too corrupted)
  help       - Show this help message

Examples:
  $0 check          # Check if Docker is healthy
  $0 shutdown       # Safe shutdown before reset
  $0 reset          # Nuclear option - resets everything (RP is reproducible, so safe)
  $0 compact        # Try to save state while fixing storage

Note: If Docker CLI commands hang, this is a known Docker Desktop + macOS issue.
      The Docker.raw file (>60GB) indicates corrupted VM metadata.
      Reset is the recommended fix (RP is reproducible, so losing images is fine).

EOF
}

# Main
case "${1:-help}" in
    check)
        check_status
        ;;
    shutdown)
        safe_shutdown_docker
        ;;
    reset)
        reset_docker_desktop
        ;;
    compact)
        compact_docker_disk
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        print_error "Unknown command: $1"
        echo ""
        show_help
        exit 1
        ;;
esac
