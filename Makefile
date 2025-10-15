COMPOSE := docker compose

SERVICES := \
  zookeeper kafka redis postgres prometheus grafana \
  auth-service records-service listings-service analytics-service \
  cron-jobs auction-monitor api-gateway webapp python-ai-service \
  haproxy nginx

HEALTH_WAIT_SERVICES ?= postgres zookeeper kafka auth-service records-service listings-service analytics-service api-gateway
SRV ?= records-service
BACKUPS_DIR := backups

.PHONY: wait-api wait-all logs-recent \
        up up-all start-all stop-all restart-all ps logs logs-all rebuild build-all build-nc wait \
        backup list-backups restore down prune deep-clean e2e \
        token whoami k6-reads k6-mixed nginx-reload restart-edge \
        haproxy-reload haproxy-conf haproxy-test haproxy-logs haproxy-lint-host haproxy-fix-eol edge-dns scale-gateway help

## Wait until HTTP 200 from the public API (via nginx)
wait-api:
	@echo "Waiting for API gateway (via nginx)…"
	@bash -lc 'for i in $$(seq 1 180); do \
	  code=$$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/healthz || true); \
	  if [ "$$code" = "200" ]; then echo "  try /api/healthz -> 200"; echo "API ready at /api/healthz"; exit 0; fi; \
	  sleep 2; \
	done; echo "API not ready"; $(COMPOSE) ps; exit 1'

## Wait for health checks, ensure nginx up, verify gateway from nginx
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

logs-recent:
	@N=$${N:-300}; echo "Last $$N lines from key services:"; \
	$(COMPOSE) logs --since=10m api-gateway records-service nginx postgres | tail -n $$N

# ---------- Lifecycle ----------
up: ; $(COMPOSE) up -d $(SERVICES)
up-all: up wait-all
start-all: ; $(COMPOSE) start $(SERVICES)
stop-all: ; $(COMPOSE) stop $(SERVICES)

restart-all:
	$(COMPOSE) restart zookeeper kafka redis postgres prometheus grafana \
	  auth-service records-service listings-service analytics-service \
	  cron-jobs auction-monitor api-gateway webapp python-ai-service haproxy
	$(MAKE) wait-all
	$(COMPOSE) restart nginx
	$(MAKE) wait-api

## Restart only edge pieces (PHONY prevents “Nothing to be done”)
restart-edge:
	$(COMPOSE) restart api-gateway haproxy nginx

ps: ; $(COMPOSE) ps
logs: ; $(COMPOSE) logs -f $(SRV)
logs-all: ; $(COMPOSE) logs -f
rebuild: ; $(COMPOSE) build $(SRV) && $(COMPOSE) up -d $(SRV)
build-all: ; $(COMPOSE) build $(SERVICES)
build-nc: ; $(COMPOSE) build --no-cache $(SERVICES)

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

# ---------- DB ----------
backup:
	mkdir -p $(BACKUPS_DIR)
	$(COMPOSE) exec -T postgres \
	  pg_dump -U postgres -d records -n records | gzip > $(BACKUPS_DIR)/records_$$(date +%F_%H%M).sql.gz
	@echo "Wrote backup(s):"; ls -lh $(BACKUPS_DIR)

list-backups:
	@ls -lh $(BACKUPS_DIR) 2>/dev/null || echo "No backups yet."

restore:
	@test -n "$(FILE)" || (echo "ERROR: pass FILE=path/to/backup.sql.gz"; exit 1)
	$(COMPOSE) exec -T postgres psql -U postgres -d records -c "CREATE SCHEMA IF NOT EXISTS records;"
	zcat "$(FILE)" | $(COMPOSE) exec -T postgres psql -U postgres -d records

# ---------- Cleanup ----------
down: ; $(COMPOSE) down
prune: ; docker system prune -f
deep-clean:
	@test "$(CONFIRM)" = "YES" || (echo "Refusing. Run: make deep-clean CONFIRM=YES"; exit 2)
	$(COMPOSE) down -v --remove-orphans
	docker system prune -af

# ---------- E2E ----------
e2e: ; ./scripts/e2e_records.sh

