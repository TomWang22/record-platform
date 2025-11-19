NS ?= record-platform
DB ?= records
BUNDLE ?= pg_bundle.tgz
CLEAN ?= 0

export NS DB BUNDLE CLEAN

.PHONY: apply probes postinit pg-hba-dev import-sample smoke explain db.pod db.psql db.progress db.restore db.import pg.pvc.ensure pg.deploy pg.scale0 pg.scale1 pg.restore.dump pg.bootstrap.basebackup pg.sanity pg.space pg.wipe pg.backups.loader pg.backups.loader.rm pg.restore.upload pg.debug.perms

apply:
	kubectl -n $(NS) apply -f k8s/all.yaml

probes:
	./scripts/patch-records-probes.sh "$(NS)"

postinit:
	kubectl -n $(NS) delete job/postgres-postinit --ignore-not-found
	kubectl -n $(NS) apply -f k8s/postgres-postinit-sql-configmap.yaml
	kubectl -n $(NS) apply -f k8s/postgres-postinit-job.yaml
	kubectl -n $(NS) logs -f job/postgres-postinit --tail=200

pg-hba-dev:
	./scripts/pg_hba_dev_permissive.sh "$(NS)"

import-sample:
	./scripts/import-sample-data.sh "$(NS)" "$(USER_ID)" "$(N)"

smoke:
	./scripts/smoke.sh "$(NS)"

explain:
	./scripts/explain.sh "$(NS)" "$(USER_ID)"

db.pod:
	@kubectl -n $(NS) get pod -l app=postgres -o name

db.psql:
	@scripts/psql.sh

db.progress:
	@scripts/progress.sh

db.restore:
	@scripts/restore_pg_bundle.sh

db.import:
	@scripts/import_records_csv.sh records.csv

# Postgres infrastructure targets
pg.pvc.ensure:
	@echo "-> Ensuring PVCs exist (create-if-missing)..."
	@kubectl -n $(NS) get pvc pgdata-big >/dev/null 2>&1 || \
	  kubectl -n $(NS) create -f infra/k8s/base/postgres/pvc-big.yaml
	@kubectl -n $(NS) get pvc pg-wal-archive >/dev/null 2>&1 || \
	  kubectl -n $(NS) create -f infra/k8s/base/postgres/wal-archive-pvc.yaml

pg.deploy: pg.pvc.ensure
	@echo "-> Applying postgres infrastructure..."
	kubectl -n $(NS) apply -f infra/k8s/base/postgres/secret.superuser.yaml
	kubectl -n $(NS) apply -f infra/k8s/base/postgres/deploy.yaml
	kubectl -n $(NS) apply -f infra/k8s/base/postgres/svc.yaml
	@echo "-> Waiting for rollout..."
	kubectl -n $(NS) rollout status deploy/postgres --timeout=300s

pg.scale0:
	@echo "-> Scaling postgres to 0 replicas..."
	kubectl -n $(NS) scale deploy/postgres --replicas=0
	kubectl -n $(NS) rollout status deploy/postgres --timeout=120s || true

pg.scale1:
	@echo "-> Scaling postgres to 1 replica..."
	kubectl -n $(NS) scale deploy/postgres --replicas=1
	kubectl -n $(NS) rollout status deploy/postgres --timeout=300s

pg.restore.dump:
	@echo "-> Running restore-from-dump job..."
	kubectl -n $(NS) delete job/restore-from-dump --ignore-not-found
	kubectl -n $(NS) apply -f infra/k8s/overlays/dev/jobs/restore-from-dump.yaml
	@echo "-> Waiting for job to complete..."
	kubectl -n $(NS) wait --for=condition=complete --timeout=600s job/restore-from-dump || true
	@echo "-> Job logs:"
	kubectl -n $(NS) logs job/restore-from-dump --tail=50

pg.bootstrap.basebackup:
	@echo "-> WARNING: This will wipe PGDATA and restore from basebackup!"
	@read -p "Continue? [y/N] " -n 1 -r; \
	echo; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		kubectl -n $(NS) delete job/bootstrap-from-basebackup --ignore-not-found; \
		kubectl -n $(NS) apply -f infra/k8s/overlays/dev/jobs/bootstrap-from-basebackup.yaml; \
		echo "-> Waiting for job to complete..."; \
		kubectl -n $(NS) wait --for=condition=complete --timeout=1800s job/bootstrap-from-basebackup || true; \
		echo "-> Job logs:"; \
		kubectl -n $(NS) logs job/bootstrap-from-basebackup --tail=50; \
	fi

pg.sanity:
	@echo "-> Running postgres sanity checks..."
	@scripts/pg/space-check.sh || true
	@echo ""
	@echo "-> Checking schemas and tables..."
	@kubectl -n $(NS) exec -i deploy/postgres -c db -- psql -U postgres -d $(DB) -X -P pager=off <<'SQL' || true
	SELECT 
	  schemaname,
	  COUNT(*) AS table_count,
	  pg_size_pretty(SUM(pg_total_relation_size(schemaname||'.'||tablename))) AS total_size
	FROM pg_tables 
	WHERE schemaname IN ('records', 'auth', 'public')
	GROUP BY schemaname
	ORDER BY schemaname;
	SQL
	@echo ""
	@echo "-> Checking materialized views..."
	@kubectl -n $(NS) exec -i deploy/postgres -c db -- psql -U postgres -d $(DB) -X -P pager=off <<'SQL' || true
	SELECT 
	  schemaname||'.'||matviewname AS mv_name,
	  pg_size_pretty(pg_total_relation_size(schemaname||'.'||matviewname)) AS size
	FROM pg_matviews
	WHERE schemaname = 'records'
	ORDER BY matviewname;
	SQL
	@echo ""
	@echo "-> Row counts:"
	@kubectl -n $(NS) exec -i deploy/postgres -c db -- psql -U postgres -d $(DB) -X -P pager=off <<'SQL' || true
	SELECT 
	  'records.records' AS table_name,
	  to_char(count(*), '9,999,999') AS row_count
	FROM records.records
	UNION ALL
	SELECT 
	  'auth.users' AS table_name,
	  to_char(count(*), '9,999,999') AS row_count
	FROM auth.users;
	SQL

