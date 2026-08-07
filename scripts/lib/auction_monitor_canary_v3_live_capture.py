#!/usr/bin/env python3
"""
Read-only live cluster capture primitives for canary-v3 production adapters.

Fail-closed observe/scrape only. Exact kubectl/docker command templates;
independent database-equation terms; time-covered leader brackets; primary
RecordMetadata only; log-cursor publisher binding; pinned Docker execution plane.

LIVE_CAPTURE_ACCEPTANCE_READY remains False until regression suite closes all
acceptance blockers. Never mutates outbox rows, throughput, Kafka ACLs, or
canary roots. Window execution remains separately packet-gated.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

TOPIC = "dev.auction_monitor.events"
NAMESPACE = "record-platform"
OBSERVABILITY_NS = "observability"
COMPOSE_PROJECT_DEFAULT = "record-platform"
# Logical Compose service names (durable). Never use these as docker inspect targets.
FROZEN_POSTGRES_COMPOSE_SERVICES: tuple[str, ...] = (
    "postgres-records",
    "postgres-messaging",
    "postgres-listings",
    "postgres-shopping",
    "postgres-auth",
    "postgres-auction-monitor-core",
    "postgres-analytics",
    "postgres-python-ai",
    "postgres-notification",
    "postgres-trust",
    "postgres-media",
)
DEFAULT_POSTGRES_COMPOSE_SERVICE = "postgres-auction-monitor-core"
# Legacy alias — logical Compose service only; not a Docker object name.
POSTGRES_CONTAINER_NAME = DEFAULT_POSTGRES_COMPOSE_SERVICE
KAFKA_BOOTSTRAP = "kafka-0.kafka.record-platform.svc.cluster.local:9093"
KAFKA_COMMAND_CONFIG = "/etc/kafka/secrets/canary-readonly-describe.properties"
STATEMENT_TIMEOUT = "5s"
# Diagnostic-only path for exact full-table count — never on the 5s T0/T1 snapshot.
DIAGNOSTIC_TOTAL_COUNT_TIMEOUT = "300s"
AUCTION_MONITOR_METRICS_URL = "http://127.0.0.1:4008/metrics"

# Attempt 003 blocker: full-table count(*) under 5s (~18s measured). Kept for RCA only.
ATTEMPT_003_BLOCKING_TOTAL_COUNT_SQL = (
    "SELECT count(*) FROM auction_monitor.outbox_events"
)

# 5s T0/T1 path after query rewrite: exact pending only; total via cheap reltuples estimate.
DB_COUNTS_SNAPSHOT_5S_SQL = """
SELECT json_build_object(
  'pending', (SELECT count(*) FROM auction_monitor.outbox_events WHERE published=false),
  'total_estimate', (
    SELECT GREATEST(COALESCE(c.reltuples, 0), 0)::bigint
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'auction_monitor' AND c.relname = 'outbox_events'
  ),
  'db_now', now()::text
)::text
"""

LIVE_CAPTURE_ACCEPTANCE_READY = False

DEFAULT_BATCH_LIMIT = 25
DEFAULT_POLL_INTERVAL_S = 0.5
DEFAULT_PUBLISHER_TICK_TIMEOUT_S = 130.0
DEFAULT_LIFECYCLE_BIND_TIMEOUT_S = 90.0

EXPECTED_OBSERVABILITY_PODS: Mapping[str, int] = {
    "app=jaeger": 1,
    "app=jaeger-storage": 1,
    "app=otel-collector": 1,
}

# Auction-monitor canary topic denominator (three-broker plane).
EXPECTED_AUCTION_MONITOR_TOPIC_PARTITIONS = 3
VALID_KAFKA_BROKER_IDS: frozenset[int] = frozenset({0, 1, 2})

_CONTAINER_ID_RE = re.compile(r"^[0-9a-f]{12,64}$")
_COMPOSE_LABEL_PROJECT_PREFIX = "label=com.docker.compose.project="
_COMPOSE_LABEL_SERVICE_PREFIX = "label=com.docker.compose.service="

_INDEPENDENT_TERM_KEYS = (
    "created_unpublished",
    "database_acknowledged",
    "reopened",
    "deleted_unpublished",
)

_SQL_MUTATING_PATTERNS = (
    r"\binsert\b",
    r"\bupdate\b",
    r"\bdelete\b",
    r"\bdrop\b",
    r"\balter\b",
    r"\btruncate\b",
    r"\bcreate\b",
    r"\bcopy\b",
    r"\bcall\b",
    r"\bdo\b",
    r"\bexecute\b",
    r"\bsetval\b",
    r"\bnextval\b",
    r"\bpg_terminate_backend\b",
    r"\bpg_cancel_backend\b",
    r"\blo_import\b",
    r"\blo_unlink\b",
    r"\$\$",
)

_CMD_METACHAR_RE = re.compile(r"[`$;|&<>\n\r]|\$\(|\$\{")
_UNICODE_WS_RE = re.compile(r"[\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]")


_CIRCULAR_EQUATION_SOURCES = (
    "total_delta",
    "published_true_delta",
    "derived_from_total",
    "derived_from_published_true",
    "pending_identity",
)

CommandRunner = Callable[..., str]


class LiveCaptureError(RuntimeError):
    """Raised when a read-only capture command fails or is rejected."""


class ForbiddenLiveCaptureCommand(LiveCaptureError):
    """Raised when a command is not on the read-only allowlist."""


@dataclass(frozen=True)
class DockerExecutionPlanePin:
    colima_profile: str
    docker_host: str
    docker_context: str
    compose_project: str
    compose_service: str
    container_id: str
    container_name: str
    image_digest: str


@dataclass(frozen=True)
class LogCursor:
    since_time_utc: str
    known_batch_ids: frozenset[str]


def kafka_describe_template(
    *, namespace: str = NAMESPACE, topic: str = TOPIC
) -> tuple[str, ...]:
    return (
        "kubectl",
        "-n",
        namespace,
        "exec",
        "kafka-0",
        "--",
        "kafka-topics",
        "--bootstrap-server",
        KAFKA_BOOTSTRAP,
        "--command-config",
        KAFKA_COMMAND_CONFIG,
        "--describe",
        "--topic",
        topic,
    )


def kafka_readonly_describe_props_stat_template(
    *, namespace: str = NAMESPACE
) -> tuple[str, ...]:
    """Allowlisted existence/readability check for the readonly describe props artifact."""
    return (
        "kubectl",
        "-n",
        namespace,
        "exec",
        "kafka-0",
        "--",
        "test",
        "-r",
        KAFKA_COMMAND_CONFIG,
    )


def build_readonly_psql_sql(
    select_sql: str, *, statement_timeout: str = STATEMENT_TIMEOUT
) -> str:
    body = select_sql.strip().rstrip(";")
    assert_readonly_sql_payload(body)
    if not re.fullmatch(r"\d+s", statement_timeout):
        raise ForbiddenLiveCaptureCommand("sql_statement_timeout_format_invalid")
    return (
        f"BEGIN READ ONLY; SET LOCAL statement_timeout = '{statement_timeout}'; "
        f"{body}; COMMIT;"
    )


def _normalize_sql_text(sql: str) -> str:
    # Collapse Unicode whitespace tricks before keyword scanning.
    text = _UNICODE_WS_RE.sub(" ", str(sql))
    return " ".join(text.split()).strip()


def assert_readonly_sql_payload(sql: str) -> None:
    if not sql or not str(sql).strip():
        raise ForbiddenLiveCaptureCommand("sql_payload_empty")
    if _UNICODE_WS_RE.search(str(sql)):
        raise ForbiddenLiveCaptureCommand("sql_unicode_whitespace_forbidden")
    text = _normalize_sql_text(sql)
    lower = text.lower()

    if "--" in text or "/*" in text or "*/" in text:
        raise ForbiddenLiveCaptureCommand("sql_comments_forbidden")
    if "$$" in text:
        raise ForbiddenLiveCaptureCommand("sql_dollar_quoting_forbidden")

    if lower.startswith("begin read only"):
        if not re.search(
            r"set\s+local\s+statement_timeout\s*=\s*'\d+s'", lower, flags=re.IGNORECASE
        ):
            raise ForbiddenLiveCaptureCommand("sql_missing_statement_timeout")
        if not lower.rstrip(";").endswith("commit"):
            raise ForbiddenLiveCaptureCommand("sql_missing_commit")
        # Exactly three statements in the wrapper: BEGIN; SET; SELECT; COMMIT
        # counted after normalization — reject smuggled extras.
        inner = _inner_select_from_readonly_tx(text)
        if ";" in inner.rstrip(";"):
            raise ForbiddenLiveCaptureCommand("sql_multiple_statements_forbidden")
        assert_readonly_sql_payload(inner)
        return

    # Mutating WITH (data-modifying CTEs) — reject before the SELECT-only check.
    if re.search(
        r"\bwith\b[\s\S]*\b(insert|update|delete|drop|alter|truncate|create|copy|call|do|execute)\b",
        lower,
    ):
        raise ForbiddenLiveCaptureCommand("sql_mutating_with_forbidden")

    if not (lower.startswith("select") or lower.startswith("with")):
        raise ForbiddenLiveCaptureCommand("sql_not_select_only")

    # Bare payload must be a single statement.
    if ";" in text.rstrip(";"):
        raise ForbiddenLiveCaptureCommand("sql_multiple_statements_forbidden")

    for pattern in _SQL_MUTATING_PATTERNS:
        if re.search(pattern, lower):
            raise ForbiddenLiveCaptureCommand(f"sql_mutating_forbidden:{pattern}")


def _inner_select_from_readonly_tx(wrapped: str) -> str:
    match = re.search(
        r"BEGIN\s+READ\s+ONLY\s*;\s*SET\s+LOCAL\s+statement_timeout\s*=\s*'\d+s'\s*;\s*(.+?)\s*;\s*COMMIT\s*;?\s*$",
        " ".join(wrapped.split()),
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not match:
        raise ForbiddenLiveCaptureCommand("sql_readonly_tx_unparseable")
    return match.group(1).strip()


def _is_kubectl_get_template(args: Sequence[str]) -> bool:
    if len(args) < 5 or args[0] != "kubectl":
        return False
    if "-n" not in args or "get" not in args:
        return False
    verb_idx = args.index("get")
    if verb_idx < 3:
        return False
    # Namespace form: kubectl -n <ns> get ...
    if args[1] != "-n":
        return False
    resource = args[verb_idx + 1] if verb_idx + 1 < len(args) else ""
    if resource not in {"pod", "pods", "deploy", "deployment", "deployments"}:
        return False
    # Read-only output only.
    joined = " ".join(args)
    if any(tok in args for tok in ("-w", "--watch", "--export")):
        return False
    if "-o" not in args and "--output" not in args:
        return False
    forbidden = {"exec", "delete", "apply", "patch", "create", "replace", "scale", "rollout"}
    if forbidden.intersection(args):
        return False
    if "/tmp/" in joined.lower() and "props" in joined.lower():
        return False
    return True


def _is_kubectl_logs_template(args: Sequence[str]) -> bool:
    # kubectl -n <ns> logs <pod> --since-time=<iso>
    if len(args) < 6 or args[0] != "kubectl":
        return False
    if args[1] != "-n" or "logs" not in args:
        return False
    if "exec" in args or "bash" in args:
        return False
    logs_idx = args.index("logs")
    if logs_idx + 1 >= len(args):
        return False
    since = [a for a in args[logs_idx + 2 :] if a.startswith("--since-time=")]
    if len(since) != 1:
        return False
    # Reject open-ended --since= window selection for publisher binding.
    if any(a.startswith("--since=") for a in args):
        return False
    return True


def _is_kafka_describe_template(args: Sequence[str]) -> bool:
    return tuple(args) == kafka_describe_template()


def _is_kafka_readonly_describe_props_stat_template(args: Sequence[str]) -> bool:
    return tuple(args) == kafka_readonly_describe_props_stat_template()


def kubectl_metrics_scrape_template(
    *,
    pod: str,
    namespace: str = NAMESPACE,
    metrics_url: str = AUCTION_MONITOR_METRICS_URL,
) -> tuple[str, ...]:
    """Exact allowlisted kubectl exec template for auction-monitor /metrics."""
    if not pod or pod.startswith("-"):
        raise LiveCaptureError("metrics_scrape_pod_target_invalid")
    return (
        "kubectl",
        "-n",
        namespace,
        "exec",
        pod,
        "--",
        "wget",
        "-qO-",
        metrics_url,
    )


def _is_kubectl_metrics_scrape_template(args: Sequence[str]) -> bool:
    # kubectl -n <ns> exec <pod|deploy/name> -- wget -qO- http://127.0.0.1:4008/metrics
    if len(args) != 9 or args[0] != "kubectl":
        return False
    if args[1] != "-n" or args[3] != "exec" or args[5] != "--":
        return False
    if args[6] != "wget" or args[7] != "-qO-" or args[8] != AUCTION_MONITOR_METRICS_URL:
        return False
    target = args[4]
    if not target or target.startswith("-"):
        return False
    if target.startswith("deploy/"):
        name = target[len("deploy/") :]
        return bool(name) and "/" not in name
    return "/" not in target


def _is_docker_context_show(args: Sequence[str]) -> bool:
    return list(args) == ["docker", "context", "show"]


def _is_docker_ps_compose_label_discovery(args: Sequence[str]) -> bool:
    """Allow only structured Compose-label discovery for frozen Postgres services."""
    # docker ps --quiet
    #   --filter label=com.docker.compose.project=<project>
    #   --filter label=com.docker.compose.service=<service>
    if list(args[:3]) != ["docker", "ps", "--quiet"]:
        return False
    if len(args) != 7:
        return False
    if args[3] != "--filter" or args[5] != "--filter":
        return False
    project_filter = args[4]
    service_filter = args[6]
    if not project_filter.startswith(_COMPOSE_LABEL_PROJECT_PREFIX):
        return False
    if not service_filter.startswith(_COMPOSE_LABEL_SERVICE_PREFIX):
        return False
    project = project_filter[len(_COMPOSE_LABEL_PROJECT_PREFIX) :]
    service = service_filter[len(_COMPOSE_LABEL_SERVICE_PREFIX) :]
    if project != COMPOSE_PROJECT_DEFAULT:
        return False
    if service not in FROZEN_POSTGRES_COMPOSE_SERVICES:
        return False
    return True


def _is_docker_inspect_container_id(args: Sequence[str]) -> bool:
    """Allow docker inspect of a hex container ID only — never a Compose service name."""
    if len(args) < 3 or args[0] != "docker" or args[1] != "inspect":
        return False
    cleaned: list[str] = []
    skip_next = False
    for arg in args[2:]:
        if skip_next:
            skip_next = False
            continue
        if arg in {"--format", "-f"}:
            skip_next = True
            continue
        if arg.startswith("--format="):
            continue
        cleaned.append(arg)
    if len(cleaned) != 1:
        return False
    return bool(_CONTAINER_ID_RE.match(cleaned[0]))


def compose_ps_discovery_argv(
    *,
    compose_project: str = COMPOSE_PROJECT_DEFAULT,
    compose_service: str,
) -> tuple[str, ...]:
    if compose_project != COMPOSE_PROJECT_DEFAULT:
        raise ForbiddenLiveCaptureCommand(
            f"compose_project_not_allowlisted:{compose_project}"
        )
    if compose_service not in FROZEN_POSTGRES_COMPOSE_SERVICES:
        raise ForbiddenLiveCaptureCommand(
            f"compose_service_not_in_postgres_denominator:{compose_service}"
        )
    return (
        "docker",
        "ps",
        "--quiet",
        "--filter",
        f"{_COMPOSE_LABEL_PROJECT_PREFIX}{compose_project}",
        "--filter",
        f"{_COMPOSE_LABEL_SERVICE_PREFIX}{compose_service}",
    )


def discover_compose_container(
    *,
    compose_project: str = COMPOSE_PROJECT_DEFAULT,
    compose_service: str,
    runner: CommandRunner | None = None,
    colima_profile: str | None = None,
    docker_host: str | None = None,
    expected_docker_context: str | None = None,
) -> DockerExecutionPlanePin:
    """Resolve Compose service → exactly one container via labels; pin by inspect ID."""
    active_runner: CommandRunner = runner if runner is not None else default_command_runner
    if compose_service not in FROZEN_POSTGRES_COMPOSE_SERVICES:
        raise LiveCaptureError(
            f"compose_service_not_in_postgres_denominator:{compose_service}"
        )
    if compose_project != COMPOSE_PROJECT_DEFAULT:
        raise LiveCaptureError(f"compose_project_unsupported:{compose_project}")

    context = _run(active_runner, "docker", "context", "show").strip()
    if not context:
        raise LiveCaptureError("docker_context_missing")
    if expected_docker_context is not None and context != expected_docker_context:
        raise LiveCaptureError(
            f"docker_context_mismatch:{context}!={expected_docker_context}"
        )

    host = docker_host if docker_host is not None else os.environ.get("DOCKER_HOST", "")
    profile = (
        colima_profile
        if colima_profile is not None
        else os.environ.get("COLIMA_PROFILE", "default")
    )

    ps_argv = compose_ps_discovery_argv(
        compose_project=compose_project, compose_service=compose_service
    )
    ps_out = _run(active_runner, *ps_argv).strip()
    ids = [line.strip() for line in ps_out.splitlines() if line.strip()]
    # Also accept space-separated IDs on one line from some docker versions.
    if len(ids) == 1 and " " in ids[0]:
        ids = [part for part in ids[0].split() if part]
    if len(ids) == 0:
        raise LiveCaptureError("docker_compose_service_not_found")
    if len(ids) > 1:
        raise LiveCaptureError("docker_compose_service_ambiguous")
    discovered_id = ids[0]
    if not _CONTAINER_ID_RE.match(discovered_id):
        raise LiveCaptureError(f"docker_compose_service_id_malformed:{discovered_id}")

    raw = _run(
        active_runner,
        "docker",
        "inspect",
        "--format",
        "{{json .}}",
        discovered_id,
    ).strip()
    try:
        info = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise LiveCaptureError("docker_inspect_unparseable") from exc

    container_id = str(info.get("Id") or "").strip()
    name = str(info.get("Name") or "").lstrip("/")
    image = str(info.get("Image") or "").strip()
    config = info.get("Config") if isinstance(info.get("Config"), dict) else {}
    labels = config.get("Labels") if isinstance(config.get("Labels"), dict) else {}
    label_project = str(labels.get("com.docker.compose.project") or "")
    label_service = str(labels.get("com.docker.compose.service") or "")

    if not container_id or not name or not image:
        raise LiveCaptureError("docker_execution_plane_incomplete")
    if not container_id.startswith(discovered_id):
        raise LiveCaptureError(
            f"docker_container_id_mismatch:{container_id}!={discovered_id}"
        )
    if label_project != compose_project:
        raise LiveCaptureError(
            f"docker_compose_project_label_mismatch:{label_project}!={compose_project}"
        )
    if label_service != compose_service:
        raise LiveCaptureError(
            f"docker_compose_service_label_mismatch:{label_service}!={compose_service}"
        )

    return DockerExecutionPlanePin(
        colima_profile=profile,
        docker_host=host,
        docker_context=context,
        compose_project=compose_project,
        compose_service=compose_service,
        container_id=container_id,
        container_name=name,
        image_digest=image,
    )


def _is_docker_psql_template(
    args: Sequence[str], *, pinned_container_id: str | None
) -> bool:
    # docker exec <id> psql -U postgres -d postgres -v ON_ERROR_STOP=1 -t -A -c <sql>
    if len(args) < 12 or args[0] != "docker" or args[1] != "exec":
        return False
    if "-i" in args or "-it" in args or "-ti" in args:
        raise ForbiddenLiveCaptureCommand("psql_stdin_forbidden")
    if args[2] in {"-i", "-it", "-ti"}:
        raise ForbiddenLiveCaptureCommand("psql_stdin_forbidden")
    container_id = args[2]
    if pinned_container_id is not None and container_id != pinned_container_id:
        raise ForbiddenLiveCaptureCommand("docker_exec_container_pin_mismatch")
    if not _CONTAINER_ID_RE.match(container_id) and pinned_container_id is None:
        # Without a pin, still require hex-ish IDs (never compose service names).
        if container_id in FROZEN_POSTGRES_COMPOSE_SERVICES:
            raise ForbiddenLiveCaptureCommand("docker_exec_compose_service_name_forbidden")
    expected_prefix = [
        "docker",
        "exec",
        container_id,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-t",
        "-A",
        "-c",
    ]
    if list(args[:13]) != expected_prefix:
        return False
    if len(args) != 14:
        raise ForbiddenLiveCaptureCommand("psql_requires_single_c_sql")
    assert_readonly_sql_payload(args[13])
    return True


def assert_readonly_command(
    args: Sequence[str], *, pinned_container_id: str | None = None
) -> None:
    if not args:
        raise ForbiddenLiveCaptureCommand("empty_command")
    # Exact basename binaries only — reject alternate executable paths.
    head = args[0]
    if head not in {"kubectl", "docker"}:
        raise ForbiddenLiveCaptureCommand(f"binary_not_readonly_allowlisted:{head}")
    joined = " ".join(args)
    if "/tmp/" in joined and "props" in joined.lower():
        raise ForbiddenLiveCaptureCommand("tmp_props_write_forbidden")
    if "bash" in args or "sh" in args or "zsh" in args or "python" in args:
        raise ForbiddenLiveCaptureCommand("shell_exec_forbidden")

    # Metachar scan: exempt the allowlisted psql -c SQL payload (validated separately).
    exempt_indices: set[int] = set()
    if (
        head == "docker"
        and len(args) == 14
        and args[1] == "exec"
        and list(args[3:13])
        == [
            "psql",
            "-U",
            "postgres",
            "-d",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
            "-t",
            "-A",
            "-c",
        ]
    ):
        exempt_indices.add(13)

    for idx, arg in enumerate(args):
        if idx in exempt_indices:
            continue
        if _CMD_METACHAR_RE.search(arg) or _UNICODE_WS_RE.search(arg):
            raise ForbiddenLiveCaptureCommand("command_metachar_or_unicode_ws_forbidden")
        if "\x00" in arg:
            raise ForbiddenLiveCaptureCommand("command_nul_forbidden")

    if head == "kubectl":
        if _is_kafka_describe_template(args):
            return
        if _is_kafka_readonly_describe_props_stat_template(args):
            return
        if _is_kubectl_metrics_scrape_template(args):
            return
        if "exec" in args:
            raise ForbiddenLiveCaptureCommand("kubectl_exec_not_allowlisted")
        if _is_kubectl_get_template(args):
            return
        if _is_kubectl_logs_template(args):
            return
        raise ForbiddenLiveCaptureCommand("kubectl_command_not_allowlisted")

    if head == "docker":
        if "--entrypoint" in args or any(a.startswith("--entrypoint=") for a in args):
            raise ForbiddenLiveCaptureCommand("docker_entrypoint_forbidden")
        if _is_docker_context_show(args):
            return
        if _is_docker_ps_compose_label_discovery(args):
            return
        if _is_docker_inspect_container_id(args):
            return
        if "exec" in args:
            if _is_docker_psql_template(args, pinned_container_id=pinned_container_id):
                return
            raise ForbiddenLiveCaptureCommand("docker_exec_not_allowlisted")
        raise ForbiddenLiveCaptureCommand("docker_command_not_allowlisted")

    raise ForbiddenLiveCaptureCommand(f"binary_not_readonly_allowlisted:{head}")


def default_command_runner(
    *args: str,
    timeout: int = 120,
    pinned_container_id: str | None = None,
) -> str:
    assert_readonly_command(args, pinned_container_id=pinned_container_id)
    try:
        return subprocess.check_output(
            args, text=True, timeout=timeout, stderr=subprocess.STDOUT
        )
    except subprocess.CalledProcessError as exc:
        raise LiveCaptureError(f"command_failed:{args[0]}:{exc.output or exc}") from exc


def _run(
    runner: CommandRunner,
    *args: str,
    pinned_container_id: str | None = None,
) -> str:
    assert_readonly_command(args, pinned_container_id=pinned_container_id)
    if pinned_container_id is not None:
        try:
            return runner(*args, pinned_container_id=pinned_container_id)
        except TypeError:
            return runner(*args)
    return runner(*args)


def _jsonpath(runner: CommandRunner, *kubectl_args: str) -> str:
    return _run(runner, *kubectl_args).strip()


def capture_runtime_pin(
    *,
    runner: CommandRunner = default_command_runner,
    namespace: str = NAMESPACE,
) -> dict[str, Any]:
    pod = _jsonpath(
        runner,
        "kubectl",
        "-n",
        namespace,
        "get",
        "pod",
        "-l",
        "app=auction-monitor",
        "-o",
        "jsonpath={.items[0].metadata.name}",
    )
    if not pod:
        raise LiveCaptureError("auction_monitor_pod_missing")
    uid = _jsonpath(
        runner,
        "kubectl",
        "-n",
        namespace,
        "get",
        "pod",
        pod,
        "-o",
        "jsonpath={.metadata.uid}",
    )
    image = _jsonpath(
        runner,
        "kubectl",
        "-n",
        namespace,
        "get",
        "pod",
        pod,
        "-o",
        "jsonpath={.status.containerStatuses[0].imageID}",
    )
    sha = _jsonpath(
        runner,
        "kubectl",
        "-n",
        namespace,
        "get",
        "deploy",
        "auction-monitor",
        "-o",
        'jsonpath={.spec.template.spec.containers[0].env[?(@.name=="RP_SOURCE_SHA")].value}',
    )
    pin = {
        "pod_name": pod,
        "pod_uid": uid,
        "image_digest": image,
        "oci_revision": sha,
        "RP_SOURCE_SHA": sha,
        "read_only": True,
        "capture_mode": "live_readonly",
    }
    if not all(pin[k] for k in ("pod_uid", "image_digest", "oci_revision", "RP_SOURCE_SHA")):
        raise LiveCaptureError("runtime_pin_incomplete")
    return pin


def _all_containers_ready(statuses: Sequence[Mapping[str, Any]]) -> bool:
    if not statuses:
        return False
    return all(cs.get("ready") is True for cs in statuses)


def _pod_restart_oom_and_ready(
    runner: CommandRunner,
    *,
    namespace: str,
    label: str,
    expected_pods: int,
) -> tuple[int, int, bool, int]:
    raw = _run(
        runner,
        "kubectl",
        "-n",
        namespace,
        "get",
        "pod",
        "-l",
        label,
        "-o",
        "json",
    )
    payload = json.loads(raw)
    items = payload.get("items") or []
    if len(items) != expected_pods:
        raise LiveCaptureError(
            f"observability_pod_denominator_mismatch:{label}:{len(items)}!={expected_pods}"
        )
    restart = 0
    oom = 0
    all_ready = True
    for item in items:
        status = item.get("status") or {}
        container_statuses = list(status.get("containerStatuses") or [])
        if not _all_containers_ready(container_statuses):
            all_ready = False
        for cs in container_statuses:
            restart += int(cs.get("restartCount") or 0)
            last = ((cs.get("lastState") or {}).get("terminated") or {})
            if last.get("reason") == "OOMKilled":
                oom += 1
        for cs in status.get("initContainerStatuses") or []:
            restart += int(cs.get("restartCount") or 0)
            last = ((cs.get("lastState") or {}).get("terminated") or {})
            if last.get("reason") == "OOMKilled":
                oom += 1
    if not all_ready:
        raise LiveCaptureError(f"observability_containers_not_all_ready:{label}")
    return restart, oom, True, len(items)


def capture_observability_snapshot(
    *,
    runner: CommandRunner = default_command_runner,
    captured_at_utc: str,
    observability_namespace: str = OBSERVABILITY_NS,
    expected_pods: Mapping[str, int] | None = None,
) -> dict[str, Any]:
    expected = dict(expected_pods or EXPECTED_OBSERVABILITY_PODS)
    jaeger_restart, jaeger_oom, jaeger_ready, jaeger_count = _pod_restart_oom_and_ready(
        runner,
        namespace=observability_namespace,
        label="app=jaeger",
        expected_pods=int(expected["app=jaeger"]),
    )
    _, _, storage_ready, storage_count = _pod_restart_oom_and_ready(
        runner,
        namespace=observability_namespace,
        label="app=jaeger-storage",
        expected_pods=int(expected["app=jaeger-storage"]),
    )
    otel_restart, _, otel_ready, otel_count = _pod_restart_oom_and_ready(
        runner,
        namespace=observability_namespace,
        label="app=otel-collector",
        expected_pods=int(expected["app=otel-collector"]),
    )
    return {
        "captured_at_utc": captured_at_utc,
        "jaeger_ready": jaeger_ready,
        "jaeger_storage_ready": storage_ready,
        "jaeger_pod_count": jaeger_count,
        "jaeger_storage_pod_count": storage_count,
        "otel_collector_pod_count": otel_count,
        "jaeger_restart_count": jaeger_restart,
        "jaeger_oomkill_count": jaeger_oom,
        "otel_collector_restart_count": otel_restart,
        "otel_collector_ready": otel_ready,
        "expected_pods": expected,
        "read_only": True,
        "capture_mode": "live_readonly",
    }


def capture_docker_execution_plane(
    *,
    runner: CommandRunner | None = None,
    colima_profile: str | None = None,
    docker_host: str | None = None,
    compose_project: str = COMPOSE_PROJECT_DEFAULT,
    compose_service: str = DEFAULT_POSTGRES_COMPOSE_SERVICE,
) -> DockerExecutionPlanePin:
    active_runner: CommandRunner = runner if runner is not None else default_command_runner
    return discover_compose_container(
        compose_project=compose_project,
        compose_service=compose_service,
        runner=active_runner,
        colima_profile=colima_profile,
        docker_host=docker_host,
    )


def verify_docker_execution_plane(
    pin: DockerExecutionPlanePin,
    *,
    runner: CommandRunner | None = None,
) -> DockerExecutionPlanePin:
    active_runner: CommandRunner = runner if runner is not None else default_command_runner
    host_env = os.environ.get("DOCKER_HOST", pin.docker_host)
    if host_env != pin.docker_host:
        raise LiveCaptureError(
            f"docker_host_mismatch:{host_env}!={pin.docker_host}"
        )
    current = discover_compose_container(
        compose_project=pin.compose_project,
        compose_service=pin.compose_service,
        runner=active_runner,
        colima_profile=pin.colima_profile,
        docker_host=pin.docker_host,
        expected_docker_context=pin.docker_context,
    )
    if current.docker_context != pin.docker_context:
        raise LiveCaptureError(
            f"docker_context_mismatch:{current.docker_context}!={pin.docker_context}"
        )
    if current.docker_host != pin.docker_host:
        raise LiveCaptureError(
            f"docker_host_mismatch:{current.docker_host}!={pin.docker_host}"
        )
    if current.container_id != pin.container_id:
        raise LiveCaptureError(
            f"docker_container_id_mismatch:{current.container_id}!={pin.container_id}"
        )
    if current.container_name != pin.container_name:
        raise LiveCaptureError(
            f"docker_container_name_mismatch:{current.container_name}!={pin.container_name}"
        )
    if current.image_digest != pin.image_digest:
        raise LiveCaptureError(
            f"docker_image_digest_mismatch:{current.image_digest}!={pin.image_digest}"
        )
    if current.colima_profile != pin.colima_profile:
        raise LiveCaptureError(
            f"colima_profile_mismatch:{current.colima_profile}!={pin.colima_profile}"
        )
    if current.compose_project != pin.compose_project:
        raise LiveCaptureError(
            f"compose_project_mismatch:{current.compose_project}!={pin.compose_project}"
        )
    if current.compose_service != pin.compose_service:
        raise LiveCaptureError(
            f"compose_service_mismatch:{current.compose_service}!={pin.compose_service}"
        )
    return current


def _psql_json(
    runner: CommandRunner,
    sql: str,
    *,
    pinned_container_id: str,
) -> dict[str, Any]:
    wrapped = build_readonly_psql_sql(sql)
    try:
        raw = _run(
            runner,
            "docker",
            "exec",
            pinned_container_id,
            "psql",
            "-U",
            "postgres",
            "-d",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
            "-t",
            "-A",
            "-c",
            wrapped,
            pinned_container_id=pinned_container_id,
        ).strip()
    except LiveCaptureError as exc:
        if is_live_interval_db_statement_timeout(exc):
            raise LiveCaptureError(
                f"live_interval_db_statement_timeout:budget={STATEMENT_TIMEOUT}"
            ) from exc
        raise
    # BEGIN/COMMIT may yield multiple cells; take last non-empty JSON object line.
    lines = [ln.strip() for ln in raw.splitlines() if ln.strip() and ln.strip() not in {"BEGIN", "COMMIT", "SET"}]
    if not lines:
        return {}
    payload = lines[-1]
    return json.loads(payload)


_STATEMENT_TIMEOUT_RE = re.compile(
    r"canceling statement due to statement timeout",
    re.IGNORECASE,
)


def is_live_interval_db_statement_timeout(exc: BaseException | str) -> bool:
    """True when a T0/T1 5s snapshot was canceled by Postgres statement_timeout."""
    text = str(exc)
    if "live_interval_db_statement_timeout" in text:
        return True
    return bool(_STATEMENT_TIMEOUT_RE.search(text))


def capture_db_counts_snapshot(
    *,
    runner: CommandRunner,
    docker_pin: DockerExecutionPlanePin,
    label: str,
    captured_at_utc: str,
    verify_pin: bool = True,
) -> dict[str, Any]:
    """Read-only T0/T1 outbox counts under STATEMENT_TIMEOUT (5s).

    Query rewrite (db_rca): keep exact ``pending`` count; do **not** run full-table
    ``count(*)`` on the 5s path (attempt 003 blocker ~18s). ``total`` is filled from
    ``pg_class.reltuples`` as an estimate and must not drive equation terms.
    """
    if verify_pin:
        verify_docker_execution_plane(docker_pin, runner=runner)
    try:
        counts = _psql_json(
            runner,
            DB_COUNTS_SNAPSHOT_5S_SQL,
            pinned_container_id=docker_pin.container_id,
        )
    except LiveCaptureError as exc:
        if is_live_interval_db_statement_timeout(exc):
            raise LiveCaptureError(
                f"live_interval_db_statement_timeout:label={label}:budget={STATEMENT_TIMEOUT}"
            ) from exc
        raise
    pending = int(counts["pending"])
    total_estimate = int(counts["total_estimate"])
    return {
        "label": label,
        "captured_at_utc": captured_at_utc,
        "db_now": counts.get("db_now"),
        "pending": pending,
        "total": total_estimate,
        "total_kind": "estimate_reltuples",
        "total_exact": False,
        # Do not derive published_true from an estimate — equation uses pending only.
        "published_true": None,
        "published_true_kind": "not_derived_from_estimate",
        "docker_pin": {
            "container_id": docker_pin.container_id,
            "container_name": docker_pin.container_name,
            "docker_context": docker_pin.docker_context,
            "image_digest": docker_pin.image_digest,
        },
        "read_only": True,
        "capture_mode": "live_readonly",
        "snapshot_query_rewrite": "pending_exact_total_estimate_reltuples",
        "excluded_from_5s_path": ATTEMPT_003_BLOCKING_TOTAL_COUNT_SQL,
    }


def capture_db_total_count_diagnostic(
    *,
    runner: CommandRunner,
    docker_pin: DockerExecutionPlanePin,
    captured_at_utc: str,
    verify_pin: bool = True,
    statement_timeout: str = DIAGNOSTIC_TOTAL_COUNT_TIMEOUT,
) -> dict[str, Any]:
    """Separate diagnostic path for exact full-table count(*) — not T0/T1.

    Uses a long timeout. Never call from the 5s probe snapshot path.
    """
    if verify_pin:
        verify_docker_execution_plane(docker_pin, runner=runner)
    wrapped = build_readonly_psql_sql(
        ATTEMPT_003_BLOCKING_TOTAL_COUNT_SQL,
        statement_timeout=statement_timeout,
    )
    raw = _run(
        runner,
        "docker",
        "exec",
        docker_pin.container_id,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-t",
        "-A",
        "-c",
        wrapped,
        pinned_container_id=docker_pin.container_id,
    ).strip()
    lines = [
        ln.strip()
        for ln in raw.splitlines()
        if ln.strip() and ln.strip() not in {"BEGIN", "COMMIT", "SET"}
    ]
    if not lines:
        raise LiveCaptureError("diagnostic_total_count_empty")
    total = int(lines[-1])
    return {
        "captured_at_utc": captured_at_utc,
        "total_exact": total,
        "total_kind": "exact_count_star",
        "statement_timeout": statement_timeout,
        "sql": ATTEMPT_003_BLOCKING_TOTAL_COUNT_SQL,
        "path": "diagnostic_not_t0_t1",
        "read_only": True,
        "docker_pin": {
            "container_id": docker_pin.container_id,
            "container_name": docker_pin.container_name,
            "docker_context": docker_pin.docker_context,
            "image_digest": docker_pin.image_digest,
        },
    }


def _validate_independent_term(name: str, term: Any) -> dict[str, Any]:
    if not isinstance(term, Mapping):
        raise LiveCaptureError(f"independent_term_invalid:{name}")
    if "count" not in term or "source" not in term or "proof" not in term:
        raise LiveCaptureError(f"independent_term_incomplete:{name}")
    source = str(term["source"])
    if source.startswith("column_absent"):
        raise LiveCaptureError(f"independent_term_column_absent_source:{name}")
    if source in _CIRCULAR_EQUATION_SOURCES:
        raise LiveCaptureError(f"independent_term_circular_source:{name}:{source}")
    proof = term["proof"]
    if isinstance(proof, Mapping) and proof.get("derived_from_column_absence") is True:
        raise LiveCaptureError(f"independent_term_derived_from_column_absence:{name}")
    try:
        count = int(term["count"])
    except (TypeError, ValueError) as exc:
        raise LiveCaptureError(f"independent_term_count_invalid:{name}") from exc
    return {"count": count, "source": source, "proof": proof}


def compute_database_equation_terms(
    *,
    t0: Mapping[str, Any],
    t1: Mapping[str, Any],
    independent_terms: Mapping[str, Any],
) -> dict[str, Any]:
    if independent_terms is None:
        raise LiveCaptureError("database_equation_independent_terms_missing")
    validated: dict[str, dict[str, Any]] = {}
    for key in _INDEPENDENT_TERM_KEYS:
        if key not in independent_terms:
            raise LiveCaptureError(f"database_equation_missing_independent_term:{key}")
        validated[key] = _validate_independent_term(key, independent_terms[key])

    # Observed left side only — never derive created/db_ack from total/published_true.
    pending_delta = int(t1["pending"]) - int(t0["pending"])
    created = validated["created_unpublished"]["count"]
    db_ack = validated["database_acknowledged"]["count"]
    reopened = validated["reopened"]["count"]
    deleted = validated["deleted_unpublished"]["count"]
    return {
        "pending_delta": pending_delta,
        "created_unpublished": created,
        "database_acknowledged": db_ack,
        "reopened": reopened,
        "deleted_unpublished": deleted,
        "independent_terms": validated,
        "reopened_proof": validated["reopened"]["proof"],
        "deleted_unpublished_proof": validated["deleted_unpublished"]["proof"],
        "t0": dict(t0),
        "t1": dict(t1),
        "identity_verified": pending_delta == created - db_ack + reopened - deleted,
        "read_only": True,
        "capture_mode": "live_readonly",
    }


REQUIRED_PROVENANCE_COUNTER_SERIES: tuple[str, ...] = (
    "auction_monitor_outbox_created_total",
    "auction_monitor_outbox_db_acknowledged_total",
    "auction_monitor_outbox_reopened_total",
    "auction_monitor_outbox_deleted_unpublished_total",
)

_TERM_TO_SERIES: Mapping[str, str] = {
    "created_unpublished": "auction_monitor_outbox_created_total",
    "database_acknowledged": "auction_monitor_outbox_db_acknowledged_total",
    "reopened": "auction_monitor_outbox_reopened_total",
    "deleted_unpublished": "auction_monitor_outbox_deleted_unpublished_total",
}

_PROM_SAMPLE_RE = re.compile(
    r"^(?P<name>[a-zA-Z_:][a-zA-Z0-9_:]*)"
    r"(?:\{(?P<labels>[^}]*)\})?\s+"
    r"(?P<value>[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*$"
)


def parse_prometheus_exposition(text: str) -> list[dict[str, Any]]:
    samples: list[dict[str, Any]] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        match = _PROM_SAMPLE_RE.match(line)
        if not match:
            continue
        labels: dict[str, str] = {}
        label_blob = match.group("labels")
        if label_blob:
            for part in label_blob.split(","):
                part = part.strip()
                if not part:
                    continue
                if "=" not in part:
                    raise LiveCaptureError(f"prometheus_label_parse_error:{part}")
                key, value = part.split("=", 1)
                labels[key.strip()] = value.strip().strip('"')
        samples.append(
            {
                "name": match.group("name"),
                "labels": labels,
                "value": float(match.group("value")),
                "line": line,
            }
        )
    return samples


def scrape_auction_monitor_prometheus(
    *,
    runner: CommandRunner = default_command_runner,
    namespace: str = NAMESPACE,
    metrics_url: str = AUCTION_MONITOR_METRICS_URL,
) -> str:
    """Read-only scrape of auction-monitor Prometheus exposition via allowlisted kubectl exec."""
    pod = _jsonpath(
        runner,
        "kubectl",
        "-n",
        namespace,
        "get",
        "pod",
        "-l",
        "app=auction-monitor",
        "-o",
        "jsonpath={.items[0].metadata.name}",
    )
    if not pod:
        raise LiveCaptureError("auction_monitor_pod_missing")
    text = _run(
        runner,
        *kubectl_metrics_scrape_template(
            pod=pod, namespace=namespace, metrics_url=metrics_url
        ),
    )
    if not str(text).strip():
        raise LiveCaptureError("prometheus_scrape_empty")
    return text


def validate_live_a1_counters_from_prometheus(text: str) -> dict[str, Any]:
    """Verify Ticket-1 counter series from a live (or mocked) Prometheus scrape."""
    samples = parse_prometheus_exposition(text)
    present = {str(sample["name"]) for sample in samples}
    missing = [name for name in REQUIRED_PROVENANCE_COUNTER_SERIES if name not in present]
    ready = len(missing) == 0
    return {
        "ready": ready,
        "reason": (
            "live_auction_monitor_prometheus_scrape"
            if ready
            else "required_series_missing_from_live_scrape"
        ),
        "required_series": list(REQUIRED_PROVENANCE_COUNTER_SERIES),
        "missing_series": missing,
        "series_present": [
            name for name in REQUIRED_PROVENANCE_COUNTER_SERIES if name in present
        ],
        "sample_count": len(samples),
        "verification": "live_prometheus_scrape",
    }


def extract_process_start_time_seconds(text: str) -> float:
    samples = parse_prometheus_exposition(text)
    matches = [s for s in samples if s.get("name") == "process_start_time_seconds"]
    if len(matches) != 1:
        raise LiveCaptureError("process_start_time_missing_or_ambiguous")
    return float(matches[0]["value"])


def independently_recompute_db_provenance(canary_root: Path | str) -> dict[str, Any]:
    """Recompute equation terms from frozen artifacts (independent of writer summary)."""
    root = Path(canary_root)
    failures: list[str] = []
    equation_path = root / "database-equation-terms.json"
    if not equation_path.is_file():
        return {
            "pass": False,
            "failures": ["database_equation_missing"],
            "common_interval_proven": False,
            "counter_epoch_unchanged": False,
            "required_series_present": False,
            "auditor_recompute_pass": False,
        }
    equation = json.loads(equation_path.read_text())
    interval = json.loads((root / "db-provenance" / "interval.json").read_text())
    t0_meta = json.loads((root / "db-provenance" / "metrics" / "t0.meta.json").read_text())
    t1_meta = json.loads((root / "db-provenance" / "metrics" / "t1.meta.json").read_text())
    t0_prom = (root / "db-provenance" / "metrics" / "t0.prom.txt").read_text()
    t1_prom = (root / "db-provenance" / "metrics" / "t1.prom.txt").read_text()
    if _sha256_text(t0_prom) != t0_meta.get("artifact_sha256"):
        failures.append("raw_prometheus_hash_mismatch:t0")
    if _sha256_text(t1_prom) != t1_meta.get("artifact_sha256"):
        failures.append("raw_prometheus_hash_mismatch:t1")

    start = str(interval.get("interval_start_utc") or "")
    end = str(interval.get("interval_end_utc") or "")
    common_interval = bool(start and end and start < end)
    if not common_interval:
        failures.append("common_interval_unproven")

    if interval.get("pod_uid_t0") != interval.get("pod_uid_t1"):
        failures.append("pod_uid_drift")
    try:
        if float(interval.get("process_start_time_t0")) != float(
            interval.get("process_start_time_t1")
        ):
            failures.append("process_start_time_drift")
    except (TypeError, ValueError):
        failures.append("process_start_time_drift")
    epoch_ok = interval.get("counter_epoch_unchanged") is True
    if not epoch_ok:
        failures.append("counter_epoch_unchanged_false")

    t0_samples = parse_prometheus_exposition(t0_prom)
    t1_samples = parse_prometheus_exposition(t1_prom)
    recomputed: dict[str, int] = {}
    series_ok = True
    try:
        for term, series in _TERM_TO_SERIES.items():
            v0 = _resolve_required_counter(t0_samples, series)["value"]
            v1 = _resolve_required_counter(t1_samples, series)["value"]
            if v1 < v0:
                failures.append(f"counter_reset:{series}")
                series_ok = False
                continue
            recomputed[term] = int(v1 - v0)
    except LiveCaptureError as exc:
        failures.append(str(exc))
        series_ok = False

    db_t0 = json.loads((root / "db-provenance" / "snapshots" / "db-t0.json").read_text())
    db_t1 = json.loads((root / "db-provenance" / "snapshots" / "db-t1.json").read_text())
    pending_delta = int(db_t1["pending"]) - int(db_t0["pending"])
    if series_ok and len(recomputed) == len(_TERM_TO_SERIES):
        identity = pending_delta == (
            recomputed["created_unpublished"]
            - recomputed["database_acknowledged"]
            + recomputed["reopened"]
            - recomputed["deleted_unpublished"]
        )
        if not identity:
            failures.append("pending_equation_mismatch")
        for key, value in recomputed.items():
            if int(equation.get(key)) != int(value):
                failures.append(f"summary_value_mismatch:{key}")
        if int(equation.get("pending_delta")) != pending_delta:
            failures.append("summary_value_mismatch:pending_delta")
    else:
        failures.append("required_series_incomplete")

    try:
        verify_db_provenance_raw_hashes(root)
    except LiveCaptureError as exc:
        failures.append(f"raw_hash_verify:{exc}")

    passed = len(failures) == 0
    return {
        "pass": passed,
        "failures": failures,
        "common_interval_proven": common_interval and "common_interval_unproven" not in failures,
        "counter_epoch_unchanged": epoch_ok,
        "required_series_present": series_ok,
        "auditor_recompute_pass": passed,
        "recomputed": recomputed,
        "pending_delta": pending_delta,
        "equation_schema": equation.get("schema"),
    }


def capture_publisher_log_cursor_readonly(
    *,
    runner: CommandRunner = default_command_runner,
    captured_at_utc: str,
    namespace: str = NAMESPACE,
) -> dict[str, Any]:
    """Freeze a publisher log cursor without invoking publisher_tick."""
    if not captured_at_utc:
        raise LiveCaptureError("log_cursor_timestamp_missing")
    text = scrape_auction_monitor_logs(
        runner=runner, namespace=namespace, since_time_utc=captured_at_utc
    )
    return {
        "since_time_utc": captured_at_utc,
        "log_byte_length": len(text.encode("utf-8")),
        "line_count": len(text.splitlines()) if text else 0,
        "read_only": True,
        "capture_mode": "live_readonly",
        "publisher_invocation_triggered": False,
    }


def docker_execution_plane_as_dict(pin: DockerExecutionPlanePin) -> dict[str, Any]:
    return {
        "colima_profile": pin.colima_profile,
        "docker_host": pin.docker_host,
        "docker_context": pin.docker_context,
        "compose_project": pin.compose_project,
        "compose_service": pin.compose_service,
        "container_id": pin.container_id,
        "container_name": pin.container_name,
        "image_digest": pin.image_digest,
        "read_only": True,
        "capture_mode": "live_readonly",
    }


def _label_key(labels: Mapping[str, str]) -> tuple[tuple[str, str], ...]:
    return tuple(sorted((str(k), str(v)) for k, v in labels.items()))


def _resolve_required_counter(
    samples: Sequence[Mapping[str, Any]], series: str
) -> dict[str, Any]:
    matches = [s for s in samples if s.get("name") == series]
    if not matches:
        raise LiveCaptureError(f"missing_required_counter_series:{series}")
    by_labels: dict[tuple[tuple[str, str], ...], list[Mapping[str, Any]]] = {}
    for sample in matches:
        key = _label_key(sample.get("labels") or {})
        by_labels.setdefault(key, []).append(sample)
    if len(by_labels) != 1:
        raise LiveCaptureError(f"unexpected_label_set:{series}")
    label_key, group = next(iter(by_labels.items()))
    if len(group) != 1:
        raise LiveCaptureError(f"duplicate_matching_series:{series}")
    # Acceptance counters are unlabeled.
    if label_key:
        raise LiveCaptureError(f"unexpected_label_set:{series}")
    sample = group[0]
    return {
        "name": series,
        "labels": dict(sample.get("labels") or {}),
        "value": float(sample["value"]),
        "line": sample["line"],
    }


def _validate_provenance_epoch(
    epoch: Mapping[str, Any],
    *,
    expected_source_sha: str | None = None,
    expected_runtime_sha: str | None = None,
) -> dict[str, Any]:
    required = (
        "test_run_id",
        "source_sha",
        "runtime_sha",
        "pod_uid_t0",
        "pod_uid_t1",
        "process_start_time_t0",
        "process_start_time_t1",
        "counter_epoch_unchanged",
        "writer_count",
    )
    for key in required:
        if key not in epoch:
            raise LiveCaptureError(f"provenance_epoch_missing:{key}")
    if epoch.get("pod_uid_t0") != epoch.get("pod_uid_t1"):
        raise LiveCaptureError("pod_uid_changed")
    if float(epoch["process_start_time_t0"]) != float(epoch["process_start_time_t1"]):
        raise LiveCaptureError("process_start_time_changed")
    if epoch.get("counter_epoch_unchanged") is not True:
        raise LiveCaptureError("counter_epoch_unchanged_false")
    if int(epoch["writer_count"]) != 1:
        raise LiveCaptureError("writer_count_not_one")
    if expected_source_sha is not None and str(epoch["source_sha"]) != expected_source_sha:
        raise LiveCaptureError("source_sha_mismatch")
    if expected_runtime_sha is not None and str(epoch["runtime_sha"]) != expected_runtime_sha:
        raise LiveCaptureError("runtime_sha_mismatch")
    return {key: epoch[key] for key in required}


def _assert_safe_rel_path(root: Path, rel: str) -> Path:
    if rel.startswith("/") or rel.startswith("\\") or ".." in Path(rel).parts:
        raise LiveCaptureError(f"foreign_artifact_path:{rel}")
    resolved = (root / rel).resolve()
    root_resolved = root.resolve()
    if root_resolved not in resolved.parents and resolved != root_resolved:
        raise LiveCaptureError(f"foreign_artifact_path:{rel}")
    if not str(resolved).startswith(str(root_resolved)):
        raise LiveCaptureError(f"foreign_artifact_path:{rel}")
    return resolved


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_db_provenance_raw_hashes(canary_root: Path | str) -> None:
    root = Path(canary_root)
    for label in ("t0", "t1"):
        meta_path = root / "db-provenance" / "metrics" / f"{label}.meta.json"
        meta = json.loads(meta_path.read_text())
        rel = meta.get("artifact_path")
        if not isinstance(rel, str):
            raise LiveCaptureError(f"raw_artifact_sha_mismatch:{label}:missing_path")
        artifact = _assert_safe_rel_path(root, rel)
        digest = _sha256_file(artifact)
        if digest != meta.get("artifact_sha256"):
            raise LiveCaptureError(f"raw_artifact_sha_mismatch:{label}")


def build_and_write_db_provenance(
    canary_root: Path | str,
    *,
    t0_prom_text: str,
    t1_prom_text: str,
    db_t0: Mapping[str, Any],
    db_t1: Mapping[str, Any],
    interval_start_utc: str,
    interval_end_utc: str,
    epoch: Mapping[str, Any],
    summary_override: Mapping[str, Any] | None = None,
    expected_source_sha: str | None = None,
    expected_runtime_sha: str | None = None,
    force_foreign_artifact_path: str | None = None,
) -> dict[str, Any]:
    """Parse scrapes, validate epoch/deltas, write create-only provenance tree + equation v2."""
    from auction_monitor_canary_v3_trace import (  # local import avoids cycle at module load
        atomic_create_only_json,
        atomic_create_only_text,
    )

    root = Path(canary_root)
    root.mkdir(parents=True, exist_ok=True)
    validated_epoch = _validate_provenance_epoch(
        epoch,
        expected_source_sha=expected_source_sha,
        expected_runtime_sha=expected_runtime_sha,
    )

    if force_foreign_artifact_path:
        _assert_safe_rel_path(root, force_foreign_artifact_path)

    t0_samples = parse_prometheus_exposition(t0_prom_text)
    t1_samples = parse_prometheus_exposition(t1_prom_text)
    t0_resolved: dict[str, dict[str, Any]] = {}
    t1_resolved: dict[str, dict[str, Any]] = {}
    for series in REQUIRED_PROVENANCE_COUNTER_SERIES:
        t0_resolved[series] = _resolve_required_counter(t0_samples, series)
        t1_resolved[series] = _resolve_required_counter(t1_samples, series)
        if t0_resolved[series]["labels"] != t1_resolved[series]["labels"]:
            raise LiveCaptureError(f"unexpected_label_set:{series}")
        if t1_resolved[series]["value"] < t0_resolved[series]["value"]:
            raise LiveCaptureError(f"t1_lower_than_t0:{series}")

    deltas = {
        term: int(t1_resolved[series]["value"] - t0_resolved[series]["value"])
        for term, series in _TERM_TO_SERIES.items()
    }
    pending_delta = int(db_t1["pending"]) - int(db_t0["pending"])
    identity_ok = pending_delta == (
        deltas["created_unpublished"]
        - deltas["database_acknowledged"]
        + deltas["reopened"]
        - deltas["deleted_unpublished"]
    )
    if not identity_ok:
        raise LiveCaptureError("pending_equation_mismatch")

    summary = {
        "pending_delta": pending_delta,
        "created_unpublished": deltas["created_unpublished"],
        "database_acknowledged": deltas["database_acknowledged"],
        "reopened": deltas["reopened"],
        "deleted_unpublished": deltas["deleted_unpublished"],
    }
    if summary_override:
        for key, value in summary_override.items():
            if key in summary and int(value) != int(summary[key]):
                raise LiveCaptureError(f"summary_value_differs:{key}")

    t0_sha = _sha256_text(t0_prom_text)
    t1_sha = _sha256_text(t1_prom_text)
    db_t0_body = dict(db_t0)
    db_t1_body = dict(db_t1)
    db_t0_bytes = (json.dumps(db_t0_body, sort_keys=True, separators=(",", ":")) + "\n").encode()
    db_t1_bytes = (json.dumps(db_t1_body, sort_keys=True, separators=(",", ":")) + "\n").encode()
    db_t0_sha = hashlib.sha256(db_t0_bytes).hexdigest()
    db_t1_sha = hashlib.sha256(db_t1_bytes).hexdigest()

    paths = {
        "t0_prom": "db-provenance/metrics/t0.prom.txt",
        "t1_prom": "db-provenance/metrics/t1.prom.txt",
        "t0_meta": "db-provenance/metrics/t0.meta.json",
        "t1_meta": "db-provenance/metrics/t1.meta.json",
        "db_t0": "db-provenance/snapshots/db-t0.json",
        "db_t1": "db-provenance/snapshots/db-t1.json",
        "interval": "db-provenance/interval.json",
    }
    for rel in paths.values():
        _assert_safe_rel_path(root, rel)

    atomic_create_only_text(root / paths["t0_prom"], t0_prom_text)
    atomic_create_only_text(root / paths["t1_prom"], t1_prom_text)
    (root / "db-provenance" / "snapshots").mkdir(parents=True, exist_ok=True)
    # snapshots via create-only bytes-equivalent JSON
    from auction_monitor_canary_v3_trace import atomic_create_only_bytes

    atomic_create_only_bytes(root / paths["db_t0"], db_t0_bytes)
    atomic_create_only_bytes(root / paths["db_t1"], db_t1_bytes)

    def scrape_meta(label: str, artifact_path: str, digest: str, resolved: Mapping[str, dict[str, Any]]) -> dict[str, Any]:
        return {
            "schema": "canary-v3-prometheus-scrape/v1",
            "label": label,
            "captured_at_utc": interval_start_utc if label == "T0" else interval_end_utc,
            "artifact_path": artifact_path,
            "artifact_sha256": digest,
            "required_series": list(REQUIRED_PROVENANCE_COUNTER_SERIES),
            "parsed": {
                name: {
                    "value": sample["value"],
                    "labels": sample["labels"],
                    "line": sample["line"],
                }
                for name, sample in resolved.items()
            },
            **validated_epoch,
        }

    atomic_create_only_json(
        root / paths["t0_meta"],
        scrape_meta("T0", paths["t0_prom"], t0_sha, t0_resolved),
    )
    atomic_create_only_json(
        root / paths["t1_meta"],
        scrape_meta("T1", paths["t1_prom"], t1_sha, t1_resolved),
    )
    atomic_create_only_json(
        root / paths["interval"],
        {
            "schema": "canary-v3-db-provenance-interval/v1",
            "interval_start_utc": interval_start_utc,
            "interval_end_utc": interval_end_utc,
            "t0_captured_at_utc": interval_start_utc,
            "t1_captured_at_utc": interval_end_utc,
            **validated_epoch,
        },
    )

    terms_dir = root / "db-provenance" / "terms"
    terms_dir.mkdir(parents=True, exist_ok=True)
    for term, series in _TERM_TO_SERIES.items():
        term_obj = {
            "schema": "canary-v3-db-term-provenance/v1",
            "term": term,
            "value": deltas[term],
            "source_type": "prometheus_counter_delta",
            "series": series,
            "labels": {},
            "artifact_path_t0": paths["t0_prom"],
            "artifact_sha256_t0": t0_sha,
            "artifact_path_t1": paths["t1_prom"],
            "artifact_sha256_t1": t1_sha,
            "interval_start_utc": interval_start_utc,
            "interval_end_utc": interval_end_utc,
            "start_value": int(t0_resolved[series]["value"]),
            "end_value": int(t1_resolved[series]["value"]),
            "delta": deltas[term],
            **validated_epoch,
            "proof": {
                "kind": "prometheus_counter_delta",
                "t0_meta_path": paths["t0_meta"],
                "t1_meta_path": paths["t1_meta"],
            },
        }
        atomic_create_only_json(terms_dir / f"{term}.json", term_obj)

    pending_term = {
        "schema": "canary-v3-db-term-provenance/v1",
        "term": "pending_delta",
        "value": pending_delta,
        "source_type": "database_snapshot_delta",
        "series": None,
        "artifact_path_t0": paths["db_t0"],
        "artifact_sha256_t0": db_t0_sha,
        "artifact_path_t1": paths["db_t1"],
        "artifact_sha256_t1": db_t1_sha,
        "interval_start_utc": interval_start_utc,
        "interval_end_utc": interval_end_utc,
        "start_value": int(db_t0["pending"]),
        "end_value": int(db_t1["pending"]),
        "delta": pending_delta,
        "field": "pending",
        **validated_epoch,
        "proof": {
            "kind": "readonly_psql_snapshot_delta",
            "t0_path": paths["db_t0"],
            "t1_path": paths["db_t1"],
        },
    }
    atomic_create_only_json(terms_dir / "pending_delta.json", pending_term)

    provenance_manifest = {
        "paths": sorted(
            [
                paths["interval"],
                paths["t0_prom"],
                paths["t0_meta"],
                paths["t1_prom"],
                paths["t1_meta"],
                paths["db_t0"],
                paths["db_t1"],
                *[f"db-provenance/terms/{t}.json" for t in (*_TERM_TO_SERIES, "pending_delta")],
            ]
        )
    }
    provenance_manifest_sha = hashlib.sha256(
        json.dumps(provenance_manifest, sort_keys=True).encode()
    ).hexdigest()

    equation = {
        "schema": "canary-v3-database-equation-terms/v2",
        "pending_delta": pending_delta,
        "created_unpublished": deltas["created_unpublished"],
        "database_acknowledged": deltas["database_acknowledged"],
        "reopened": deltas["reopened"],
        "deleted_unpublished": deltas["deleted_unpublished"],
        "provenance_root": "db-provenance",
        "provenance_manifest_sha256": provenance_manifest_sha,
        "identity_verified": True,
        "reopened_proof": {
            "count": deltas["reopened"],
            "source": "prometheus_counter_delta",
            "series": _TERM_TO_SERIES["reopened"],
        },
        "deleted_unpublished_proof": {
            "count": deltas["deleted_unpublished"],
            "source": "prometheus_counter_delta",
            "series": _TERM_TO_SERIES["deleted_unpublished"],
        },
        "t0": db_t0_body,
        "t1": db_t1_body,
        "read_only": True,
        "capture_mode": "live_readonly",
        **validated_epoch,
    }
    atomic_create_only_json(root / "database-equation-terms.json", equation)
    verify_db_provenance_raw_hashes(root)
    return equation


def build_fixture_db_provenance(
    canary_root: Path | str,
    *,
    expected_runtime_sha: str,
    runtime_pin: Mapping[str, Any] | None = None,
    created: int = 750,
    database_acknowledged: int = 750,
    reopened: int = 0,
    deleted_unpublished: int = 0,
    pending_t0: int = 0,
    pending_t1: int = 0,
) -> dict[str, Any]:
    """Synthetic T0/T1 scrapes for dry-run fixture roots (no live scrape)."""
    runtime_pin = runtime_pin or {}
    source_sha = str(runtime_pin.get("RP_SOURCE_SHA") or expected_runtime_sha)
    pod_uid = str(runtime_pin.get("pod_uid") or "fixture-pod")
    process_start = 1700000000.0
    t0_values = {series: 0 for series in REQUIRED_PROVENANCE_COUNTER_SERIES}
    t1_values = {
        "auction_monitor_outbox_created_total": created,
        "auction_monitor_outbox_db_acknowledged_total": database_acknowledged,
        "auction_monitor_outbox_reopened_total": reopened,
        "auction_monitor_outbox_deleted_unpublished_total": deleted_unpublished,
    }

    def _prom(values: Mapping[str, int]) -> str:
        return "".join(f"{name} {values[name]}\n" for name in REQUIRED_PROVENANCE_COUNTER_SERIES)

    epoch = {
        "test_run_id": "00000000-0000-4000-8000-0000000000f1",
        "source_sha": source_sha,
        "runtime_sha": expected_runtime_sha,
        "pod_uid_t0": pod_uid,
        "pod_uid_t1": pod_uid,
        "process_start_time_t0": process_start,
        "process_start_time_t1": process_start,
        "counter_epoch_unchanged": True,
        "writer_count": 1,
    }
    db_t0 = {
        "pending": pending_t0,
        "total": 0,
        "published_true": 0,
        "label": "T0",
    }
    db_t1 = {
        "pending": pending_t1,
        "total": created,
        "published_true": database_acknowledged,
        "label": "T1",
    }
    return build_and_write_db_provenance(
        canary_root,
        t0_prom_text=_prom(t0_values),
        t1_prom_text=_prom(t1_values),
        db_t0=db_t0,
        db_t1=db_t1,
        interval_start_utc="2026-08-06T12:00:00Z",
        interval_end_utc="2026-08-06T13:00:00Z",
        epoch=epoch,
        expected_source_sha=source_sha,
        expected_runtime_sha=expected_runtime_sha,
    )


def assert_kafka_readonly_describe_props_present(
    *,
    runner: CommandRunner = default_command_runner,
    namespace: str = NAMESPACE,
) -> None:
    """Fail closed if the allowlisted readonly describe properties artifact is missing."""
    args = kafka_readonly_describe_props_stat_template(namespace=namespace)
    try:
        _run(runner, *args)
    except LiveCaptureError as exc:
        raise LiveCaptureError(
            f"kafka_readonly_describe_props_missing_or_unreadable:{KAFKA_COMMAND_CONFIG}:{exc}"
        ) from exc


def describe_topic_leaders(
    *,
    runner: CommandRunner = default_command_runner,
    namespace: str = NAMESPACE,
    topic: str = TOPIC,
) -> tuple[str, dict[int, int]]:
    assert_kafka_readonly_describe_props_present(runner=runner, namespace=namespace)
    args = kafka_describe_template(namespace=namespace, topic=topic)
    out = _run(runner, *args)
    leaders: dict[int, int] = {}
    for line in out.splitlines():
        if "Partition:" in line and "Leader:" in line:
            parts = line.replace("\t", " ").split()
            try:
                pi = parts.index("Partition:")
                li = parts.index("Leader:")
                leaders[int(parts[pi + 1])] = int(parts[li + 1])
            except (ValueError, IndexError):
                continue
    if not leaders:
        raise LiveCaptureError("topic_leaders_unparsed")
    expected = set(range(EXPECTED_AUCTION_MONITOR_TOPIC_PARTITIONS))
    actual = set(leaders.keys())
    if not expected.issubset(actual):
        raise LiveCaptureError(
            f"leader_coverage_incomplete:missing={sorted(expected - actual)}:"
            f"actual={sorted(actual)}"
        )
    for partition, broker in leaders.items():
        if int(partition) in expected and int(broker) not in VALID_KAFKA_BROKER_IDS:
            raise LiveCaptureError(
                f"leader_broker_out_of_range:partition={partition}:broker={broker}"
            )
    # Keep only the expected partition denominator for probe validation.
    leaders = {p: leaders[p] for p in sorted(expected)}
    return out, leaders


def capture_leader_snapshot(
    *,
    runner: CommandRunner = default_command_runner,
    captured_at_utc: str,
    valid_from: str,
    valid_until: str | None,
    namespace: str = NAMESPACE,
    topic: str = TOPIC,
) -> dict[str, Any]:
    raw, leaders = describe_topic_leaders(
        runner=runner, namespace=namespace, topic=topic
    )
    return {
        "captured_at_utc": captured_at_utc,
        "valid_from": valid_from,
        "valid_until": valid_until,
        "leaders": {str(k): int(v) for k, v in sorted(leaders.items())},
        "raw_describe_sha256": hashlib.sha256(raw.encode()).hexdigest(),
        "topic": topic,
        "read_only": True,
        "capture_mode": "live_readonly",
    }


def _parse_utc(ts: str) -> str:
    if not ts or not isinstance(ts, str):
        raise LiveCaptureError("timestamp_missing")
    return ts


def _timestamp_covered(ts: str, valid_from: str, valid_until: str) -> bool:
    # Lexicographic compare is valid for RFC3339 / ISO-8601 UTC with fixed format.
    return valid_from <= ts <= valid_until


def capture_partition_leader_snapshots(
    *,
    before: Mapping[str, Any],
    after: Mapping[str, Any],
    row_partitions: Sequence[int],
    ack_timestamps: Sequence[str],
    batch_limit: int,
    invocation_id: str,
    topic: str = TOPIC,
) -> dict[str, Any]:
    if row_partitions is None:
        raise LiveCaptureError("row_partitions_required")
    if len(row_partitions) != batch_limit:
        raise LiveCaptureError(
            f"row_partitions_length_mismatch:{len(row_partitions)}!={batch_limit}"
        )
    if len(ack_timestamps) != batch_limit:
        raise LiveCaptureError(
            f"ack_timestamps_length_mismatch:{len(ack_timestamps)}!={batch_limit}"
        )

    before_until = before.get("valid_until")
    after_until = after.get("valid_until")
    if before_until is None or after_until is None:
        raise LiveCaptureError("leader_snapshot_unbounded_valid_until")

    before_from = _parse_utc(str(before.get("valid_from") or ""))
    after_from = _parse_utc(str(after.get("valid_from") or ""))
    before_until_s = _parse_utc(str(before_until))
    after_until_s = _parse_utc(str(after_until))

    before_leaders = {
        str(k): int(v) for k, v in dict(before.get("leaders") or {}).items()
    }
    after_leaders = {
        str(k): int(v) for k, v in dict(after.get("leaders") or {}).items()
    }
    if before_leaders != after_leaders:
        raise LiveCaptureError("leader_bracket_leaders_changed")

    coverage_from = before_from
    coverage_until = after_until_s
    snapshots: list[dict[str, Any]] = []
    for index, partition in enumerate(row_partitions):
        key = str(int(partition))
        if key not in before_leaders:
            raise LiveCaptureError(f"partition_missing_from_before_leader_map:{key}")
        if key not in after_leaders:
            raise LiveCaptureError(f"partition_missing_from_after_leader_map:{key}")
        ack_ts = _parse_utc(str(ack_timestamps[index]))
        if not _timestamp_covered(ack_ts, coverage_from, coverage_until):
            raise LiveCaptureError(
                f"ack_timestamp_not_time_covered:index={index}:ts={ack_ts}"
            )
        leader = before_leaders[key]
        snapshots.append(
            {
                "index": index,
                "partition": int(partition),
                "leader_broker_id": leader,
                "leader_snapshot_valid": isinstance(leader, int),
                "valid_from": coverage_from,
                "valid_until": coverage_until,
                "before_valid_from": before_from,
                "before_valid_until": before_until_s,
                "after_valid_from": after_from,
                "after_valid_until": after_until_s,
                "ack_timestamp": ack_ts,
                "topic": topic,
                "invocation_id": invocation_id,
            }
        )
    return {
        "invocation_id": invocation_id,
        "captured_at_utc": after.get("captured_at_utc"),
        "snapshots": snapshots,
        "leaders": before_leaders,
        "before": dict(before),
        "after": dict(after),
        "raw_describe_sha256_before": before.get("raw_describe_sha256"),
        "raw_describe_sha256_after": after.get("raw_describe_sha256"),
        "read_only": True,
        "capture_mode": "live_readonly",
    }


def scrape_auction_monitor_logs(
    *,
    runner: CommandRunner = default_command_runner,
    namespace: str = NAMESPACE,
    since_time_utc: str,
) -> str:
    if not since_time_utc:
        raise LiveCaptureError("log_since_time_required")
    pod = _jsonpath(
        runner,
        "kubectl",
        "-n",
        namespace,
        "get",
        "pod",
        "-l",
        "app=auction-monitor",
        "-o",
        "jsonpath={.items[0].metadata.name}",
    )
    if not pod:
        raise LiveCaptureError("auction_monitor_pod_missing")
    return _run(
        runner,
        "kubectl",
        "-n",
        namespace,
        "logs",
        pod,
        f"--since-time={since_time_utc}",
    )


def _parse_json_log_lines(text: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line in text.splitlines():
        if "auction_monitor_outbox" not in line or "{" not in line:
            continue
        payload = line[line.index("{") :]
        try:
            obj = json.loads(payload)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            rows.append(obj)
    return rows


def _batch_id(obj: Mapping[str, Any]) -> str:
    return str(obj.get("batch_id") or obj.get("invocation_id") or "")


def observe_publisher_tick_from_logs(
    *,
    log_text: str,
    index: int,
    invocation_id: str,
    cursor: LogCursor,
) -> dict[str, Any] | None:
    """Return the single new batch after cursor, None if none yet, raise if >1."""
    batches = [
        obj
        for obj in _parse_json_log_lines(log_text)
        if obj.get("msg") == "auction_monitor_outbox_publish_batch"
    ]
    new_batches: list[dict[str, Any]] = []
    for batch in batches:
        batch_id = _batch_id(batch)
        if not batch_id:
            continue
        if batch_id in cursor.known_batch_ids:
            continue
        event_ts = str(batch.get("time") or batch.get("timestamp") or "")
        # Batches without a timestamp, or with a pre-cursor timestamp, are ignored.
        if not event_ts or event_ts < cursor.since_time_utc:
            continue
        new_batches.append(batch)

    if not new_batches:
        return None
    # Deduplicate by batch_id while preserving order.
    unique: dict[str, dict[str, Any]] = {}
    for batch in new_batches:
        unique[_batch_id(batch)] = batch
    if len(unique) > 1:
        raise LiveCaptureError(
            f"publisher_batch_ambiguous:{len(unique)}:{','.join(sorted(unique))}"
        )
    batch = next(iter(unique.values()))
    batch_id = _batch_id(batch)
    return {
        "index": index,
        "invocation_id": invocation_id,
        "publisher_tick": index,
        "observed_invocation_id": batch.get("invocation_id"),
        "batch_id": batch_id,
        "trace_id": batch.get("trace_id"),
        "selected": batch.get("selected"),
        "broker_acks": batch.get("broker_acks"),
        "db_acks": batch.get("db_acks"),
        "source_sha": batch.get("source_sha"),
        "pod_uid": batch.get("pod_uid"),
        "image_digest": batch.get("image_digest"),
        "oci_revision": batch.get("oci_revision"),
        "producer_client_id": batch.get("producer_client_id"),
        "log_cursor_since_time_utc": cursor.since_time_utc,
        "read_only": True,
        "capture_mode": "live_readonly_observe",
        "mutates_publisher": False,
    }


def _row_identity(obj: Mapping[str, Any]) -> tuple[Any, Any, Any]:
    return (
        obj.get("partition"),
        obj.get("offset"),
        obj.get("classification")
        or (
            "DATABASE_ACKNOWLEDGED"
            if obj.get("database_ack_timestamp") or obj.get("db_ack_timestamp")
            else None
        ),
    )


def _require_primary_record_metadata(
    obj: Mapping[str, Any], *, partition: int, offset: int
) -> dict[str, Any]:
    meta = obj.get("kafkajs_record_metadata")
    if not isinstance(meta, Mapping):
        raise LiveCaptureError("primary_record_metadata_missing")
    try:
        meta_partition = int(meta["partition"])
        meta_offset = int(meta["offset"])
    except (KeyError, TypeError, ValueError) as exc:
        raise LiveCaptureError("primary_record_metadata_incomplete") from exc
    if meta_partition != partition:
        raise LiveCaptureError(
            f"primary_record_metadata_partition_mismatch:{meta_partition}!={partition}"
        )
    if meta_offset != offset:
        raise LiveCaptureError(
            f"primary_record_metadata_offset_mismatch:{meta_offset}!={offset}"
        )
    try:
        error_code = int(meta.get("errorCode", 0))
    except (TypeError, ValueError) as exc:
        raise LiveCaptureError("primary_record_metadata_error_code_invalid") from exc
    if error_code != 0:
        raise LiveCaptureError(f"primary_record_metadata_error_code_nonzero:{error_code}")
    return dict(meta)


def bind_lifecycle_and_metadata_from_logs(
    *,
    log_text: str,
    invocation_id: str,
    published: Mapping[str, Any],
    leaders: Mapping[str, int] | None = None,
    batch_limit: int,
) -> tuple[dict[str, Any], dict[str, Any]] | None:
    """Bind terminal lifecycle rows. Return None if fewer than batch_limit unique rows."""
    observed = published.get("observed_invocation_id") or published.get("batch_id")
    rows_raw = [
        obj
        for obj in _parse_json_log_lines(log_text)
        if obj.get("msg") == "auction_monitor_outbox_broker_and_db_ack"
        and (
            obj.get("invocation_id") == observed
            or obj.get("batch_id") == published.get("batch_id")
        )
    ]

    by_hash: dict[str, dict[str, Any]] = {}
    for obj in rows_raw:
        key = str(obj.get("outbox_correlation_hash") or "")
        if not key:
            continue
        if key in by_hash:
            if _row_identity(by_hash[key]) != _row_identity(obj):
                raise LiveCaptureError(
                    f"lifecycle_conflicting_duplicate:{key}"
                )
            continue
        by_hash[key] = obj

    terminal: dict[str, dict[str, Any]] = {}
    for key, obj in by_hash.items():
        db_ts = obj.get("database_ack_timestamp") or obj.get("db_ack_timestamp")
        if not db_ts:
            continue
        terminal[key] = obj

    if len(terminal) < batch_limit:
        return None
    if len(terminal) != batch_limit:
        raise LiveCaptureError(
            f"lifecycle_row_count_mismatch:{len(terminal)}!={batch_limit}"
        )

    lifecycle_rows: list[dict[str, Any]] = []
    metadata_records: list[dict[str, Any]] = []
    primary_keys: set[tuple[int, int]] = set()
    for obj in terminal.values():
        correlation = str(obj["outbox_correlation_hash"])
        partition = int(obj["partition"])
        offset = int(obj["offset"])
        meta = _require_primary_record_metadata(
            obj, partition=partition, offset=offset
        )
        primary_key = (partition, offset)
        if primary_key in primary_keys:
            raise LiveCaptureError(
                f"duplicate_primary_record_metadata:{partition}:{offset}"
            )
        primary_keys.add(primary_key)
        leader = None
        if leaders is not None:
            if str(partition) not in leaders:
                raise LiveCaptureError(f"partition_missing_from_leader_map:{partition}")
            leader = leaders.get(str(partition))
        elif obj.get("leader_broker_id") is not None:
            leader = int(obj["leader_broker_id"])
        lifecycle_rows.append(
            {
                "classification": "DATABASE_ACKNOWLEDGED",
                "correlation_hash": correlation,
                "partition": partition,
                "offset": offset,
                "leader_broker_id": leader,
                "leader_snapshot_valid": isinstance(leader, int),
                "selection_timestamp": obj.get("selection_timestamp"),
                "produce_timestamp": obj.get("produce_start_timestamp")
                or obj.get("produce_timestamp"),
                "broker_timestamp": obj.get("broker_ack_timestamp")
                or obj.get("broker_timestamp"),
                "db_timestamp": obj.get("database_ack_timestamp")
                or obj.get("db_ack_timestamp"),
                "trace_id": obj.get("trace_id") or published.get("trace_id"),
                "offset_provenance": "RecordMetadata",
            }
        )
        metadata_records.append(
            {
                "correlation_hash": correlation,
                "partition": partition,
                "offset": offset,
                "primary": True,
                "kafkajs_record_metadata": meta,
                "offset_provenance": "RecordMetadata",
            }
        )
    return (
        {
            "invocation_id": invocation_id,
            "rows": lifecycle_rows,
            "read_only": True,
            "capture_mode": "live_readonly",
        },
        {
            "invocation_id": invocation_id,
            "records": metadata_records,
            "read_only": True,
            "capture_mode": "live_readonly",
        },
    )


@dataclass
class LiveReadonlyCaptureSession:
    """Stateful session used by production adapters during a probe or future window."""

    runner: CommandRunner = default_command_runner
    utc_now_fn: Callable[[], str] = field(default=lambda: "")
    docker_pin: DockerExecutionPlanePin | None = None
    batch_limit: int = DEFAULT_BATCH_LIMIT
    poll_interval_s: float = DEFAULT_POLL_INTERVAL_S
    publisher_tick_timeout_s: float = DEFAULT_PUBLISHER_TICK_TIMEOUT_S
    lifecycle_bind_timeout_s: float = DEFAULT_LIFECYCLE_BIND_TIMEOUT_S
    sleep_fn: Callable[[float], None] = field(default=time.sleep)
    monotonic_fn: Callable[[], float] = field(default=time.monotonic)
    seen_batch_ids: set[str] = field(default_factory=set)
    db_t0: dict[str, Any] | None = None
    _independent_equation_terms: dict[str, Any] | None = None
    log_cursor: LogCursor | None = None
    leader_before: dict[str, Any] | None = None
    leader_after: dict[str, Any] | None = None
    last_leaders: dict[str, int] | None = None
    last_log_text: str | None = None
    last_lifecycle: dict[str, Any] | None = None
    last_metadata: dict[str, Any] | None = None
    last_published: dict[str, Any] | None = None

    def _require_docker_pin(self) -> DockerExecutionPlanePin:
        if self.docker_pin is None:
            self.docker_pin = capture_docker_execution_plane(runner=self.runner)
        else:
            verify_docker_execution_plane(self.docker_pin, runner=self.runner)
        return self.docker_pin

    def runtime_pin(self) -> dict[str, Any]:
        pin = capture_runtime_pin(runner=self.runner)
        pin["captured_at_utc"] = self.utc_now_fn()
        return pin

    def observability_snapshot(self) -> dict[str, Any]:
        return capture_observability_snapshot(
            runner=self.runner, captured_at_utc=self.utc_now_fn()
        )

    def capture_db_t0(self) -> dict[str, Any]:
        if self.db_t0 is not None:
            return self.db_t0
        pin = self._require_docker_pin()
        self.db_t0 = capture_db_counts_snapshot(
            runner=self.runner,
            docker_pin=pin,
            label="T0",
            captured_at_utc=self.utc_now_fn(),
        )
        return self.db_t0

    # Compatibility: explicit T0 capture only. Do not invent T0 at equation time.
    def ensure_db_t0(self) -> dict[str, Any]:
        return self.capture_db_t0()

    def set_independent_equation_terms(self, terms: Mapping[str, Any]) -> None:
        self._independent_equation_terms = dict(terms)

    def database_equation_terms(
        self, independent_terms: Mapping[str, Any] | None = None
    ) -> dict[str, Any]:
        if self.db_t0 is None:
            raise LiveCaptureError("database_equation_t0_missing")
        terms = independent_terms
        if terms is None:
            terms = getattr(self, "_independent_equation_terms", None)
        if terms is None:
            raise LiveCaptureError("database_equation_independent_terms_missing")
        pin = self._require_docker_pin()
        t1 = capture_db_counts_snapshot(
            runner=self.runner,
            docker_pin=pin,
            label="T1",
            captured_at_utc=self.utc_now_fn(),
        )
        return compute_database_equation_terms(
            t0=self.db_t0, t1=t1, independent_terms=terms
        )

    def mark_log_cursor_before_tick(self) -> LogCursor:
        since_time = self.utc_now_fn()
        if not since_time:
            raise LiveCaptureError("log_cursor_timestamp_missing")
        # Freeze currently known batch IDs so pre-window / stale batches are ignored.
        known = set(self.seen_batch_ids)
        try:
            pre = scrape_auction_monitor_logs(
                runner=self.runner, since_time_utc=since_time
            )
            for obj in _parse_json_log_lines(pre):
                if obj.get("msg") == "auction_monitor_outbox_publish_batch":
                    batch_id = _batch_id(obj)
                    if batch_id:
                        known.add(batch_id)
        except LiveCaptureError:
            # Cursor timestamp still freezes; empty known set is valid at window start.
            pass
        cursor = LogCursor(
            since_time_utc=since_time, known_batch_ids=frozenset(known)
        )
        self.log_cursor = cursor
        return cursor

    def _poll_logs(self) -> str:
        if self.log_cursor is None:
            raise LiveCaptureError("log_cursor_required")
        self.last_log_text = scrape_auction_monitor_logs(
            runner=self.runner, since_time_utc=self.log_cursor.since_time_utc
        )
        return self.last_log_text

    def publisher_tick(self, index: int, invocation_id: str) -> dict[str, Any]:
        if self.log_cursor is None:
            raise LiveCaptureError("log_cursor_required")
        deadline = self.monotonic_fn() + self.publisher_tick_timeout_s
        last_error: Exception | None = None
        while self.monotonic_fn() <= deadline:
            text = self._poll_logs()
            try:
                observed = observe_publisher_tick_from_logs(
                    log_text=text,
                    index=index,
                    invocation_id=invocation_id,
                    cursor=self.log_cursor,
                )
            except LiveCaptureError as exc:
                last_error = exc
                raise
            if observed is not None:
                batch_id = str(observed.get("batch_id") or "")
                if batch_id:
                    self.seen_batch_ids.add(batch_id)
                    # Advance cursor known set so subsequent ticks require a newer batch.
                    self.log_cursor = LogCursor(
                        since_time_utc=self.log_cursor.since_time_utc,
                        known_batch_ids=frozenset(
                            set(self.log_cursor.known_batch_ids) | {batch_id}
                        ),
                    )
                self.last_published = observed
                return observed
            self.sleep_fn(self.poll_interval_s)
        if last_error is not None:
            raise last_error
        raise LiveCaptureError(f"publisher_batch_not_observed:index={index}")

    def capture_leader_bracket(self, phase: str) -> dict[str, Any]:
        now = self.utc_now_fn()
        if phase == "before":
            snap = capture_leader_snapshot(
                runner=self.runner,
                captured_at_utc=now,
                valid_from=now,
                valid_until=None,
            )
            self.leader_before = snap
            self.last_leaders = {
                str(k): int(v) for k, v in (snap.get("leaders") or {}).items()
            }
            return snap
        if phase == "after":
            if self.leader_before is None:
                raise LiveCaptureError("leader_bracket_before_missing")
            snap = capture_leader_snapshot(
                runner=self.runner,
                captured_at_utc=now,
                valid_from=now,
                valid_until=now,
            )
            # Seal before.valid_until at after.valid_from so the bracket is bounded.
            self.leader_before = {
                **self.leader_before,
                "valid_until": snap["valid_from"],
            }
            self.leader_after = snap
            after_leaders = {
                str(k): int(v) for k, v in (snap.get("leaders") or {}).items()
            }
            if self.last_leaders != after_leaders:
                raise LiveCaptureError("leader_bracket_leaders_changed")
            self.last_leaders = after_leaders
            return snap
        raise LiveCaptureError(f"leader_bracket_phase_invalid:{phase}")

    def partition_leader_snapshots(
        self, invocation_id: str, published: Mapping[str, Any]
    ) -> dict[str, Any]:
        if self.leader_before is None or self.leader_after is None:
            # Auto-capture after bracket if before exists; otherwise require explicit bracket.
            if self.leader_before is None:
                self.capture_leader_bracket("before")
            self.capture_leader_bracket("after")
        assert self.leader_before is not None and self.leader_after is not None

        row_partitions = published.get("row_partitions")
        ack_timestamps = published.get("ack_timestamps")
        if row_partitions is None or ack_timestamps is None:
            if self.last_lifecycle is None:
                raise LiveCaptureError("row_partitions_required")
            rows = self.last_lifecycle.get("rows") or []
            row_partitions = [int(r["partition"]) for r in rows]
            ack_timestamps = [
                str(r.get("broker_timestamp") or r.get("db_timestamp") or "")
                for r in rows
            ]

        snap = capture_partition_leader_snapshots(
            before=self.leader_before,
            after=self.leader_after,
            row_partitions=list(row_partitions),
            ack_timestamps=list(ack_timestamps),
            batch_limit=self.batch_limit,
            invocation_id=invocation_id,
        )
        self.last_leaders = {
            str(k): int(v) for k, v in (snap.get("leaders") or {}).items()
        }
        return snap

    def bind_lifecycle_rows(
        self, invocation_id: str, published: Mapping[str, Any]
    ) -> dict[str, Any]:
        if self.log_cursor is None:
            raise LiveCaptureError("log_cursor_required")
        deadline = self.monotonic_fn() + self.lifecycle_bind_timeout_s
        while self.monotonic_fn() <= deadline:
            text = self._poll_logs()
            bound = bind_lifecycle_and_metadata_from_logs(
                log_text=text,
                invocation_id=invocation_id,
                published=published,
                leaders=self.last_leaders,
                batch_limit=self.batch_limit,
            )
            if bound is not None:
                lifecycle, metadata = bound
                self.last_lifecycle = lifecycle
                self.last_metadata = metadata
                return lifecycle
            self.sleep_fn(self.poll_interval_s)
        raise LiveCaptureError(
            f"lifecycle_bind_timeout:{invocation_id}:need={self.batch_limit}"
        )

    def record_metadata(
        self, invocation_id: str, published: Mapping[str, Any]
    ) -> dict[str, Any]:
        if self.last_metadata is not None and self.last_metadata.get(
            "invocation_id"
        ) == invocation_id:
            return self.last_metadata
        # Re-bind (will poll) to obtain primary RecordMetadata artifacts.
        self.bind_lifecycle_rows(invocation_id, published)
        if self.last_metadata is None:
            raise LiveCaptureError("primary_record_metadata_missing")
        return self.last_metadata


__all__ = [
    "LIVE_CAPTURE_ACCEPTANCE_READY",
    "TOPIC",
    "NAMESPACE",
    "OBSERVABILITY_NS",
    "POSTGRES_CONTAINER_NAME",
    "DEFAULT_POSTGRES_COMPOSE_SERVICE",
    "FROZEN_POSTGRES_COMPOSE_SERVICES",
    "COMPOSE_PROJECT_DEFAULT",
    "EXPECTED_OBSERVABILITY_PODS",
    "EXPECTED_AUCTION_MONITOR_TOPIC_PARTITIONS",
    "VALID_KAFKA_BROKER_IDS",
    "CommandRunner",
    "LiveCaptureError",
    "ForbiddenLiveCaptureCommand",
    "DockerExecutionPlanePin",
    "LogCursor",
    "assert_readonly_command",
    "assert_readonly_sql_payload",
    "build_readonly_psql_sql",
    "kafka_describe_template",
    "kafka_readonly_describe_props_stat_template",
    "assert_kafka_readonly_describe_props_present",
    "default_command_runner",
    "capture_runtime_pin",
    "capture_observability_snapshot",
    "discover_compose_container",
    "compose_ps_discovery_argv",
    "capture_docker_execution_plane",
    "verify_docker_execution_plane",
    "capture_db_counts_snapshot",
    "capture_db_total_count_diagnostic",
    "DB_COUNTS_SNAPSHOT_5S_SQL",
    "ATTEMPT_003_BLOCKING_TOTAL_COUNT_SQL",
    "is_live_interval_db_statement_timeout",
    "STATEMENT_TIMEOUT",
    "compute_database_equation_terms",
    "REQUIRED_PROVENANCE_COUNTER_SERIES",
    "parse_prometheus_exposition",
    "scrape_auction_monitor_prometheus",
    "validate_live_a1_counters_from_prometheus",
    "extract_process_start_time_seconds",
    "independently_recompute_db_provenance",
    "capture_publisher_log_cursor_readonly",
    "docker_execution_plane_as_dict",
    "kubectl_metrics_scrape_template",
    "AUCTION_MONITOR_METRICS_URL",
    "build_and_write_db_provenance",
    "build_fixture_db_provenance",
    "verify_db_provenance_raw_hashes",
    "describe_topic_leaders",
    "capture_leader_snapshot",
    "capture_partition_leader_snapshots",
    "scrape_auction_monitor_logs",
    "observe_publisher_tick_from_logs",
    "bind_lifecycle_and_metadata_from_logs",
    "LiveReadonlyCaptureSession",
]
