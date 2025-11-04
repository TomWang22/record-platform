# scripts/gen-service.sh
#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <service-name> <port> [<image>]"
  exit 1
fi

name="$1"
port="$2"
image="${3:-ghcr.io/yourorg/${name}:dev}"

dir="infra/k8s/base/${name}"
mkdir -p "$dir"

cat > "${dir}/deploy.yaml" <<YAML
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
  namespace: record-platform
  labels: { app: ${name} }
spec:
  replicas: 2
  selector: { matchLabels: { app: ${name} } }
  template:
    metadata:
      labels: { app: ${name} }
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "${port}"
        prometheus.io/path: "/metrics"
    spec:
      containers:
        - name: app
          image: ${image}
          imagePullPolicy: IfNotPresent
          ports: [{ containerPort: ${port}, name: http }]
          envFrom:
            - configMapRef: { name: app-config }
            - secretRef:    { name: app-secrets }
          readinessProbe:
            httpGet: { path: /healthz, port: ${port} }
            initialDelaySeconds: 5
          livenessProbe:
            httpGet: { path: /healthz, port: ${port} }
            initialDelaySeconds: 15
          resources:
            requests: { cpu: "200m", memory: "256Mi" }
            limits:   { cpu: "1",    memory: "512Mi" }
YAML

cat > "${dir}/service.yaml" <<YAML
apiVersion: v1
kind: Service
metadata:
  name: ${name}
  namespace: record-platform
  labels: { app: ${name} }
spec:
  selector: { app: ${name} }
  ports:
    - name: http
      port: ${port}
      targetPort: http
YAML

echo "✔ ${dir}/deploy.yaml"
echo "✔ ${dir}/service.yaml"
