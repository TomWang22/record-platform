NS ?= record-platform

.PHONY: apply probes postinit pg-hba-dev import-sample smoke explain

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
