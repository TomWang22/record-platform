# ADR-002: Planning — Chef and Jenkins alongside Terraform and Ansible

**Status:** Planning  
**Date:** 2026-02  
**Context:** Record Platform uses Terraform (provisioning) and Ansible (configuration / deploy). We want to plan how Chef (configuration management) and Jenkins (CI/CD) could be added on top of the existing IAC and automation.

## Current state

- **Terraform** (`infra/terraform/`): Kubernetes namespaces, ConfigMaps, declarative infra.
- **Ansible** (`infra/ansible/`): Configuration management, `deploy-services.yml`, K8s collections, inventory.
- **Scripts**: Bootstrap, smoke tests, TLS, load tests, pgbench, suite runners (preflight + 8 suites).

## Goals

- Introduce **Chef** (or Chef-style configuration management) for node/OS-level config and consistency where Ansible is not enough (e.g. OS hardening, package pinning, audit).
- Introduce **Jenkins** (or equivalent) for CI/CD: build images, run test suites, deploy via Ansible/Terraform, with pipelines as code and artifact storage.

## Scope (planning)

1. **Chef**
   - Role: Complement Ansible (e.g. Chef for node baseline, Ansible for app/K8s deploy), or phased migration.
   - Artifacts: Cookbooks/recipes for record-platform nodes (if any dedicated nodes), or policyfiles for consistency.
   - Integration: Triggered by Jenkins or manual; no duplicate work with Ansible where Ansible is sufficient.

2. **Jenkins**
   - Role: Pipeline for build → test (preflight + suites, k6, pgbench) → deploy (Terraform apply, Ansible playbooks).
   - Artifacts: Jenkinsfile(s), shared libraries, credentials (Vault or Jenkins credentials), test result archives.
   - Integration: Call existing scripts (`bootstrap-platform.sh`, `run-preflight-scale-and-all-suites.sh`, `load-all-dbs-millions.sh`, etc.); no rewrites.

## Decisions (to be made)

- [ ] Chef: Adopt Chef Infra vs Chef Solo vs another CM; how to avoid overlap with Ansible.
- [ ] Jenkins: Single controller vs agents; where it runs (K8s vs dedicated VM).
- [ ] Order: Jenkins first (automate current scripts) vs Chef first (harden nodes) vs parallel POC.

## Next steps

- Document current Ansible playbook boundaries so Chef scope is clear.
- Draft a single Jenkins pipeline that runs preflight + one suite and stores artifacts.
- Produce a one-page diagram: Terraform → Ansible → (Chef?) → Jenkins → K8s / Docker Compose.
