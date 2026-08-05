#!/usr/bin/env bash
# Reconcile all external Compose dependencies (11 Postgres + Redis + MinIO).
# Discovers Colima VM address (never hard-codes forever), probes, then writes
# selectorless Service Endpoints + EndpointSlices. Fail closed on ambiguity.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NS="${K8S_NAMESPACE:-${HOUSING_NS:-record-platform}}"
COLIMA_PROFILE="${COLIMA_PROFILE:-default}"
MODE="${1:-reconcile}"
REPORT_PATH="${RP_EXTERNAL_RECONCILE_REPORT:-reports/runtime/external-endpoints-reconcile.json}"

# shellcheck source=lib/rp-resolve-external-dependency-endpoint.sh
source "$SCRIPT_DIR/lib/rp-resolve-external-dependency-endpoint.sh"

bad() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }
info() { echo "ℹ️  $*"; }

_extract_ipv4() { echo "$1" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true; }

# name|container|published_port|protocol|svc|port_name|db_or_bucket
DEPS=(
  "postgres-records|record-platform-postgres-records-1|5433|postgresql|postgres-records-external|postgres|records"
  "postgres-messaging|record-platform-postgres-messaging-1|5434|postgresql|postgres-messaging-external|postgres|messaging"
  "postgres-listings|record-platform-postgres-listings-1|5435|postgresql|postgres-listings-external|postgres|listings"
  "postgres-shopping|record-platform-postgres-shopping-1|5436|postgresql|postgres-shopping-external|postgres|shopping"
  "postgres-auth|record-platform-postgres-auth-1|5437|postgresql|postgres-auth-external|postgres|auth"
  "postgres-auction-monitor-core|record-platform-postgres-auction-monitor-core-1|5438|postgresql|postgres-auction-monitor-core-external|postgres|postgres"
  "postgres-analytics|record-platform-postgres-analytics-1|5439|postgresql|postgres-analytics-external|postgres|analytics"
  "postgres-python-ai|record-platform-postgres-python-ai-1|5440|postgresql|postgres-python-ai-external|postgres|python_ai"
  "postgres-notification|record-platform-postgres-notification-1|5441|postgresql|postgres-notification-external|postgres|notification"
  "postgres-trust|record-platform-postgres-trust-1|5442|postgresql|postgres-trust-external|postgres|trust"
  "postgres-media|record-platform-postgres-media-1|5443|postgresql|postgres-media-external|postgres|media"
  "redis|record-platform-redis-1|6379|redis|redis-external|redis|"
  "minio|record-platform-minio-1|9000|minio|minio-external|s3|record-media"
)

discover() {
  local addr lima
  addr="$(colima status --profile "$COLIMA_PROFILE" 2>&1 | sed -n 's/.*address:[[:space:]]*\([0-9.]*\).*/\1/p' | head -1 || true)"
  addr="$(_extract_ipv4 "$addr")"
  if [[ -z "$addr" ]]; then
    addr="$(colima list 2>/dev/null | awk -v p="$COLIMA_PROFILE" 'NR>1 && $1==p {print $NF; exit}' || true)"
    addr="$(_extract_ipv4 "$addr")"
  fi
  if [[ -z "$addr" ]]; then
    addr="$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' 2>/dev/null || true)"
    addr="$(_extract_ipv4 "$addr")"
  fi
  lima="$(colima ssh --profile "$COLIMA_PROFILE" -- getent hosts host.lima.internal 2>/dev/null | awk '{print $1}' | head -1 || true)"
  lima="$(_extract_ipv4 "$lima")"
  [[ -n "$addr" ]] || bad "Colima address missing for profile=$COLIMA_PROFILE"
  [[ -n "$lima" ]] || bad "host.lima.internal unresolved inside profile=$COLIMA_PROFILE"
  [[ "$addr" != "$lima" ]] || bad "Colima VM address equals host.lima.internal — boundary confusion"
  info "colima_vm=$addr host_lima_internal=$lima" >&2
  printf '%s %s\n' "$addr" "$lima"
}

classify_plane() {
  local name="${1:?}" cname=""
  for row in "${DEPS[@]}"; do
    IFS='|' read -r d c _ <<<"$row"
    if [[ "$d" == "$name" ]]; then cname="$c"; break; fi
  done
  [[ -n "$cname" ]] || bad "unknown dependency $name"
  docker --context colima inspect "$cname" >/dev/null 2>&1 || bad "container $cname not found"
  echo "COLIMA_DEFAULT_DOCKER_CONTAINER"
}

