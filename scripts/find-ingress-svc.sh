# file: scripts/find-ingress-svc.sh
#!/usr/bin/env bash
set -euo pipefail

# Find ingress-nginx controller Service exposing 443. Broad match (name + labels).
readarray -t CANDIDATES < <(
  kubectl get svc -A -o jsonpath='{range .items[*]}{.metadata.namespace}{"|"}{.metadata.name}{"|"}{range .spec.ports[*]}{.port}{" "}{end}{"|"}{.metadata.labels}{"\n"}{end}' \
  | awk -F'|' '
      function has443(ports) {
        n=split(ports, a, " "); for (i=1;i<=n;i++) if (a[i]=="443") return 1; return 0
      }
      BEGIN{IGNORECASE=1}
      {
        ns=$1; name=$2; ports=$3; labels=$4
        if (!has443(ports)) next
        # name or labels must look like ingress-nginx controller
        if (name ~ /ingress.*nginx.*controller/ || labels ~ /ingress-nginx/ || labels ~ /app.kubernetes.io.name=ingress-nginx/ || labels ~ /k8s-app=ingress-nginx/)
          print ns "|" name
      }' \
  | sort -u
)

if (( ${#CANDIDATES[@]} == 0 )); then
  echo "ERROR: No ingress-nginx controller Service with port 443 found."
  echo "Hint: check 'kubectl get svc -A | egrep -i \"ingress|nginx\"' and ensure the controller is installed."
  exit 1
fi

echo "Detected candidate controller Services (ns|name):"
printf '  - %s\n' "${CANDIDATES[@]}"

# Pick the first by default; allow override via INGRESS_SVC and INGRESS_NS envs
if [[ -n "${INGRESS_NS:-}" && -n "${INGRESS_SVC:-}" ]]; then
  PICK="${INGRESS_NS}|${INGRESS_SVC}"
else
  PICK="${CANDIDATES[0]}"
fi

ING_NS="${PICK%%|*}"
ING_SVC="${PICK##*|}"
FQDN="${ING_SVC}.${ING_NS}.svc.cluster.local"

echo "Using: ns=${ING_NS}, svc=${ING_SVC}, FQDN=${FQDN}"
printf '%s\n' "$FQDN" > /tmp/ingress-controller-fqdn.txt