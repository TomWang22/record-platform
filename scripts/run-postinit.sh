# scripts/run-postinit.sh  (drop-in replacement)
#!/usr/bin/env bash
set -euo pipefail

NS="${NS:-record-platform}"
JOB_NAME="postgres-postinit"

# Recreate job each run (why: Job spec is immutable; recreate is deterministic)
kubectl -n "$NS" delete job/"$JOB_NAME" --ignore-not-found=true >/dev/null 2>&1 || true

# Ensure CM+Job are applied
kubectl -n "$NS" apply -f infra/k8s/overlays/dev/jobs/postgres-postinit-sql-cm.yaml
kubectl -n "$NS" apply -f infra/k8s/overlays/dev/jobs/postgres-postinit-job.yaml

# Wait for the pod to be created
echo "Waiting for Job pod to be scheduled..."
for i in {1..60}; do
  POD="$(kubectl -n "$NS" get pod -l job-name="$JOB_NAME" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  [[ -n "${POD:-}" ]] && break
  sleep 1
done
if [[ -z "${POD:-}" ]]; then
  echo "No pod was created for job/$JOB_NAME. Diagnostics:" >&2
  kubectl -n "$NS" describe job/"$JOB_NAME" || true
  kubectl -n "$NS" get events --sort-by=.lastTimestamp | tail -n 80 || true
  exit 1
fi
echo "Pod: $POD"

# If it's still ContainerCreating, wait briefly for Ready (why: logs fail before container starts)
kubectl -n "$NS" wait --for=condition=Ready pod/"$POD" --timeout=120s || {
  echo "Pod not Ready yet; showing pod describe (harmless if still pulling image or mounting CM)..." >&2
  kubectl -n "$NS" describe pod/"$POD" | sed -n '1,200p' >&2 || true
}

# Stream logs; if not started yet this will attach as soon as it starts
echo "Streaming logs:"
kubectl -n "$NS" logs -f "pod/$POD" --container psql --tail=200 || true

# Also ensure the job reaches Complete (or print rich diagnostics)
if ! kubectl -n "$NS" wait --for=condition=Complete job/"$JOB_NAME" --timeout=600s; then
  echo "Job did not Complete. Diagnostics:" >&2
  kubectl -n "$NS" get pod -l job-name="$JOB_NAME" -o wide || true
  kubectl -n "$NS" describe job/"$JOB_NAME" || true
  kubectl -n "$NS" describe pod/"$POD" || true
  kubectl -n "$NS" get events --sort-by=.lastTimestamp | tail -n 120 || true
  exit 1
fi

echo "Post-init finished successfully."
