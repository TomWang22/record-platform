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

