# HTTP/3 PCAP fixture (canonical)

## Canonical path

- Repository path: `bench_logs/security-contract/pcap/vm-2026-06-10.pcap`
- Tracked as a normal Git object (not Git LFS)
- Checksum manifest: `bench_logs/security-contract/pcap/SHA256SUMS`

## Capture metadata

| Field | Value |
|-------|-------|
| Capture date | 2026-06-10 |
| Interface / environment | VM edge transport lab (sanitized security-contract bench) |
| Purpose | CI/offline HTTP/3 + QUIC wire validation for transport gate |
| Privacy | Sanitized fixture; no credentials or payload bodies |

## Wire evidence

| Check | Expected |
|-------|----------|
| Parseable PCAP | yes |
| TCP port 443 | not required for this UDP/QUIC-only VM capture |
| UDP port 443 | observed |
| QUIC packets | yes |
| HTTP/3-positive | QUIC v1 (`0x00000001`) with sustained 1-RTT phase |
| QUIC wire version | `0x00000001` (RFC 9000 QUIC v1 — not draft-ietf-quic-v7) |
| False HTTP/2 fallback | none |
| Minimum packet count | > 1000 (validator caps scan at 5000) |

## SHA-256

```
e16571b9db8f8c7b199b997f2fa3a93a37290984a1dfa827036b3ae52f89ab1d  vm-2026-06-10.pcap
```

## Validator contract

```bash
# Mandatory real-PCAP gate
bash scripts/verify-transport-pcap-fixture.sh

# No-input self-test (exit 2, not a substitute for real PCAP)
python3 scripts/lib/transport_validator.py
```

Expected real-PCAP result: `"valid": true`, `quic_version`: `0x00000001`.

## Update procedure

1. Capture sanitized VM HTTP/3 traffic to `bench_logs/security-contract/pcap/vm-YYYY-MM-DD.pcap`.
2. Run `shasum -a 256` and update `SHA256SUMS`.
3. Run `bash scripts/verify-transport-pcap-fixture.sh` locally.
4. Update this document with new date, SHA-256, and wire version from tshark.