resolve_ip() {
  export TARGET_EXECUTION_PLANE="COLIMA_DEFAULT_DOCKER_CONTAINER"
  export TARGET_SERVICE="$1"
  export TARGET_PORT="$2"
  export TARGET_PROTOCOL="$3"
  export COLIMA_PROFILE
  RP_RESOLVE_EMIT_KV=0 rp_resolve_external_dependency_endpoint
}

_hash() { printf '%s' "$1" | shasum -a 256 | awk '{print $1}'; }

_verify_pg() {
  local ip="$1" port="$2" db="$3"
  local pod
  pod="$(kubectl -n "$NS" get pod -l app=auth-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [[ -n "$pod" ]] && kubectl -n "$NS" exec "$pod" -c app -- node -e 'require("pg")' >/dev/null 2>&1; then
    kubectl -n "$NS" exec "$pod" -c app -- env RP_H="$ip" RP_P="$port" RP_DB="$db" node -e '
const {Client}=require("pg");
(async()=>{
  const c=new Client({host:process.env.RP_H,port:+process.env.RP_P,user:"postgres",password:"postgres",database:process.env.RP_DB,connectionTimeoutMillis:8000});
  try{
    await c.connect();
    const r=await c.query("SELECT current_database() AS db, inet_server_addr() AS addr, inet_server_port() AS port, pg_is_in_recovery() AS recovering, 1 AS ok");
    await c.end();
    if(r.rows[0].ok!==1) process.exit(2);
    process.stdout.write(JSON.stringify(r.rows[0]));
    process.exit(0);
  }catch(e){try{await c.end()}catch{}; process.exit(1);}
})();' 2>/dev/null
    return $?
  fi
  kubectl -n "$NS" delete pod rp-ext-pg-probe --ignore-not-found --wait=false >/dev/null 2>&1 || true
  kubectl -n "$NS" run rp-ext-pg-probe --restart=Never --image=postgres:16-alpine --command -- sleep 90 >/dev/null
  kubectl -n "$NS" wait --for=condition=Ready pod/rp-ext-pg-probe --timeout=90s >/dev/null
  kubectl -n "$NS" exec rp-ext-pg-probe -- env PGPASSWORD=postgres \
    psql -h "$ip" -p "$port" -U postgres -d "$db" -tA \
    -c "SELECT current_database()||'|'||COALESCE(inet_server_addr()::text,'')||'|'||COALESCE(inet_server_port()::text,'')||'|'||pg_is_in_recovery();" 2>/dev/null
  local rc=$?
  kubectl -n "$NS" delete pod rp-ext-pg-probe --ignore-not-found --wait=false >/dev/null 2>&1 || true
  return "$rc"
}

_verify_redis() {
  local ip="$1" port="${2:-6379}"
  local pod
  pod="$(kubectl -n "$NS" get pod -l app=auth-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [[ -n "$pod" ]]; then
    kubectl -n "$NS" exec "$pod" -c app -- env RP_H="$ip" RP_P="$port" node -e '
const net=require("net");
const h=process.env.RP_H,p=+process.env.RP_P;
function cmd(s,c){return new Promise((res,rej)=>{let b="";const t=setTimeout(()=>rej(new Error("timeout")),8000);
s.write(c);s.once("data",d=>{clearTimeout(t);b+=d.toString();res(b);});});}
(async()=>{
  const s=net.createConnection({host:h,port:p});
  await new Promise((r,j)=>{s.on("connect",r);s.on("error",j);});
  const pong=await cmd(s,"*1\r\n$4\r\nPING\r\n");
  if(!pong.includes("+PONG")) process.exit(2);
  const info=await cmd(s,"*2\r\n$4\r\nINFO\r\n$6\r\nserver\r\n");
  const redis_version=(info.match(/redis_version:([^\r\n]+)/)||[])[1]||null;
  const tcp_port=(info.match(/tcp_port:([^\r\n]+)/)||[])[1]||null;
  process.stdout.write(JSON.stringify({pong:true,redis_version,tcp_port}));
  s.end(); process.exit(0);
})().catch(()=>process.exit(1));' 2>/dev/null
    return $?
  fi
  false
}

