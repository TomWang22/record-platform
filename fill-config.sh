# fill-config.sh
set -euo pipefail
BASE=infra/k8s/base/config
mkdir -p "$BASE"

cat >"$BASE/app-config.yaml" <<'YAML'
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  NODE_ENV: development
  NEXT_PUBLIC_GATEWAY_URL: http://localhost:8080

  # service ports (used by some apps)
  GATEWAY_PORT: "4000"
  AUTH_PORT: "4001"
  RECORDS_PORT: "4002"
  LISTINGS_PORT: "4003"
  ANALYTICS_PORT: "4004"
  AI_PORT: "5005"

  # External infra from KIND → host (adjust if you later move these into K8s)
  POSTGRES_URL: postgresql://postgres:postgres@host.docker.internal:5432/records
  POSTGRES_URL_AUTH: postgresql://postgres:postgres@host.docker.internal:5432/records?schema=auth
  POSTGRES_URL_RECORDS: postgresql://postgres:postgres@host.docker.internal:5432/records?schema=records
  REDIS_URL: redis://host.docker.internal:6379/0
  KAFKA_BROKER: host.docker.internal:29092

  DEFAULT_CURRENCY: USD
  DEFAULT_FEE_RATE: "0"
YAML

cat >"$BASE/app-secrets.yaml" <<'YAML'
apiVersion: v1
kind: Secret
metadata:
  name: app-secrets
type: Opaque
stringData:
  JWT_SECRET: change_me_super_secret

  # Optional integrations – leave blank or fill in
  DISCOGS_CONSUMER_KEY: ""
  DISCOGS_CONSUMER_SECRET: ""
  DISCOGS_TOKEN: ""
  EBAY_CLIENT_ID: ""
  EBAY_CLIENT_SECRET: ""
  EBAY_OAUTH_TOKEN: ""

  # S3/R2
  S3_ENDPOINT: ""
  S3_ACCESS_KEY_ID: ""
  S3_SECRET_ACCESS_KEY: ""
YAML

echo "✅ Wrote $BASE/app-config.yaml and $BASE/app-secrets.yaml"
