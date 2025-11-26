# Kubernetes namespace
resource "kubernetes_namespace" "main" {
  metadata {
    name = var.namespace
    labels = local.common_labels
  }
}

# Kubernetes ConfigMaps for application configuration
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
  }
}

# Note: Outputs moved to outputs.tf