pg.space:
	@scripts/pg/space-check.sh

pg.wipe:
	@echo "-> WARNING: This will completely wipe PGDATA!"
	@read -p "Continue? [y/N] " -n 1 -r; \
	echo; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		kubectl -n $(NS) scale deploy/postgres --replicas=0; \
		kubectl -n $(NS) rollout status deploy/postgres --timeout=120s || true; \
		kubectl -n $(NS) delete job/pgdata-wipe-full --ignore-not-found; \
		kubectl -n $(NS) apply -f infra/k8s/jobs/pgdata-wipe-full.yaml; \
		echo "-> Waiting for wipe job to complete..."; \
		kubectl -n $(NS) wait --for=condition=complete --timeout=300s job/pgdata-wipe-full || true; \
		echo "-> Wipe job logs:"; \
		kubectl -n $(NS) logs job/pgdata-wipe-full --tail=100; \
	fi

pg.backups.loader:
	@echo "-> Creating backups-loader pod..."
	@kubectl -n $(NS) get pod backups-loader >/dev/null 2>&1 && echo "backups-loader already exists" || \
	  kubectl -n $(NS) apply -f infra/k8s/jobs/backups-loader-pod.yaml
	@echo "-> Waiting for pod to be ready..."
	@kubectl -n $(NS) wait --for=condition=ready --timeout=60s pod/backups-loader || true
	@echo "-> backups-loader ready. Use: kubectl -n $(NS) cp <file> backups-loader:/backups/"

pg.backups.loader.rm:
	@echo "-> Deleting backups-loader pod..."
	@kubectl -n $(NS) delete pod backups-loader --ignore-not-found
	@echo "-> backups-loader removed"

pg.restore.upload:
	@if [ -z "$(FILE)" ]; then \
	  echo "ERROR: FILE is required. Usage: make pg.restore.upload FILE=./records_dump_20251102.tar.gz"; \
	  exit 1; \
	fi
	@if [ ! -f "$(FILE)" ]; then \
	  echo "ERROR: File not found: $(FILE)"; \
	  exit 1; \
	fi
	@echo "-> Ensuring backups-loader pod is running..."
	@kubectl -n $(NS) get pod backups-loader >/dev/null 2>&1 || \
	  kubectl -n $(NS) apply -f infra/k8s/jobs/backups-loader-pod.yaml
	@kubectl -n $(NS) wait --for=condition=ready --timeout=60s pod/backups-loader || true
	@echo "-> Uploading $(FILE) to backups-loader:/backups/..."
	@kubectl -n $(NS) cp "$(FILE)" backups-loader:/backups/$(shell basename "$(FILE)")
	@echo "-> File uploaded. Starting restore job..."
	@kubectl -n $(NS) delete job/restore-from-upload --ignore-not-found
	@kubectl -n $(NS) apply -f infra/k8s/jobs/restore-from-upload.yaml
	@echo "-> Waiting for restore job to complete..."
	@kubectl -n $(NS) wait --for=condition=complete --timeout=1800s job/restore-from-upload || true
	@echo "-> Restore job logs (last 50 lines):"
	@kubectl -n $(NS) logs job/restore-from-upload --tail=50 || true

pg.debug.perms:
	@echo "-> Debugging postgres permissions and mounts..."
	@P=$$(kubectl -n $(NS) get pod -l app=postgres -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo ""); \
	if [ -z "$$P" ]; then \
	  echo "ERROR: No postgres pod found"; \
	  exit 1; \
	fi; \
	echo "Pod: $$P"; \
	echo ""; \
	echo "=== Volume Mounts (db container) ==="; \
	kubectl -n $(NS) get pod "$$P" -o jsonpath='{range .spec.containers[?(@.name=="db")].volumeMounts[*]}{.mountPath} -> {.name}{"\n"}{end}' || true; \
	echo ""; \
	echo "=== ID inside pod ==="; \
	kubectl -n $(NS) exec -it "$$P" -c db -- id 2>&1 | tail -50 || echo "Cannot exec"; \
	echo ""; \
	echo "=== Directory permissions ==="; \
	kubectl -n $(NS) exec -it "$$P" -c db -- ls -ld /var/lib/postgresql /var/lib/postgresql/data /var/run/postgresql 2>&1 | tail -50 || echo "Cannot exec"; \
	echo ""; \
	echo "=== Init container logs (fix-run) - last 50 lines ==="; \
	kubectl -n $(NS) logs "$$P" -c fix-run --tail=100 2>&1 | tail -50 || echo "No logs"; \
	echo ""; \
	echo "=== Init container logs (prep-dirs) - last 50 lines ==="; \
	kubectl -n $(NS) logs "$$P" -c prep-dirs --tail=100 2>&1 | tail -50 || echo "No logs"; \
	echo ""; \
	echo "=== Main container logs (db) - last 50 lines ==="; \
	kubectl -n $(NS) logs "$$P" -c db --tail=200 2>&1 | tail -50 || echo "No logs"
