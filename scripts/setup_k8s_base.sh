#!/usr/bin/env bash
# file: scripts/setup_k8s_base.sh
# why: fail fast; reproducible setup
set -euo pipefail

BASE="infra/k8s/base"

mkdir -p "$BASE/redis" "$BASE/postgres"

# --- Redis ---
cat > "$BASE/redis/kustomization.yaml" <<'YAML'
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources: [deploy.yaml, service.yaml]
namespace: record-platform
YAML

cat > "$BASE/redis/deploy.yaml" <<'YAML'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: redis
  labels: { app: redis }
spec:
  replicas: 1
  selector: { matchLabels: { app: redis } }
  template:
    metadata:
      labels: { app: redis }
    spec:
      containers:
        - name: redis
          image: redis:7-alpine
          args: ["--save","", "--appendonly","no"]
          ports:
            - { name: redis, containerPort: 6379 }
          readinessProbe:
            tcpSocket: { port: redis }
            initialDelaySeconds: 3
          livenessProbe:
            tcpSocket: { port: redis }
            initialDelaySeconds: 5
YAML

cat > "$BASE/redis/service.yaml" <<'YAML'
apiVersion: v1
kind: Service
metadata:
  name: redis
  labels: { app: redis }
spec:
  selector: { app: redis }
  ports:
    - { name: redis, port: 6379, targetPort: redis }
YAML

# --- Postgres ---
cat > "$BASE/postgres/kustomization.yaml" <<'YAML'
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deploy.yaml
  - service.yaml
namespace: record-platform
YAML

cat > "$BASE/postgres/deploy.yaml" <<'YAML'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres
  labels: { app: postgres }
spec:
  replicas: 1
  selector: { matchLabels: { app: postgres } }
  template:
    metadata:
      labels: { app: postgres }
    spec:
      containers:
        - name: db
          image: postgres:16-alpine
          env:
            - { name: POSTGRES_PASSWORD, value: "postgres" }
          ports:
            - { name: psql, containerPort: 5432 }
          readinessProbe:
            exec: { command: ["pg_isready","-U","postgres"] }
            initialDelaySeconds: 5
          livenessProbe:
            exec: { command: ["pg_isready","-U","postgres"] }
            initialDelaySeconds: 10
          volumeMounts:
            - { name: data, mountPath: /var/lib/postgresql/data }
      volumes:
        - name: data
          emptyDir: {}
YAML

cat > "$BASE/postgres/service.yaml" <<'YAML'
apiVersion: v1
kind: Service
metadata:
  name: postgres
  labels: { app: postgres }
spec:
  selector: { app: postgres }
  ports:
    - { name: psql, port: 5432, targetPort: psql }
YAML

echo "Created:"
echo " - $BASE/redis/{kustomization.yaml,deploy.yaml,service.yaml}"
echo " - $BASE/postgres/{kustomization.yaml,deploy.yaml,service.yaml}"