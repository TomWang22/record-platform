# -------- Makefile (repo root) --------
# Use: make help

COMPOSE := docker compose

# All services as named in docker-compose.yml (order matters a bit for readability)
SERVICES := \
  zookeeper kafka redis postgres prometheus grafana \
  auth-service records-service listings-service analytics-service \
  cron-jobs auction-monitor api-gateway webapp python-ai-service \
  haproxy nginx

# Only include services that actually have Docker health checks.
HEALTH_WAIT_SERVICES ?= postgres zookeeper kafka auth-service records-service listings-service analytics-service api-gateway

# Default service for service-specific logs/rebuild/restart:
SRV ?= records-service

BACKUPS_DIR := backups

# ---------- Quick waits ----------
.PHONY: wait-api wait-all logs-recent

## Wait until HTTP 200 from the public API (via nginx)
wait-api:
	@echo "Waiting for API gateway (via nginx)…"
	@bash -lc 'for i in $$(seq 1 180); do \
	  code=$$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/healthz || true); \
	  if [ "$$code" = "200" ]; then echo "  try /api/healthz -> 200"; echo "API ready at /api/healthz"; exit 0; fi; \
	  sleep 2; \
	done; echo "API not ready"; $(COMPOSE) ps; exit 1'

## Wait until docker health checks are "healthy" for core services, ensure nginx is running,
## verify gateway is reachable *from* nginx, then confirm external /api/healthz
wait-all:
	@set -e; \
	for s in $(HEALTH_WAIT_SERVICES); do \
	  cid=$$($(COMPOSE) ps -q $$s); \
	  if [ -z "$$cid" ]; then echo "✗ $$s not created (run: make up)"; exit 1; fi; \
	  echo "… waiting for $$s to be healthy"; \
	  until [ "$$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}starting{{end}}' $$cid)" = "healthy" ]; do \
	    status=$$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}starting{{end}}' $$cid); \
	    echo "   $$s: $$status"; sleep 2; \
	  done; \
	  echo "✓ $$s healthy"; \
	done; \
	ng=$$($(COMPOSE) ps -q nginx); \
	if [ -z "$$ng" ]; then echo "✗ nginx not created (run: make up)"; exit 1; fi; \
	echo "… waiting for nginx to be running"; \
	until [ "$$(docker inspect -f '{{.State.Status}}' $$ng)" = "running" ]; do \
	  st=$$(docker inspect -f '{{.State.Status}}' $$ng); echo "   nginx: $$st"; sleep 1; \
	done; \
	echo "✓ nginx running"; \
	echo "… checking gateway DNS from nginx"; \
	$(COMPOSE) exec -T nginx sh -lc "curl -sS api-gateway:4000/healthz | grep -q '\"ok\":true'" \
	  && echo "✓ gateway DNS ok" || { echo "✗ nginx cannot reach api-gateway:4000"; exit 1; }; \
	$(MAKE) wait-api

## Show recent logs for key services (override N=300)
logs-recent:
	@N=$${N:-300}; echo "Last $$N lines from key services:"; \
	$(COMPOSE) logs --since=10m api-gateway records-service nginx postgres | tail -n $$N

# ---------- Lifecycle ----------
.PHONY: up up-all start-all stop-all restart-all ps logs logs-all rebuild build-all build-nc wait

## Create containers if needed & start ALL services (detached)
up:
	$(COMPOSE) up -d $(SERVICES)

## up + block until key services report healthy and API is live
up-all: up wait-all

## Start previously created containers (won’t build or create)
start-all:
	$(COMPOSE) start $(SERVICES)

## Stop containers (keeps them + volumes)
stop-all:
	$(COMPOSE) stop $(SERVICES)

## Restart core containers, wait, then restart nginx (so it resolves fresh), then confirm API
restart-all:
	$(COMPOSE) restart zookeeper kafka redis postgres prometheus grafana \
	  auth-service records-service listings-service analytics-service \
	  cron-jobs auction-monitor api-gateway webapp python-ai-service haproxy
	$(MAKE) wait-all
	$(COMPOSE) restart nginx
	$(MAKE) wait-api

ps:
	$(COMPOSE) ps

## Tail logs for one service (override with SRV=api-gateway)
logs:
	$(COMPOSE) logs -f $(SRV)

## Tail logs for ALL services
logs-all:
	$(COMPOSE) logs -f

## Rebuild and redeploy one service
rebuild:
	$(COMPOSE) build $(SRV) && $(COMPOSE) up -d $(SRV)

## Build all images (cache ok)
build-all:
	$(COMPOSE) build $(SERVICES)

## Build all images (no cache)
build-nc:
	$(COMPOSE) build --no-cache $(SERVICES)

## Wait until HEALTH=healthy for a set of services (no external /api check)
wait:
	@set -e; \
	for s in $(HEALTH_WAIT_SERVICES); do \
	  cid=$$($(COMPOSE) ps -q $$s); \
	  if [ -z "$$cid" ]; then echo "✗ $$s not created (run: make up)"; exit 1; fi; \
	  echo "… waiting for $$s to be healthy"; \
	  until [ "$$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}starting{{end}}' $$cid)" = "healthy" ]; do \
	    status=$$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}starting{{end}}' $$cid); \
	    echo "   $$s: $$status"; sleep 2; \
	  done; \
	  echo "✓ $$s healthy"; \
	done

# ---------- DB backups (records schema only) ----------
.PHONY: backup list-backups restore

## Dump schema 'records' to backups/records_YYYY-MM-DD_HHMM.sql.gz
backup:
	mkdir -p $(BACKUPS_DIR)
	$(COMPOSE) exec -T postgres \
	  pg_dump -U postgres -d records -n records | gzip > $(BACKUPS_DIR)/records_$$(date +%F_%H%M).sql.gz
	@echo "Wrote backup(s):"; ls -lh $(BACKUPS_DIR)

list-backups:
	@ls -lh $(BACKUPS_DIR) 2>/dev/null || echo "No backups yet."

## Restore a backup file: make restore FILE=backups/records_YYYY-MM-DD_HHMM.sql.gz
restore:
	@test -n "$(FILE)" || (echo "ERROR: pass FILE=path/to/backup.sql.gz"; exit 1)
	$(COMPOSE) exec -T postgres psql -U postgres -d records -c "CREATE SCHEMA IF NOT EXISTS records;"
	zcat "$(FILE)" | $(COMPOSE) exec -T postgres psql -U postgres -d records

# ---------- Cleanup ----------
.PHONY: down prune deep-clean

## Stop and remove containers (keeps volumes; DB SAFE)
down:
	$(COMPOSE) down

## Remove stopped containers/images/networks (keeps volumes; DB SAFE)
prune:
	docker system prune -f

## NUKE containers + VOLUMES (DB LOST) — confirm required
deep-clean:
	@test "$(CONFIRM)" = "YES" || (echo "Refusing. Run: make deep-clean CONFIRM=YES"; exit 2)
	$(COMPOSE) down -v --remove-orphans
	docker system prune -af

# ---------- E2E ----------
.PHONY: e2e
e2e:
	./scripts/e2e_records.sh

# ---------- Help ----------
.PHONY: help
help:
	@awk 'BEGIN{FS=":.*##"; printf "\nTargets:\n"} /^[a-zA-Z0-9_-]+:.*##/{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST); echo ""