#!/usr/bin/env bash
set -euo pipefail

GF_URL="${GF_URL:-http://localhost:3000}"
GF_USER="${GF_USER:-admin}"
GF_PASS="${GF_PASS:-admin}"   # use the password you set if you changed it

echo "==> Creating Prometheus data source (default)"
curl -sfS -u "$GF_USER:$GF_PASS" -H "Content-Type: application/json" \
  -X POST "$GF_URL/api/datasources" -d @- <<'JSON' | jq -r '."message" // .name // .datasource.name' || true
{
  "name":"Prometheus",
  "type":"prometheus",
  "access":"proxy",
  "url":"http://prometheus:9090",
  "basicAuth":false,
  "isDefault":true,
  "jsonData":{"timeInterval":"10s"}
}
JSON

echo "==> Creating dashboard: Edge: HAProxy Overview"
curl -sfS -u "$GF_USER:$GF_PASS" -H "Content-Type: application/json" \
  -X POST "$GF_URL/api/dashboards/db" -d @- <<'JSON' | jq -r '.status + ": " + .slug'
{
  "dashboard": {
    "uid": "edge-haproxy-overview",
    "title": "Edge: HAProxy Overview",
    "schemaVersion": 39,
    "refresh": "5s",
    "tags": ["edge","haproxy"],
    "panels": [
      {
        "type": "timeseries",
        "title": "API req/s",
        "gridPos": {"x":0,"y":0,"w":12,"h":8},
        "targets": [
          {"refId":"A","expr":"sum(rate(haproxy_backend_http_responses_total{backend=\"be_api\"}[1m]))"}
        ]
      },
      {
        "type": "timeseries",
        "title": "5xx rate",
        "gridPos": {"x":12,"y":0,"w":12,"h":8},
        "targets": [
          {"refId":"A","expr":"sum(rate(haproxy_backend_http_responses_total{backend=\"be_api\", code=\"5xx\"}[1m]))"}
        ]
      },
      {
        "type": "timeseries",
        "title": "Queue depth",
        "gridPos": {"x":0,"y":8,"w":12,"h":8},
        "targets": [
          {"refId":"A","expr":"sum(haproxy_backend_current_queue{backend=\"be_api\"})"}
        ]
      },
      {
        "type": "timeseries",
        "title": "In-flight sessions",
        "gridPos": {"x":12,"y":8,"w":12,"h":8},
        "targets": [
          {"refId":"A","expr":"sum(haproxy_backend_current_sessions{backend=\"be_api\"})"}
        ]
      }
    ],
    "time": { "from":"now-6h","to":"now" }
  },
  "overwrite": true
}
JSON

echo "==> Done. Open: $GF_URL/d/edge-haproxy-overview"
