#!/usr/bin/env python3
"""Fixture tests for secret_name_alignment_audit.py"""
from __future__ import annotations

import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AUDIT = ROOT / "tools" / "bundle-audit" / "secret_name_alignment_audit.py"


def run_audit(repo: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(AUDIT), "--repo-root", str(repo)],
        capture_output=True,
        text=True,
        check=False,
    )


def write(repo: Path, rel: str, content: str) -> None:
    path = repo / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(content), encoding="utf-8")


class SecretAlignmentAuditTests(unittest.TestCase):
    def test_matching_producer_consumer_pass(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            write(
                repo,
                "infra/k8s/demo/secret.yaml",
                """
                apiVersion: v1
                kind: Secret
                metadata:
                  name: kafka-ssl-secret
                ---
                apiVersion: apps/v1
                kind: Deployment
                metadata:
                  name: demo
                spec:
                  template:
                    spec:
                      volumes:
                        - name: tls
                          secret:
                            secretName: kafka-ssl-secret
                """,
            )
            proc = run_audit(repo)
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
            self.assertIn("hard_fail=0", proc.stdout)

    def test_missing_consumer_fail(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            write(
                repo,
                "infra/k8s/demo/deploy.yaml",
                """
                apiVersion: apps/v1
                kind: Deployment
                metadata:
                  name: demo
                spec:
                  template:
                    spec:
                      volumes:
                        - name: tls
                          secret:
                            secretName: missing-secret
                """,
            )
            proc = run_audit(repo)
            self.assertEqual(proc.returncode, 1)
            self.assertRegex(proc.stdout, r"hard_fail=[1-9]")

    def test_report_hard_fail_matches_exit_status(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            write(
                repo,
                "infra/k8s/demo/deploy.yaml",
                """
                apiVersion: apps/v1
                kind: Deployment
                metadata:
                  name: demo
                spec:
                  template:
                    spec:
                      volumes:
                        - name: tls
                          secret:
                            secretName: rp-kafka-ssl-secret
                """,
            )
            proc = run_audit(repo)
            self.assertEqual(proc.returncode, 1)
            hard_fail = int(proc.stdout.rsplit("hard_fail=", 1)[-1].strip())
            self.assertGreater(hard_fail, 0)

    def test_declared_secret_satisfies_reference_pass(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            write(
                repo,
                "infra/k8s/base/observability/splunk-secret.yaml",
                """
                apiVersion: v1
                kind: Secret
                metadata:
                  name: splunk-secret
                """,
            )
            write(
                repo,
                "infra/k8s/base/observability/otel-collector-deploy.yaml",
                """
                apiVersion: apps/v1
                kind: Deployment
                metadata:
                  name: otel-collector
                spec:
                  template:
                    spec:
                      containers:
                        - name: otel
                          env:
                            - name: TOKEN
                              valueFrom:
                                secretKeyRef:
                                  name: splunk-secret
                                  key: hec-token
                """,
            )
            proc = run_audit(repo)
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
            self.assertIn("hard_fail=0", proc.stdout)

    def test_generated_report_is_not_scanned_as_input(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            report = repo / "docs/bundles/SECRET_NAME_ALIGNMENT_REPORT.md"
            report.parent.mkdir(parents=True, exist_ok=True)
            report.write_text(
                "# Secret name alignment audit\n\n"
                "Referenced secret `rp-kafka-ssl-secret` in infra/k8s/demo/deploy.yaml\n",
                encoding="utf-8",
            )
            proc = run_audit(repo)
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
            self.assertIn("hard_fail=0", proc.stdout)


if __name__ == "__main__":
    unittest.main()