# ---------- LOAD / UTIL ----------
token:
	@EMAIL="$${EMAIL:-t@t.t}" PASS="$${PASS:-p@ssw0rd}" bash scripts/load/get-token.sh

whoami:
	@TOKEN="$$(EMAIL="$${EMAIL:-t@t.t}" PASS="$${PASS:-p@ssw0rd}" bash scripts/load/get-token.sh)"; \
	test -n "$$TOKEN" || { echo "no token"; exit 1; }; \
	TOKEN="$$TOKEN" bash scripts/load/whoami.sh

k6-reads:
	@TOKEN="$$(EMAIL="$${EMAIL:-t@t.t}" PASS="$${PASS:-p@ssw0rd}" bash scripts/load/get-token.sh)"; \
	echo "TOKEN=$${TOKEN:0:16}…"; \
	docker run --rm --network record-platform_default -v "$$PWD:/work" -w /work \
	-e BASE_URL="http://nginx:8080" -e TOKEN="$$TOKEN" \
	-e RATE="$${RATE:-300}" -e VUS="$${VUS:-50}" -e DURATION="$${DURATION:-30s}" \
	-e ACCEPT_429="$${ACCEPT_429:-1}" -e SYNTH_IP="$${SYNTH_IP:-1}" \
	grafana/k6:latest run scripts/load/k6-reads.js

k6-mixed:
	@TOKEN="$$(EMAIL="$${EMAIL:-t@t.t}" PASS="$${PASS:-p@ssw0rd}" bash scripts/load/get-token.sh)"; \
	echo "TOKEN=$${TOKEN:0:16}…"; \
	docker run --rm --network record-platform_default -v "$$PWD:/work" -w /work \
	-e BASE_URL="http://nginx:8080" -e TOKEN="$$TOKEN" \
	-e RATE="$${RATE:-120}" -e VUS="$${VUS:-20}" -e DURATION="$${DURATION:-30s}" \
	-e ACCEPT_429="$${ACCEPT_429:-1}" -e SYNTH_IP="$${SYNTH_IP:-1}" \
	grafana/k6:latest run scripts/load/k6-mixed.js

nginx-reload: ; $(COMPOSE) exec -T nginx nginx -s reload

haproxy-reload:
	-$(COMPOSE) exec -T haproxy sh -lc 'haproxy -c -f /usr/local/etc/haproxy/haproxy.cfg && kill -HUP 1' || $(COMPOSE) restart haproxy

haproxy-conf:
	$(COMPOSE) exec -T haproxy sh -lc 'echo "=== running config ==="; sed -n "1,200p" /usr/local/etc/haproxy/haproxy.cfg; echo; echo "=== haproxy -c ==="; haproxy -c -f /usr/local/etc/haproxy/haproxy.cfg' || true

haproxy-logs:
	$(COMPOSE) logs -f haproxy

haproxy-test:
	docker run --rm --network record-platform_default curlimages/curl:8.7.1 -sSI http://haproxy:8081/healthz | head -n 5 || true
	docker run --rm --network record-platform_default curlimages/curl:8.7.1 -sS  http://haproxy:8404/ | head || true

haproxy-lint-host:
	docker run --rm -v "$$PWD/infra/haproxy/haproxy.cfg:/cfg:ro" haproxy:2.8 haproxy -c -f /cfg

## Fix CRLF and ensure trailing newline on HAProxy cfg (mac-safe)
haproxy-fix-eol:
	@perl -pi -e 's/\r$$//' infra/haproxy/haproxy.cfg
	@awk '1; END{if (NR>0 && $$0 !~ /\n/) print ""}' infra/haproxy/haproxy.cfg > infra/haproxy/haproxy.cfg.new && mv infra/haproxy/haproxy.cfg.new infra/haproxy/haproxy.cfg
	@echo "normalized EOL + ensured trailing newline"

scale-gateway: ; $(COMPOSE) up -d --scale api-gateway=$${N:-3}

edge-dns:
	$(COMPOSE) exec -T nginx sh -lc 'getent hosts api-gateway || true; getent hosts haproxy || true'

help:
	@awk 'BEGIN{FS=":.*##"; printf "\nTargets:\n"} /^[a-zA-Z0-9_-]+:.*##/{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST); echo ""