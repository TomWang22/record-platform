# Kubernetes namespace
resource "kubernetes_namespace" "main" {
  metadata {
    name = var.namespace
    labels = local.common_labels
  }
}

# Kubernetes ConfigMaps for application configuration
# This creates the base ConfigMap - actual values should come from kustomize
resource "kubernetes_config_map" "app_config" {
  metadata {
    name      = "app-config"
    namespace = kubernetes_namespace.main.metadata[0].name
    labels    = local.common_labels
  }

  data = {
    NODE_ENV              = var.environment
    LOG_LEVEL             = var.environment == "prod" ? "info" : "debug"
    API_GATEWAY_PORT      = tostring(local.service_ports.api_gateway)
    AUTH_SERVICE_PORT     = tostring(local.service_ports.auth_service)
    RECORDS_SERVICE_PORT  = tostring(local.service_ports.records_service)
    LISTINGS_SERVICE_PORT = tostring(local.service_ports.listings_service)
    ANALYTICS_SERVICE_PORT = tostring(local.service_ports.analytics_service)
    SHOPPING_SERVICE_PORT = tostring(local.service_ports.shopping_service)
    SOCIAL_SERVICE_PORT   = tostring(local.service_ports.social_service)
    AUCTION_MONITOR_PORT  = tostring(local.service_ports.auction_monitor)
    PYTHON_AI_SERVICE_PORT = tostring(local.service_ports.python_ai_service)
  }
}

# Note: Most Kubernetes resources are managed via Kustomize
# Terraform is used for initial infrastructure setup (namespace, base configs)
# Full service deployments are handled by Ansible + Kustomize