_verify_minio() {
  local ip="$1" port="$2" bucket="$3"
  local pod
  pod="$(kubectl -n "$NS" get pod -l app=media-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  [[ -z "$pod" ]] && pod="$(kubectl -n "$NS" get pod -l app=auth-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  [[ -n "$pod" ]] || return 1
  kubectl -n "$NS" exec "$pod" -c app -- env RP_H="$ip" RP_P="$port" node -e '
const net=require("net");
const s=net.createConnection({host:process.env.RP_H,port:+process.env.RP_P});
s.on("connect",()=>{process.stdout.write(JSON.stringify({tcp:true})); s.end(); process.exit(0);});
s.on("error",()=>process.exit(1));
setTimeout(()=>process.exit(1),8000);' >/dev/null 2>&1 || return 1
  # Authenticated S3 via mc inside MinIO container (keys not printed to reports).
  docker --context colima exec record-platform-minio-1 sh -c "
mc alias set local http://127.0.0.1:9000 minio minio123 >/dev/null
printf 'rp-maintenance-marker-v1' > /tmp/rp-maint-marker.txt
mc cp /tmp/rp-maint-marker.txt local/${bucket}/rp-maintenance-marker.txt >/dev/null
HASH=\$(mc cat local/${bucket}/rp-maintenance-marker.txt | sha256sum | cut -d' ' -f1)
mc rm local/${bucket}/rp-maintenance-marker.txt >/dev/null
rm -f /tmp/rp-maint-marker.txt
printf '%s' \"\$HASH\"
" 2>/dev/null
}

materialize() {
  local svc="$1" ip="$2" port="$3" port_name="$4" dep="$5" profile="$6" probe_json="$7"
  local prev new_hash old_hash gen input_hash probe_b64
  prev="$(kubectl -n "$NS" get endpoints "$svc" -o jsonpath='{.subsets[0].addresses[0].ip}' 2>/dev/null || true)"
  old_hash="$(_hash "${prev:-none}:${port}")"
  new_hash="$(_hash "${ip}:${port}")"
  gen="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  input_hash="$(_hash "${profile}|${dep}|${ip}|${port}|COLIMA_DEFAULT_DOCKER_CONTAINER")"
  probe_b64="$(printf '%s' "$probe_json" | base64 | tr -d '\n' | cut -c1-120)"
  info "materialize $svc: old=${prev:-none} new=$ip:$port"
  kubectl -n "$NS" apply -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: ${svc}
  namespace: ${NS}
  labels:
    app: ${svc}
    rp.external-dependency: "true"
    rp.dependency-name: ${dep}
  annotations:
    rp.external/generated-at: "${gen}"
    rp.external/colima-profile: "${profile}"
    rp.external/resolver-input-hash: "${input_hash}"
    rp.external/prior-endpoint-hash: "${old_hash}"
    rp.external/new-endpoint-hash: "${new_hash}"
    rp.external/protocol-verification: "PASS"
spec:
  type: ClusterIP
  ports:
    - name: ${port_name}
      port: ${port}
      targetPort: ${port}
---
apiVersion: v1
kind: Endpoints
metadata:
  name: ${svc}
  namespace: ${NS}
  labels:
    app: ${svc}
    rp.external-dependency: "true"
    rp.dependency-name: ${dep}
  annotations:
    rp.external/generated-at: "${gen}"
    rp.external/colima-profile: "${profile}"
    rp.external/resolver-input-hash: "${input_hash}"
    rp.external/prior-endpoint-hash: "${old_hash}"
    rp.external/new-endpoint-hash: "${new_hash}"
    rp.external/protocol-verification: "PASS"
subsets:
  - addresses:
      - ip: ${ip}
    ports:
      - name: ${port_name}
        port: ${port}
        protocol: TCP
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: ${svc}
  namespace: ${NS}
  labels:
    kubernetes.io/service-name: ${svc}
    app: ${svc}
    rp.external-dependency: "true"
    rp.dependency-name: ${dep}
  annotations:
    rp.external/generated-at: "${gen}"
    rp.external/colima-profile: "${profile}"
    rp.external/resolver-input-hash: "${input_hash}"
    rp.external/prior-endpoint-hash: "${old_hash}"
    rp.external/new-endpoint-hash: "${new_hash}"
    rp.external/protocol-verification: "PASS"
    rp.external/probe-summary-b64: "${probe_b64}"
addressType: IPv4
ports:
  - name: ${port_name}
    protocol: TCP
    port: ${port}
endpoints:
  - addresses:
      - ${ip}
    conditions:
      ready: true
EOF
}

reconcile_all() {
  local addr lima row dep cname port proto svc pname extra ip plane probe
  read -r addr lima <<<"$(discover)"
  [[ "$addr" != "192.168.5.2" ]] || bad "refusing to use macOS gateway as Colima container endpoint"
  local results=()
  for row in "${DEPS[@]}"; do
    IFS='|' read -r dep cname port proto svc pname extra <<<"$row"
    plane="$(classify_plane "$dep")"
    [[ "$plane" == "COLIMA_DEFAULT_DOCKER_CONTAINER" ]] || bad "unexpected plane for $dep"
    ip="$(resolve_ip "$dep" "$port" "$proto")"
    ip="$(_extract_ipv4 "$ip")"
    [[ "$ip" == "$addr" ]] || bad "$dep resolved $ip != discovered profile address $addr"
    [[ "$ip" != "192.168.5.2" ]] || bad "$dep resolved to stale macOS gateway"
    probe="{}"
    case "$proto" in
      postgresql)
        probe="$(_verify_pg "$ip" "$port" "$extra" || true)"
        [[ -n "$probe" ]] || bad "Postgres protocol probe failed for $dep @ $ip:$port"
        ;;
      redis)
        probe="$(_verify_redis "$ip" "$port" || true)"
        [[ -n "$probe" ]] || bad "Redis protocol probe failed for $dep @ $ip:$port"
        ;;
      minio)
        probe="$(_verify_minio "$ip" "$port" "$extra" || true)"
        [[ -n "$probe" ]] || bad "MinIO protocol probe failed for $dep @ $ip:$port"
        probe="{\"sha256\":\"$probe\",\"tcp\":true}"
        ;;
      *) bad "unknown protocol $proto" ;;
    esac
    materialize "$svc" "$ip" "$port" "$pname" "$dep" "$COLIMA_PROFILE" "$probe"
    # MinIO also publish console port endpoints via second apply patch on Endpoints ports — Service already has both ports; Endpoints for multi-port need both.
    if [[ "$dep" == "minio" ]]; then
      kubectl -n "$NS" apply -f - <<EOF
