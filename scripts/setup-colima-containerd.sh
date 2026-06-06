#!/usr/bin/env bash
# Colima Setup Script with containerd Runtime
# Migrates from Docker Desktop to Colima for record-platform

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
COLIMA_CPU=${COLIMA_CPU:-8}
COLIMA_MEMORY=${COLIMA_MEMORY:-12}
COLIMA_DISK=${COLIMA_DISK:-200}
COLIMA_RUNTIME=${COLIMA_RUNTIME:-containerd}
COLIMA_KUBERNETES=${COLIMA_KUBERNETES:-true}

print_header() {
    echo ""
    echo -e "${BLUE}=========================================="
    echo "$1"
    echo "==========================================${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

check_prerequisites() {
    print_header "Checking Prerequisites"
    
    # Check Homebrew
    if ! command -v brew >/dev/null 2>&1; then
        print_error "Homebrew not found. Please install Homebrew first:"
        echo "  /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
        return 1
    fi
    print_success "Homebrew found"
    
    # Check Docker Desktop is stopped
    if pgrep -f "Docker Desktop" >/dev/null 2>&1; then
        print_warning "Docker Desktop is still running"
        echo "Please quit Docker Desktop before continuing:"
        echo "  osascript -e 'quit app \"Docker\"'"
        echo ""
        read -p "Quit Docker Desktop now? (y/n): " quit_docker
        if [[ "$quit_docker" == "y" ]]; then
            osascript -e 'quit app "Docker"' || true
            sleep 3
            print_success "Docker Desktop quit"
        else
            print_error "Please quit Docker Desktop manually and run this script again"
            return 1
        fi
    else
        print_success "Docker Desktop is not running"
    fi
    
    # Check kubectl
    if ! command -v kubectl >/dev/null 2>&1; then
        print_warning "kubectl not found. Installing via Homebrew..."
        brew install kubectl
    fi
    print_success "kubectl found"
    
    # Check kind
    if ! command -v kind >/dev/null 2>&1; then
        print_warning "kind not found. Installing via Homebrew..."
        brew install kind
    fi
    print_success "kind found"
    
    return 0
}

install_colima() {
    print_header "Installing Colima"
    
    if command -v colima >/dev/null 2>&1; then
        print_warning "Colima already installed"
        colima version
        read -p "Reinstall Colima? (y/n): " reinstall
        if [[ "$reinstall" != "y" ]]; then
            print_success "Using existing Colima installation"
            return 0
        fi
    fi
    
    echo "Installing Colima via Homebrew..."
    brew install colima
    
    if ! command -v colima >/dev/null 2>&1; then
        print_error "Colima installation failed"
        return 1
    fi
    
    print_success "Colima installed successfully"
    colima version
    return 0
}

configure_colima() {
    print_header "Configuring Colima with containerd"
    
    # Stop existing Colima if running
    if colima status >/dev/null 2>&1; then
        print_warning "Colima is already running"
        read -p "Stop and reconfigure? (y/n): " reconfigure
        if [[ "$reconfigure" == "y" ]]; then
            echo "Stopping Colima..."
            colima stop
        else
            print_success "Using existing Colima configuration"
            return 0
        fi
    fi
    
    echo "Starting Colima with containerd runtime..."
    echo "Configuration:"
    echo "  CPU: ${COLIMA_CPU}"
    echo "  Memory: ${COLIMA_MEMORY}GB"
    echo "  Disk: ${COLIMA_DISK}GB"
    echo "  Runtime: ${COLIMA_RUNTIME}"
    echo "  Kubernetes: ${COLIMA_KUBERNETES}"
    echo ""
    
    # Create Colima with containerd
    colima start \
        --cpu "${COLIMA_CPU}" \
        --memory "${COLIMA_MEMORY}" \
        --disk "${COLIMA_DISK}" \
        --runtime "${COLIMA_RUNTIME}" \
        --kubernetes
    
    if [[ $? -ne 0 ]]; then
        print_error "Colima startup failed"
        return 1
    fi
    
    print_success "Colima started successfully"
    
    # Verify containerd runtime (use nerdctl for containerd, docker for docker runtime)
    echo ""
    echo "Verifying containerd runtime..."
    if [[ "${COLIMA_RUNTIME}" == "containerd" ]]; then
        # For containerd runtime, use nerdctl
        if colima nerdctl ps >/dev/null 2>&1; then
            print_success "containerd runtime verified via nerdctl"
            echo "Runtime info:"
            colima nerdctl info 2>/dev/null | head -5 || echo "  containerd runtime is active"
        else
            print_warning "Could not verify containerd via nerdctl (but Colima is running)"
        fi
    else
        # For docker runtime, use docker
        docker info 2>/dev/null | grep -i runtime || docker info 2>/dev/null | grep -i docker || print_warning "Could not verify Docker runtime"
    fi
    
    print_success "Colima configured and running with ${COLIMA_RUNTIME}"
    return 0
}

configure_docker_context() {
    print_header "Configuring Docker Context"
    
    # With containerd runtime, there's no Docker socket - use nerdctl instead
    if [[ "${COLIMA_RUNTIME}" == "containerd" ]]; then
        print_warning "Using containerd runtime - Docker socket not available"
        echo "Use 'colima nerdctl' commands instead of 'docker' commands:"
        echo "  colima nerdctl ps        # List containers"
        echo "  colima nerdctl images    # List images"
        echo "  colima nerdctl build     # Build images"
        echo ""
        echo "Or set an alias: alias docker='colima nerdctl'"
        print_success "containerd runtime configured (use nerdctl instead of docker)"
        return 0
    fi
    
    # For docker runtime, configure Docker context
    docker context use colima 2>/dev/null || docker context create colima --docker "host=unix://${HOME}/.colima/default/docker.sock" && docker context use colima
    
    print_success "Docker context configured for Colima"
    
    # Test Docker connection
    echo ""
    echo "Testing Docker connection..."
    if docker ps >/dev/null 2>&1; then
        print_success "Docker connection working"
    else
        print_error "Docker connection failed"
        return 1
    fi
    
    return 0
}

configure_kubectl() {
    print_header "Configuring kubectl for Colima Kubernetes"
    
    # Get Colima kubeconfig
    KUBECONFIG_PATH="${HOME}/.colima/default/kubernetes/kubeconfig"
    
    if [[ ! -f "$KUBECONFIG_PATH" ]]; then
        print_warning "Colima Kubernetes kubeconfig not found"
        echo "Kubernetes may not be enabled. Starting with Kubernetes..."
        colima start --kubernetes
        sleep 5
    fi
    
    # Set KUBECONFIG
    export KUBECONFIG="$KUBECONFIG_PATH"
    echo "export KUBECONFIG=\"$KUBECONFIG_PATH\"" >> ~/.zshrc 2>/dev/null || true
    echo "export KUBECONFIG=\"$KUBECONFIG_PATH\"" >> ~/.bashrc 2>/dev/null || true
    
    print_success "kubectl configured for Colima Kubernetes"
    
    # Test kubectl
    echo ""
    echo "Testing kubectl connection..."
    if kubectl cluster-info >/dev/null 2>&1; then
        print_success "kubectl connection working"
        kubectl cluster-info | head -2
    else
        print_warning "kubectl connection failed (Kubernetes may not be enabled)"
        echo "You can enable Kubernetes later with: colima start --kubernetes"
    fi
    
    return 0
}

verify_setup() {
    print_header "Verifying Colima Setup"
    
    echo "1. Colima status:"
    colima status || print_error "Colima not running"
    echo ""
    
    # Use nerdctl for containerd runtime, docker for docker runtime
    if [[ "${COLIMA_RUNTIME}" == "containerd" ]]; then
        echo "2. containerd runtime (via nerdctl):"
        if colima nerdctl ps >/dev/null 2>&1; then
            print_success "containerd runtime is accessible via nerdctl"
            echo "  Containers:"
            colima nerdctl ps 2>/dev/null | head -5 || echo "    (none running)"
        else
            print_warning "Could not verify containerd via nerdctl (but Colima is running)"
        fi
        echo ""
        
        echo "3. Image management (via nerdctl):"
        echo "  Images:"
        colima nerdctl images 2>/dev/null | head -5 || echo "    (none)"
        echo ""
        echo "  Note: Use 'colima nerdctl' instead of 'docker' commands:"
        echo "    colima nerdctl ps        # List containers"
        echo "    colima nerdctl images    # List images"
        echo "    colima nerdctl build     # Build images"
        echo ""
    else
        echo "2. Docker info:"
        docker info 2>/dev/null | head -10 || print_error "Docker not accessible"
        echo ""
        
        echo "3. Docker runtime:"
        docker info 2>/dev/null | grep -i runtime || print_warning "Could not verify Docker runtime"
        echo ""
    fi
    
    echo "4. Disk usage:"
    if command -v du >/dev/null 2>&1; then
        COLIMA_DISK_PATH="${HOME}/.colima/default/disk.img"
        if [[ -f "$COLIMA_DISK_PATH" ]]; then
            DISK_SIZE=$(du -h "$COLIMA_DISK_PATH" | awk '{print $1}')
            echo "  Colima disk: $DISK_SIZE"
        fi
    fi
    echo ""
    
    echo "5. kubectl (if Kubernetes enabled):"
    if [[ -n "${KUBECONFIG:-}" ]] && kubectl cluster-info >/dev/null 2>&1; then
        kubectl cluster-info | head -2
    else
        echo "  Kubernetes not enabled or not accessible"
    fi
    
    print_success "Verification complete"
}

show_next_steps() {
    print_header "Next Steps"
    
    cat << EOF
✅ Colima setup complete!

Next steps:

1. Create Kind cluster:
   cd $REPO_ROOT
   kind create cluster --name h3 --config kind-h3.yaml

2. Build and load images:
   ./scripts/build-and-load-images.sh

3. Deploy services:
   kubectl apply -k infra/k8s/base

4. Verify services:
   kubectl get pods -n record-platform

Useful commands:

  # Colima management
  colima start          # Start Colima
  colima stop           # Stop Colima
  colima status         # Check status
  colima delete         # Delete Colima (clean slate)

  # Container runtime (containerd = nerdctl, docker = docker)
  colima nerdctl ps     # List containers (containerd runtime)
  colima nerdctl images # List images (containerd runtime)
  # Or set alias: alias docker='colima nerdctl' (for containerd runtime)

  # Kubernetes
  kubectl get nodes     # List nodes
  kubectl get pods -A   # List all pods

Configuration:
  CPU: ${COLIMA_CPU}
  Memory: ${COLIMA_MEMORY}GB
  Disk: ${COLIMA_DISK}GB
  Runtime: ${COLIMA_RUNTIME}

EOF
}

main() {
    print_header "Colima Setup with containerd for record-platform"
    
    echo "This script will:"
    echo "  1. Install Colima (if not installed)"
    echo "  2. Configure Colima with containerd runtime"
    echo "  3. Set resource limits (CPU: ${COLIMA_CPU}, Memory: ${COLIMA_MEMORY}GB, Disk: ${COLIMA_DISK}GB)"
    if [[ "${COLIMA_RUNTIME}" == "containerd" ]]; then
        echo "  4. Configure nerdctl for containerd runtime (no Docker socket)"
    else
        echo "  4. Configure Docker context"
    fi
    echo "  5. Configure kubectl for Colima Kubernetes"
    echo ""
    read -p "Continue? (y/n): " confirm
    if [[ "$confirm" != "y" ]]; then
        echo "Cancelled"
        exit 0
    fi
    
    check_prerequisites || exit 1
    install_colima || exit 1
    configure_colima || exit 1
    configure_docker_context || exit 1
    configure_kubectl || true  # Kubernetes is optional
    verify_setup
    show_next_steps
    
    print_success "Colima setup complete! 🎉"
}

main "$@"
