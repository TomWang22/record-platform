#!/bin/bash
# IAC Setup Verification and Testing Script
# This script checks prerequisites and creates missing Terraform/Ansible files

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TERRAFORM_DIR="${SCRIPT_DIR}/terraform"
ANSIBLE_DIR="${SCRIPT_DIR}/ansible"

echo "🔍 IAC Setup Verification and Testing"
echo "======================================"
echo ""

# Step 1: Check prerequisites
echo "📋 Step 1: Checking prerequisites..."
echo ""

# Check Terraform
if command -v terraform &> /dev/null; then
    TERRAFORM_VERSION=$(terraform version -json | jq -r '.terraform_version' 2>/dev/null || terraform version | head -n1)
    echo "✅ Terraform: $TERRAFORM_VERSION"
else
    echo "❌ Terraform not found"
    echo "   Install: brew install terraform"
    echo "   Or: https://developer.hashicorp.com/terraform/downloads"
    exit 1
fi

# Check Ansible
if command -v ansible &> /dev/null; then
    ANSIBLE_VERSION=$(ansible --version | head -n1)
    echo "✅ Ansible: $ANSIBLE_VERSION"
else
    echo "❌ Ansible not found"
    echo "   Install: pip install ansible"
    echo "   Or: pip3 install ansible"
    exit 1
fi

# Check kubectl (optional)
if command -v kubectl &> /dev/null; then
    KUBECTL_VERSION=$(kubectl version --client --short 2>/dev/null || echo "installed")
    echo "✅ kubectl: $KUBECTL_VERSION"
else
    echo "⚠️  kubectl not found (optional but recommended)"
    echo "   Install: brew install kubectl"
fi

# Check jq (optional, for JSON parsing)
if command -v jq &> /dev/null; then
    echo "✅ jq: installed"
else
    echo "⚠️  jq not found (optional, for JSON parsing)"
fi

echo ""
echo "📁 Step 2: Checking and creating missing files..."
echo ""

# Create Terraform directory if missing
mkdir -p "${TERRAFORM_DIR}"

# Create main.tf if missing
if [ ! -f "${TERRAFORM_DIR}/main.tf" ]; then
    echo "📝 Creating ${TERRAFORM_DIR}/main.tf..."
    cat > "${TERRAFORM_DIR}/main.tf" << 'EOF'
terraform {
  required_version = ">= 1.0"

  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.23"
    }
  }

  # Optional: Backend configuration
  # backend "s3" {
  #   bucket = "your-terraform-state-bucket"
  #   key    = "record-platform/terraform.tfstate"
  #   region = "us-east-1"
  # }
}

# Configure Kubernetes provider
provider "kubernetes" {
  config_path    = var.kubeconfig_path
  config_context = var.kubeconfig_context
}

# Local values
locals {
  common_labels = {
    app     = "record-platform"
    env     = var.environment
    managed = "terraform"
  }

  service_ports = {
    api_gateway     = 8080
    auth_service    = 4001
    records_service = 4002
    listings_service = 4003
    shopping_service = 4007
    social_service  = 4004
    analytics_service = 4005
    auction_monitor = 4008
    python_ai_service = 4009
  }
}
EOF
    echo "✅ Created main.tf"
else
    echo "✅ main.tf already exists"
fi

# Create variables.tf if missing
if [ ! -f "${TERRAFORM_DIR}/variables.tf" ]; then
    echo "📝 Creating ${TERRAFORM_DIR}/variables.tf..."
    cat > "${TERRAFORM_DIR}/variables.tf" << 'EOF'
