.PHONY: help terraform-init terraform-validate terraform-plan terraform-apply terraform-destroy ansible-install ansible-lint ansible-check ansible-deploy test-setup clean

# Default target
help:
	@echo "IAC Management Commands"
	@echo "======================="
	@echo ""
	@echo "Terraform Commands:"
	@echo "  make terraform-init      - Initialize Terraform"
	@echo "  make terraform-validate  - Validate Terraform configuration"
	@echo "  make terraform-plan      - Show Terraform execution plan"
	@echo "  make terraform-apply     - Apply Terraform changes"
	@echo "  make terraform-destroy   - Destroy Terraform resources"
	@echo ""
	@echo "Ansible Commands:"
	@echo "  make ansible-install     - Install Ansible collections"
	@echo "  make ansible-lint       - Lint Ansible playbooks"
	@echo "  make ansible-check       - Dry-run Ansible playbook"
	@echo "  make ansible-deploy      - Deploy with Ansible"
	@echo ""
	@echo "Utility Commands:"
	@echo "  make test-setup          - Run IAC setup verification script"
	@echo "  make clean               - Clean temporary files"
	@echo ""

# Terraform commands
terraform-init:
	@echo "🔧 Initializing Terraform..."
	cd terraform && terraform init

terraform-validate:
	@echo "🔍 Validating Terraform configuration..."
	cd terraform && terraform validate

terraform-plan:
	@echo "📋 Generating Terraform plan..."
	cd terraform && terraform plan

terraform-apply:
	@echo "🚀 Applying Terraform changes..."
	cd terraform && terraform apply

terraform-destroy:
	@echo "⚠️  Destroying Terraform resources..."
	@read -p "Are you sure? [y/N] " -n 1 -r; \
	echo; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		cd terraform && terraform destroy; \
	fi

# Ansible commands
ansible-install:
	@echo "📦 Installing Ansible collections..."
	cd ansible && ansible-galaxy collection install -r requirements.yml

ansible-lint:
	@echo "🔍 Linting Ansible playbooks..."
	@if command -v ansible-lint &> /dev/null; then \
		cd ansible && ansible-lint playbooks/*.yml; \
	else \
		echo "⚠️  ansible-lint not installed. Install with: pip install ansible-lint"; \
	fi

ansible-check:
	@echo "🔍 Running Ansible playbook in check mode (dry-run)..."
	cd ansible && ansible-playbook playbooks/deploy-services.yml --check

ansible-deploy:
	@echo "🚀 Deploying with Ansible..."
	cd ansible && ansible-playbook playbooks/deploy-services.yml

# Utility commands
test-setup:
	@echo "🧪 Running IAC setup verification..."
	chmod +x test-iac-setup.sh
	./test-iac-setup.sh

clean:
	@echo "🧹 Cleaning temporary files..."
	@rm -rf terraform/.terraform terraform/.terraform.lock.hcl terraform/terraform.tfstate terraform/terraform.tfstate.backup
	@rm -rf ansible/.ansible /tmp/ansible_facts
	@echo "✅ Clean complete"

