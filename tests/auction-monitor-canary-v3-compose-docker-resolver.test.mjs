/**
 * Compose-label Docker resolver for Track A live capture (11 Postgres services).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIB = join(REPO, "scripts/lib");

function py(code) {
  const r = spawnSync(
    "python3",
    ["-c", code],
    { cwd: REPO, encoding: "utf8", env: { ...process.env, PYTHONPATH: LIB } },
  );
  return {
    status: r.status ?? 1,
    stdout: (r.stdout || "").trim(),
    stderr: (r.stderr || "").trim(),
  };
}

const FIXTURE_ID_SHORT = "30308496a7cf";
const FIXTURE_ID_FULL =
  "30308496a7cf4fcddaa3b35d87f81baaf42b8f3aebc4ad71ba4926852c2ca5fc";
const FIXTURE_NAME = "record-platform-postgres-auction-monitor-core-1";

test("resolver: current Compose shape pins container ID not service name", () => {
  const r = py(`
import json
from auction_monitor_canary_v3_live_capture import discover_compose_container

inspect_targets = []

def runner(*args, **kwargs):
    if args[:3] == ("docker", "context", "show"):
        return "colima\\n"
    if args[:3] == ("docker", "ps", "--quiet"):
        assert args[4] == "label=com.docker.compose.project=record-platform"
        assert args[6] == "label=com.docker.compose.service=postgres-auction-monitor-core"
        return "${FIXTURE_ID_SHORT}\\n"
    if args[0] == "docker" and args[1] == "inspect":
        # target is last arg after optional --format
        target = args[-1]
        inspect_targets.append(target)
        assert target == "${FIXTURE_ID_SHORT}", target
        assert target != "postgres-auction-monitor-core"
        return json.dumps({
            "Id": "${FIXTURE_ID_FULL}",
            "Name": "/${FIXTURE_NAME}",
            "Image": "sha256:pgimg",
            "Config": {"Labels": {
                "com.docker.compose.project": "record-platform",
                "com.docker.compose.service": "postgres-auction-monitor-core",
            }},
        })
    raise AssertionError(args)

pin = discover_compose_container(
    compose_service="postgres-auction-monitor-core",
    runner=runner,
    docker_host="unix:///tmp/colima.sock",
    colima_profile="default",
)
assert pin.container_name == "${FIXTURE_NAME}"
assert pin.container_id == "${FIXTURE_ID_FULL}"
assert pin.compose_service == "postgres-auction-monitor-core"
assert pin.compose_project == "record-platform"
assert inspect_targets == ["${FIXTURE_ID_SHORT}"]
print("ok")
`);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.equal(r.stdout, "ok");
});

test("resolver: zero label matches fails", () => {
  const r = py(`
from auction_monitor_canary_v3_live_capture import discover_compose_container, LiveCaptureError

def runner(*args, **kwargs):
    if args[:3] == ("docker", "context", "show"):
        return "colima\\n"
    if args[:3] == ("docker", "ps", "--quiet"):
        return "\\n"
    raise AssertionError(args)

try:
    discover_compose_container(compose_service="postgres-auction-monitor-core", runner=runner)
    raise SystemExit("expected failure")
except LiveCaptureError as e:
    assert "docker_compose_service_not_found" in str(e), e
print("ok")
`);
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test("resolver: two label matches fails", () => {
  const r = py(`
from auction_monitor_canary_v3_live_capture import discover_compose_container, LiveCaptureError

def runner(*args, **kwargs):
    if args[:3] == ("docker", "context", "show"):
        return "colima\\n"
    if args[:3] == ("docker", "ps", "--quiet"):
        return "aaaaaaaaaaaa\\nbbbbbbbbbbbb\\n"
    raise AssertionError(args)

try:
    discover_compose_container(compose_service="postgres-auction-monitor-core", runner=runner)
    raise SystemExit("expected failure")
except LiveCaptureError as e:
    assert "docker_compose_service_ambiguous" in str(e), e
print("ok")
`);
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test("resolver: compose project label mismatch fails", () => {
  const r = py(`
import json
from auction_monitor_canary_v3_live_capture import discover_compose_container, LiveCaptureError

def runner(*args, **kwargs):
    if args[:3] == ("docker", "context", "show"):
        return "colima\\n"
    if args[:3] == ("docker", "ps", "--quiet"):
        return "${FIXTURE_ID_SHORT}\\n"
    if args[0] == "docker" and args[1] == "inspect":
        return json.dumps({
            "Id": "${FIXTURE_ID_FULL}",
            "Name": "/${FIXTURE_NAME}",
            "Image": "sha256:pgimg",
            "Config": {"Labels": {
                "com.docker.compose.project": "other-project",
                "com.docker.compose.service": "postgres-auction-monitor-core",
            }},
        })
    raise AssertionError(args)

try:
    discover_compose_container(compose_service="postgres-auction-monitor-core", runner=runner)
    raise SystemExit("expected failure")
except LiveCaptureError as e:
    assert "docker_compose_project_label_mismatch" in str(e), e
print("ok")
`);
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test("resolver: compose service label mismatch fails", () => {
  const r = py(`
import json
from auction_monitor_canary_v3_live_capture import discover_compose_container, LiveCaptureError

def runner(*args, **kwargs):
    if args[:3] == ("docker", "context", "show"):
        return "colima\\n"
    if args[:3] == ("docker", "ps", "--quiet"):
        return "${FIXTURE_ID_SHORT}\\n"
    if args[0] == "docker" and args[1] == "inspect":
        return json.dumps({
            "Id": "${FIXTURE_ID_FULL}",
            "Name": "/${FIXTURE_NAME}",
            "Image": "sha256:pgimg",
            "Config": {"Labels": {
                "com.docker.compose.project": "record-platform",
                "com.docker.compose.service": "postgres-records",
            }},
        })
    raise AssertionError(args)

try:
    discover_compose_container(compose_service="postgres-auction-monitor-core", runner=runner)
    raise SystemExit("expected failure")
except LiveCaptureError as e:
    assert "docker_compose_service_label_mismatch" in str(e), e
print("ok")
`);
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test("resolver: container ID mismatch fails", () => {
  const r = py(`
import json
from auction_monitor_canary_v3_live_capture import discover_compose_container, LiveCaptureError

def runner(*args, **kwargs):
    if args[:3] == ("docker", "context", "show"):
        return "colima\\n"
    if args[:3] == ("docker", "ps", "--quiet"):
        return "${FIXTURE_ID_SHORT}\\n"
    if args[0] == "docker" and args[1] == "inspect":
        return json.dumps({
            "Id": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            "Name": "/${FIXTURE_NAME}",
            "Image": "sha256:pgimg",
            "Config": {"Labels": {
                "com.docker.compose.project": "record-platform",
                "com.docker.compose.service": "postgres-auction-monitor-core",
            }},
        })
    raise AssertionError(args)

try:
    discover_compose_container(compose_service="postgres-auction-monitor-core", runner=runner)
    raise SystemExit("expected failure")
except LiveCaptureError as e:
    assert "docker_container_id_mismatch" in str(e), e
print("ok")
`);
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test("resolver: docker context mismatch fails", () => {
  const r = py(`
import json
from auction_monitor_canary_v3_live_capture import discover_compose_container, LiveCaptureError

def runner(*args, **kwargs):
    if args[:3] == ("docker", "context", "show"):
        return "desktop-linux\\n"
    raise AssertionError(args)

try:
    discover_compose_container(
        compose_service="postgres-auction-monitor-core",
        runner=runner,
        expected_docker_context="colima",
    )
    raise SystemExit("expected failure")
except LiveCaptureError as e:
    assert "docker_context_mismatch" in str(e), e
print("ok")
`);
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test("resolver: DOCKER_HOST / image digest drift fails verify", () => {
  const r = py(`
import json
import os
from auction_monitor_canary_v3_live_capture import (
    DockerExecutionPlanePin,
    verify_docker_execution_plane,
    LiveCaptureError,
)

pin = DockerExecutionPlanePin(
    colima_profile="default",
    docker_host="unix:///tmp/a.sock",
    docker_context="colima",
    compose_project="record-platform",
    compose_service="postgres-auction-monitor-core",
    container_id="${FIXTURE_ID_FULL}",
    container_name="${FIXTURE_NAME}",
    image_digest="sha256:pgimg",
)

def runner(*args, **kwargs):
    if args[:3] == ("docker", "context", "show"):
        return "colima\\n"
    if args[:3] == ("docker", "ps", "--quiet"):
        return "${FIXTURE_ID_SHORT}\\n"
    if args[0] == "docker" and args[1] == "inspect":
        return json.dumps({
            "Id": "${FIXTURE_ID_FULL}",
            "Name": "/${FIXTURE_NAME}",
            "Image": "sha256:DRIFTED",
            "Config": {"Labels": {
                "com.docker.compose.project": "record-platform",
                "com.docker.compose.service": "postgres-auction-monitor-core",
            }},
        })
    raise AssertionError(args)

os.environ["DOCKER_HOST"] = "unix:///tmp/a.sock"
try:
    verify_docker_execution_plane(pin, runner=runner)
    raise SystemExit("expected image drift failure")
except LiveCaptureError as e:
    assert "docker_image_digest_mismatch" in str(e), e

os.environ["DOCKER_HOST"] = "unix:///tmp/OTHER.sock"
try:
    verify_docker_execution_plane(pin, runner=runner)
    raise SystemExit("expected host drift failure")
except LiveCaptureError as e:
    assert "docker_host_mismatch" in str(e), e
print("ok")
`);
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test("resolver: inspect of compose service name is not allowlisted", () => {
  const r = py(`
from auction_monitor_canary_v3_live_capture import assert_readonly_command, ForbiddenLiveCaptureCommand

try:
    assert_readonly_command(["docker", "inspect", "postgres-auction-monitor-core"])
    raise SystemExit("expected forbid")
except ForbiddenLiveCaptureCommand as e:
    assert "not_allowlisted" in str(e) or "forbidden" in str(e).lower(), e
print("ok")
`);
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test("resolver: fixture works for all 11 frozen Postgres compose services", () => {
  const r = py(`
import json
from auction_monitor_canary_v3_live_capture import (
    discover_compose_container,
    FROZEN_POSTGRES_COMPOSE_SERVICES,
)

assert len(FROZEN_POSTGRES_COMPOSE_SERVICES) == 11
for svc in FROZEN_POSTGRES_COMPOSE_SERVICES:
    short = "a" * 12
    full = "a" * 64
    name = f"record-platform-{svc}-1"
    def make_runner(service=svc, short_id=short, full_id=full, cname=name):
        def runner(*args, **kwargs):
            if args[:3] == ("docker", "context", "show"):
                return "colima\\n"
            if args[:3] == ("docker", "ps", "--quiet"):
                assert args[6] == f"label=com.docker.compose.service={service}"
                return short_id + "\\n"
            if args[0] == "docker" and args[1] == "inspect":
                assert args[-1] == short_id
                return json.dumps({
                    "Id": full_id,
                    "Name": "/" + cname,
                    "Image": "sha256:x",
                    "Config": {"Labels": {
                        "com.docker.compose.project": "record-platform",
                        "com.docker.compose.service": service,
                    }},
                })
            raise AssertionError(args)
        return runner
    pin = discover_compose_container(compose_service=svc, runner=make_runner())
    assert pin.compose_service == svc
    assert pin.container_name == name
print("ok")
`);
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test("resolver: T0/T1 remain bound to same docker pin container_id", () => {
  const r = py(`
import json
from auction_monitor_canary_v3_live_capture import (
    DockerExecutionPlanePin,
    verify_docker_execution_plane,
    assert_readonly_command,
    ForbiddenLiveCaptureCommand,
)

pin = DockerExecutionPlanePin(
    colima_profile="default",
    docker_host="",
    docker_context="colima",
    compose_project="record-platform",
    compose_service="postgres-auction-monitor-core",
    container_id="${FIXTURE_ID_FULL}",
    container_name="${FIXTURE_NAME}",
    image_digest="sha256:pgimg",
)

def runner(*args, **kwargs):
    if args[0] == "docker" and args[1] == "context":
        return "colima\\n"
    if args[0] == "docker" and args[1] == "ps":
        return "${FIXTURE_ID_SHORT}\\n"
    if args[0] == "docker" and args[1] == "inspect":
        return json.dumps({
            "Id": "${FIXTURE_ID_FULL}",
            "Name": "/${FIXTURE_NAME}",
            "Image": "sha256:pgimg",
            "Config": {"Labels": {
                "com.docker.compose.project": "record-platform",
                "com.docker.compose.service": "postgres-auction-monitor-core",
            }},
        })
    raise AssertionError(args)

verified = verify_docker_execution_plane(pin, runner=runner)
assert verified.container_id == pin.container_id == "${FIXTURE_ID_FULL}"

# Allowlisted psql must use the exact pinned ID
assert_readonly_command(
    ["docker", "exec", pin.container_id, "psql", "-U", "postgres", "-d", "postgres",
     "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", "SELECT 1"],
    pinned_container_id=pin.container_id,
)
try:
    assert_readonly_command(
        ["docker", "exec", "deadbeefdead", "psql", "-U", "postgres", "-d", "postgres",
         "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", "SELECT 1"],
        pinned_container_id=pin.container_id,
    )
    raise SystemExit("expected pin mismatch")
except ForbiddenLiveCaptureCommand as e:
    assert "docker_exec_container_pin_mismatch" in str(e), e
print("ok")
`);
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