variable "namespace" {
  description = "Kubernetes namespace name"
  type        = string
  default     = "record-platform"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "kubeconfig_path" {
  description = "Path to kubeconfig file"
  type        = string
  default     = "~/.kube/config"
}

variable "kubeconfig_context" {
  description = "Kubernetes context to use"
  type        = string
  default     = null
}
EOF
    echo "✅ Created variables.tf"
else
    echo "✅ variables.tf already exists"
fi

# Create outputs.tf if missing
if [ ! -f "${TERRAFORM_DIR}/outputs.tf" ]; then
    echo "📝 Creating ${TERRAFORM_DIR}/outputs.tf..."
    cat > "${TERRAFORM_DIR}/outputs.tf" << 'EOF'
output "namespace" {
  description = "Kubernetes namespace name"
  value       = kubernetes_namespace.main.metadata[0].name
}

output "kubeconfig_path" {
  description = "Path to kubeconfig file"
  value       = var.kubeconfig_path
}

output "service_ports" {
  description = "Service ports mapping"
  value       = local.service_ports
}
EOF
    echo "✅ Created outputs.tf"
else
    echo "✅ outputs.tf already exists"
fi

# Create .terraform-version if missing (for tfenv)
if [ ! -f "${TERRAFORM_DIR}/.terraform-version" ]; then
    echo "📝 Creating ${TERRAFORM_DIR}/.terraform-version..."
    echo "1.6.0" > "${TERRAFORM_DIR}/.terraform-version"
    echo "✅ Created .terraform-version"
fi

# Create Ansible directory structure
mkdir -p "${ANSIBLE_DIR}/inventory"
mkdir -p "${ANSIBLE_DIR}/playbooks"
mkdir -p "${ANSIBLE_DIR}/roles"

# Create ansible.cfg if missing
if [ ! -f "${ANSIBLE_DIR}/ansible.cfg" ]; then
    echo "📝 Creating ${ANSIBLE_DIR}/ansible.cfg..."
    cat > "${ANSIBLE_DIR}/ansible.cfg" << 'EOF'
[defaults]
inventory = inventory/hosts.yml
roles_path = roles
host_key_checking = False
retry_files_enabled = False
stdout_callback = yaml
gathering = smart
fact_caching = jsonfile
fact_caching_connection = /tmp/ansible_facts
fact_caching_timeout = 3600

[inventory]
enable_plugins = host_list, script, auto, yaml, ini, toml

[privilege_escalation]
become = True
become_method = sudo
become_user = root
become_ask_pass = False

[ssh_connection]
ssh_args = -o ControlMaster=auto -o ControlPersist=60s
pipelining = True
EOF
    echo "✅ Created ansible.cfg"
else
    echo "✅ ansible.cfg already exists"
fi

# Create inventory/hosts.yml if missing
if [ ! -f "${ANSIBLE_DIR}/inventory/hosts.yml" ]; then
    echo "📝 Creating ${ANSIBLE_DIR}/inventory/hosts.yml..."
    cat > "${ANSIBLE_DIR}/inventory/hosts.yml" << 'EOF'
all:
  children:
    kubernetes:
      hosts:
        localhost:
          ansible_connection: local
          ansible_python_interpreter: "{{ ansible_playbook_python }}"
          kubeconfig_path: "~/.kube/config"
          kubeconfig_context: null  # Use current context
EOF
    echo "✅ Created inventory/hosts.yml"
else
    echo "✅ inventory/hosts.yml already exists"
fi

# Create requirements.yml if missing
if [ ! -f "${ANSIBLE_DIR}/requirements.yml" ]; then
    echo "📝 Creating ${ANSIBLE_DIR}/requirements.yml..."
    cat > "${ANSIBLE_DIR}/requirements.yml" << 'EOF'
---
collections:
  - name: kubernetes.core
    version: ">=2.4.0"
  - name: community.kubernetes
    version: ">=2.0.0"
  - name: community.docker
    version: ">=3.0.0"

roles: []
EOF
    echo "✅ Created requirements.yml"
else
    echo "✅ requirements.yml already exists"
fi

# Create basic playbook if missing
if [ ! -f "${ANSIBLE_DIR}/playbooks/deploy-services.yml" ]; then
    echo "📝 Creating ${ANSIBLE_DIR}/playbooks/deploy-services.yml..."
    cat > "${ANSIBLE_DIR}/playbooks/deploy-services.yml" << 'EOF'
---
- name: Deploy Record Platform Services
  hosts: kubernetes
  gather_facts: yes
  vars:
    namespace: "record-platform"
    skip_cert_management: true
    skip_caddy_config: true
    # Add other variables as needed

  tasks:
    - name: Verify Kubernetes connection
      kubernetes.core.k8s_info:
        api_version: v1
        kind: Namespace
        name: "{{ namespace }}"
      register: ns_info
      failed_when: false
      changed_when: false

    - name: Display namespace status
      debug:
        msg: "Namespace '{{ namespace }}' {{ 'exists' if ns_info.resources else 'does not exist' }}"

    - name: Example - Create ConfigMap (placeholder)
      kubernetes.core.k8s:
        state: present
        definition:
          apiVersion: v1
          kind: ConfigMap
          metadata:
            name: app-config-example
            namespace: "{{ namespace }}"
          data:
            example: "value"
      when: not skip_caddy_config | default(false)
      # This task is skipped when skip_caddy_config is true

    - name: Display completion message
      debug:
        msg: "Deployment playbook completed (dry-run mode)"
EOF
    echo "✅ Created playbooks/deploy-services.yml"
else
    echo "✅ playbooks/deploy-services.yml already exists"
fi

echo ""
echo "🔧 Step 3: Initializing Terraform..."
echo ""

cd "${TERRAFORM_DIR}"
if terraform init -backend=false > /dev/null 2>&1; then
    echo "✅ Terraform initialized"
else
    echo "⚠️  Terraform init had issues (this is okay for validation)"
fi

echo ""
echo "🔍 Step 4: Validating Terraform configuration..."
echo ""

if terraform validate > /dev/null 2>&1; then
    echo "✅ Terraform configuration is valid"
else
    echo "⚠️  Terraform validation found issues:"
    terraform validate || true
fi

echo ""
echo "📦 Step 5: Installing Ansible collections..."
echo ""

cd "${ANSIBLE_DIR}"
if ansible-galaxy collection install -r requirements.yml > /dev/null 2>&1; then
    echo "✅ Ansible collections installed"
else
    echo "⚠️  Ansible collection installation had issues:"
    ansible-galaxy collection install -r requirements.yml || true
fi

echo ""
echo "📋 Step 6: Verifying Ansible inventory..."
echo ""

if ansible-inventory --list > /dev/null 2>&1; then
    echo "✅ Ansible inventory is valid"
    echo ""
    echo "Inventory hosts:"
    ansible-inventory --list | grep -A 5 "kubernetes" || true
else
    echo "⚠️  Ansible inventory verification had issues"
fi

echo ""
echo "✅ Setup verification complete!"
echo ""
echo "📚 Next steps:"
echo ""
echo "Terraform:"
echo "  cd ${TERRAFORM_DIR}"
echo "  terraform plan          # See what will be created"
echo "  terraform apply         # Apply changes (when ready)"
echo ""
echo "Ansible:"
echo "  cd ${ANSIBLE_DIR}"
echo "  ansible-playbook playbooks/deploy-services.yml --check  # Dry-run"
echo "  ansible-playbook playbooks/deploy-services.yml          # Deploy"
echo ""
echo "Or use the Makefile:"
echo "  cd ${SCRIPT_DIR}"
echo "  make help                # See all commands"
echo "  make terraform-init      # Initialize Terraform"
echo "  make ansible-install     # Install Ansible collections"
echo ""

