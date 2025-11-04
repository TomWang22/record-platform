#!/usr/bin/env bash
set -euo pipefail

ROOT="infra/k8s/base"
NS="record-platform"

mkdir -p "$ROOT"

mk_app(){
  local name="$1" image="$2" port="$3"
  local dir="$ROOT/$name"
  mkdir -p "$dir"

  cat > "$dir/deploy.yaml" <<YAML
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
  namespace: ${NS}
  labels: { app: ${name} }
spec:
  replicas: 1
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
          ports:
            - name: http
              containerPort: ${port}
          env:
            - name: NODE_ENV
              value: "development"
            # TODO: wire the rest via ConfigMaps/Secrets later (DB/Kafka/Redis)
          readinessProbe:
            httpGet: { path: /healthz, port: http }
            initialDelaySeconds: 5
          livenessProbe:
            httpGet: { path: /healthz, port: http }
            initialDelaySeconds: 15
YAML

  cat > "$dir/service.yaml" <<YAML
apiVersion: v1
kind: Service
metadata:
  name: ${name}
  namespace: ${NS}
  labels: { app: ${name} }
spec:
  selector: { app: ${name} }
  ports:
    - name: http
      port: ${port}
      targetPort: http
YAML
}

# Core app services (use your dev images/tags; for now ghcr placeholders)
mk_app api-gateway          ghcr.io/yourorg/api-gateway:dev          4000
mk_app auth-service         ghcr.io/yourorg/auth-service:dev         4001
mk_app records-service      ghcr.io/yourorg/records-service:dev      4002
mk_app listings-service     ghcr.io/yourorg/listings-service:dev     4003
mk_app analytics-service    ghcr.io/yourorg/analytics-service:dev    4004
mk_app python-ai-service    ghcr.io/yourorg/python-ai-service:dev    5005

# HAProxy (uses ConfigMap; Service exposes 8081 + 8404)
HAP="$ROOT/haproxy"
mkdir -p "$HAP"
cat > "$HAP/deploy.yaml" <<'YAML'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: haproxy
  namespace: record-platform
  labels: { app: haproxy }
spec:
  replicas: 1
  selector: { matchLabels: { app: haproxy } }
  template:
    metadata:
      labels: { app: haproxy }
    spec:
      containers:
        - name: proxy
          image: haproxy:2.9
          args: ["-f","/usr/local/etc/haproxy/haproxy.cfg","-db"]
          ports:
            - { name: http,  containerPort: 8081 }
            - { name: stats, containerPort: 8404 }
          volumeMounts:
            - name: haproxy-cm
              mountPath: /usr/local/etc/haproxy/haproxy.cfg
              subPath: haproxy.cfg
      volumes:
        - name: haproxy-cm
          configMap:
            name: haproxy-cm
            items:
              - key: haproxy.cfg
                path: haproxy.cfg
YAML

cat > "$HAP/service.yaml" <<'YAML'
apiVersion: v1
kind: Service
metadata:
  name: haproxy
  namespace: record-platform
  labels: { app: haproxy }
spec:
  selector: { app: haproxy }
  ports:
    - { name: http,  port: 8081, targetPort: http }
    - { name: stats, port: 8404, targetPort: stats }
YAML

# NGINX edge (uses ConfigMap; Service exposes 8080 + 8082)
NGX="$ROOT/nginx"
mkdir -p "$NGX"
cat > "$NGX/deploy.yaml" <<'YAML'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx
  namespace: record-platform
  labels: { app: nginx }
spec:
  replicas: 1
  selector: { matchLabels: { app: nginx } }
  template:
    metadata:
      labels: { app: nginx }
    spec:
      containers:
        - name: edge
          image: nginx:1.27-alpine
          ports:
            - { name: http,  containerPort: 8080 }
            - { name: perf,  containerPort: 8082 }
          readinessProbe:
            httpGet: { path: /healthz, port: http }
            initialDelaySeconds: 5
          livenessProbe:
            httpGet: { path: /healthz, port: http }
            initialDelaySeconds: 10
          volumeMounts:
            - name: nginx-cm
              mountPath: /etc/nginx/nginx.conf
              subPath: nginx.conf
      volumes:
        - name: nginx-cm
          configMap:
            name: nginx-cm
            items:
              - key: nginx.conf
                path: nginx.conf
YAML

cat > "$NGX/service.yaml" <<'YAML'
apiVersion: v1
kind: Service
metadata:
  name: nginx
  namespace: record-platform
  labels: { app: nginx }
spec:
  selector: { app: nginx }
  ports:
    - { name: http, port: 8080, targetPort: http }
    - { name: perf, port: 8082, targetPort: perf }
YAML

# Exporters
EXP="$ROOT/exporters"
mkdir -p "$EXP"
cat > "$EXP/nginx-exporter.yaml" <<'YAML'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-exporter
  namespace: record-platform
  labels: { app: nginx-exporter }
spec:
  replicas: 1
  selector: { matchLabels: { app: nginx-exporter } }
  template:
    metadata:
      labels: { app: nginx-exporter }
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9113"
        prometheus.io/path: "/metrics"
    spec:
      containers:
        - name: exporter
          image: nginx/nginx-prometheus-exporter:0.11.0
          args: ["-nginx.scrape-uri=http://nginx:8080/nginx_status"]
          ports: [{ name: http, containerPort: 9113 }]
---
apiVersion: v1
kind: Service
metadata:
  name: nginx-exporter
  namespace: record-platform
  labels: { app: nginx-exporter }
spec:
  selector: { app: nginx-exporter }
  ports: [{ name: http, port: 9113, targetPort: http }]
YAML

cat > "$EXP/haproxy-exporter.yaml" <<'YAML'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: haproxy-exporter
  namespace: record-platform
  labels: { app: haproxy-exporter }
spec:
  replicas: 1
  selector: { matchLabels: { app: haproxy-exporter } }
  template:
    metadata:
      labels: { app: haproxy-exporter }
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9101"
    spec:
      containers:
        - name: exporter
          image: prom/haproxy-exporter:v0.14.0
          args: ["--haproxy.scrape-uri=http://haproxy:8404/;csv"]
          ports: [{ name: http, containerPort: 9101 }]
---
apiVersion: v1
kind: Service
metadata:
  name: haproxy-exporter
  namespace: record-platform
  labels: { app: haproxy-exporter }
spec:
  selector: { app: haproxy-exporter }
  ports: [{ name: http, port: 9101, targetPort: http }]
YAML

# Kustomization (base)
cat > "$ROOT/kustomization.yaml" <<'YAML'
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: record-platform
resources:
  - api-gateway
  - auth-service
  - records-service
  - listings-service
  - analytics-service
  - python-ai-service
  - haproxy
  - nginx
  - exporters
YAML

echo "✅ Base manifests written under $ROOT"
