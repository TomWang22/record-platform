#!/usr/bin/env python3
"""Fixture-based transport validator self-test (CI-safe; no live PCAP required)."""
from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
VALIDATOR = ROOT / "scripts" / "lib" / "transport_validator.py"


class TransportValidatorFixtureTests(unittest.TestCase):
    def test_cli_without_pcap_exits_2(self) -> None:
        proc = subprocess.run(
            [sys.executable, str(VALIDATOR)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 2)
        payload = json.loads(proc.stdout.strip())
        self.assertFalse(payload["valid"])
        self.assertEqual(payload["error"], "no pcap provided")

    def test_missing_pcap_file_exits_2(self) -> None:
        proc = subprocess.run(
            [sys.executable, str(VALIDATOR), "/tmp/does-not-exist-transport.pcap"],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 2)
        payload = json.loads(proc.stdout.strip())
        self.assertEqual(payload["error"], "pcap file not found")

    @patch("transport_validator.run")
    def test_http3_quic_valid(self, run_mock) -> None:
        sys.path.insert(0, str(VALIDATOR.parent))
        import transport_validator  # noqa: E402

        def fake_run(cmd, timeout=30):
            cmd_s = " ".join(cmd)
            if "-Y" in cmd and "quic" in cmd_s and "-c" in cmd and "1" in cmd:
                return subprocess.CompletedProcess(cmd, 0, stdout="1\n", stderr="")
            if "quic.version" in cmd_s:
                return subprocess.CompletedProcess(cmd, 0, stdout="0x00000001\n", stderr="")
            if "http2" in cmd_s and "-c" in cmd and "1" in cmd:
                return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
            if "quic.header_form == 0" in cmd_s:
                return subprocess.CompletedProcess(
                    cmd, 0, stdout="\n".join(str(i) for i in range(12)), stderr=""
                )
            if "quic.long.packet_type == 0" in cmd_s and "frame.time_epoch" in cmd_s:
                return subprocess.CompletedProcess(cmd, 0, stdout="1000.0\n", stderr="")
            if "quic.header_form == 0" in cmd_s and "frame.time_epoch" in cmd_s:
                return subprocess.CompletedProcess(cmd, 0, stdout="1000.05\n", stderr="")
            if "tls.handshake.extensions_alpn_str" in cmd_s:
                return subprocess.CompletedProcess(cmd, 0, stdout="h3\n", stderr="")
            if "frame.len" in cmd_s:
                return subprocess.CompletedProcess(cmd, 0, stdout="1200\n1300\n", stderr="")
            if "quic.packet_number" in cmd_s:
                return subprocess.CompletedProcess(cmd, 0, stdout="1\n2\n3\n", stderr="")
            if "quic.long.packet_type == 3" in cmd_s:
                return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

        run_mock.side_effect = fake_run
        fixture = ROOT / "scripts" / "protocol" / "fixtures" / "transport" / "http3-fixture.pcap"
        fixture.parent.mkdir(parents=True, exist_ok=True)
        fixture.write_bytes(b"PCAP_FIXTURE_PLACEHOLDER")
        with patch.object(sys, "argv", ["transport_validator.py", str(fixture)]):
            with self.assertRaises(SystemExit) as ctx:
                transport_validator.main()
        self.assertEqual(ctx.exception.code, 0)

    @patch("transport_validator.run")
    def test_http2_fallback_invalid(self, run_mock) -> None:
        sys.path.insert(0, str(VALIDATOR.parent))
        import transport_validator  # noqa: E402

        def fake_run(cmd, timeout=30):
            cmd_s = " ".join(cmd)
            if "-Y" in cmd and "quic" in cmd_s and "-c" in cmd and "1" in cmd:
                return subprocess.CompletedProcess(cmd, 0, stdout="1\n", stderr="")
            if "http2" in cmd_s and "-c" in cmd and "1" in cmd:
                return subprocess.CompletedProcess(cmd, 0, stdout="1\n", stderr="")
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

        run_mock.side_effect = fake_run
        fixture = ROOT / "scripts" / "protocol" / "fixtures" / "transport" / "http2-fallback.pcap"
        fixture.parent.mkdir(parents=True, exist_ok=True)
        fixture.write_bytes(b"PCAP_FIXTURE_PLACEHOLDER")
        with patch.object(sys, "argv", ["transport_validator.py", str(fixture)]):
            with self.assertRaises(SystemExit) as ctx:
                transport_validator.main()
        self.assertEqual(ctx.exception.code, 1)


if __name__ == "__main__":
    unittest.main()
