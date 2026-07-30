#!/usr/bin/env python3
"""Regression tests for preflight_static_contract_check.py"""
from __future__ import annotations

import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECK = ROOT / "tools" / "bundle-audit" / "preflight_static_contract_check.py"
PREFLIGHT = ROOT / "scripts" / "run-preflight-scale-and-all-suites.sh"


def run_check(repo: Path, preflight: Path | None = None) -> subprocess.CompletedProcess[str]:
    cmd = [sys.executable, str(CHECK), "--repo-root", str(repo)]
    if preflight is not None:
        cmd += ["--preflight-script", str(preflight)]
    return subprocess.run(cmd, capture_output=True, text=True, check=False)


def write(repo: Path, rel: str, content: str) -> None:
    path = repo / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(content), encoding="utf-8")


class PreflightStaticContractTests(unittest.TestCase):
    def test_clean_repo_passes(self) -> None:
        proc = run_check(ROOT, PREFLIGHT)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn("issues=0", proc.stdout)

    def test_missing_script_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            write(repo, "Makefile", "bash scripts/missing-preflight-helper.sh\n")
            write(repo, "scripts/run-preflight-scale-and-all-suites.sh", "#!/usr/bin/env bash\necho ok\n")
            proc = run_check(repo)
            self.assertEqual(proc.returncode, 1)
            self.assertIn("MISSING_SCRIPT_REFERENCE", proc.stderr)

    def test_legacy_namespace_reference_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            write(repo, "Makefile", "bash scripts/init-hybrid-rp-rp-backup-layout.sh\n")
            write(repo, "scripts/run-preflight-scale-and-all-suites.sh", "#!/usr/bin/env bash\necho ok\n")
            proc = run_check(repo)
            self.assertEqual(proc.returncode, 1)
            self.assertIn("LEGACY_NAMESPACE_SCRIPT_REFERENCE", proc.stderr)

    def test_generated_report_not_used_as_input(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            write(repo, "Makefile", "")
            write(repo, "scripts/run-preflight-scale-and-all-suites.sh", "#!/usr/bin/env bash\necho ok\n")
            write(repo, "tools/bundle-audit/secret_name_alignment_audit.py", "print('ok')\n")
            for rel in (
                "scripts/trace-validators/run-step7-observability-gates.mjs",
                "scripts/service-tls-alias-guard.sh",
                "scripts/preflight-controlled-transport-otel-prove.sh",
                "scripts/verify-jaeger-trace-flows.mjs",
            ):
                write(repo, rel, "// stub\n")
            (repo / "scripts/trace-validators").mkdir(parents=True, exist_ok=True)
            report = repo / "docs/bundles/PREFLIGHT_STATIC_CONTRACT_REPORT.md"
            report.parent.mkdir(parents=True, exist_ok=True)
            report.write_text("Missing script: `scripts/should-not-count.sh`\n", encoding="utf-8")
            proc = run_check(repo)
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)


if __name__ == "__main__":
    unittest.main()
