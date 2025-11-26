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
    api_gateway      = 8080
    auth_service     = 4001
    records_service  = 4002
    listings_service = 4003
    shopping_service = 4007
    social_service   = 4004
    analytics_service = 4005
    auction_monitor  = 4008
    python_ai_service = 4009
  }
}