apiVersion: v1
kind: Endpoints
metadata:
  name: minio-external
  namespace: ${NS}
subsets:
  - addresses:
      - ip: ${ip}
    ports:
      - name: s3
        port: 9000
        protocol: TCP
      - name: console
        port: 9001
        protocol: TCP
EOF
    fi
    ok "$svc → $ip:$port"
    results+=("$dep|$svc|$ip|$port|PASS")
  done
  mkdir -p "$(dirname "$REPORT_PATH")"
  python3 - "$REPORT_PATH" "$addr" "$lima" "$COLIMA_PROFILE" "${results[@]}" <<'PY'
import json,sys
path,addr,lima,profile=sys.argv[1],sys.argv[2],sys.argv[3],sys.argv[4]
rows=[]
for r in sys.argv[5:]:
  d,s,ip,port,st=r.split("|")
  rows.append({"dependency":d,"service":s,"ip":ip,"port":int(port),"status":st})
out={
  "colima_vm":addr,
  "host_lima_internal":lima,
  "profile":profile,
  "stale_192_168_5_2_endpoints":0,
  "services_expected":13,
  "services_present":len(rows),
  "results":rows,
}
json.dump(out, open(path,"w"), indent=2)
print("wrote", path, "count", len(rows))
PY
}

case "$MODE" in
  discover) discover ;;
  classify)
    for row in "${DEPS[@]}"; do
      IFS='|' read -r dep _ <<<"$row"
      echo "$dep=$(classify_plane "$dep")"
    done
    ;;
  resolve)
    read -r addr _ <<<"$(discover)"
    echo "profile_addr=$addr"
    for row in "${DEPS[@]}"; do
      IFS='|' read -r dep _ port proto _ <<<"$row"
      echo "$dep=$(resolve_ip "$dep" "$port" "$proto")"
    done
    ;;
  protocol_verify|materialize|verify|reconcile)
    reconcile_all
    if [[ "$MODE" == "verify" || "$MODE" == "reconcile" ]]; then
      kubectl -n "$NS" get endpoints -l rp.external-dependency=true -o wide
      # fail if any endpoint is .5.2
      bad_eps="$(kubectl -n "$NS" get endpoints -l rp.external-dependency=true -o jsonpath='{range .items[*]}{.metadata.name}{"="}{.subsets[0].addresses[0].ip}{"\n"}{end}' | grep '192.168.5.2' || true)"
      [[ -z "$bad_eps" ]] || bad "stale macOS gateway endpoints remain: $bad_eps"
      ok "external endpoints verified (no 192.168.5.2)"
    fi
    ;;
  *)
    bad "usage: $0 {discover|classify|resolve|protocol_verify|materialize|verify|reconcile}"
    ;;
esac
