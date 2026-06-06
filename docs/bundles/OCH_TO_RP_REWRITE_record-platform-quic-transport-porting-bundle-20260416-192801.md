# OCH → RP rewrite scan: `record-platform-quic-transport-porting-bundle-20260416-192801`

**Staging (read-only scan):** `/Users/tom/bundle-staging/record-platform-quic-transport-porting-bundle-20260416-192801`

This report lists **detected** OCH-era strings. It does **not** apply edits.

---

## Namespace references

*Kubernetes / config namespace strings*

**Hits:** 1 (capped per file in scanner)

- `record-platform-quic-transport-porting-bundle/scripts/package-quic-transport-porting-bundle.sh`
  - L75: `perl -pi -e 's/off-campus-housing\.test/record.test/g' "$f"`

## SNI / hostnames

*Hosts, URLs, and dotted domains*

*None found in scanned text files.*

## OCH-prefixed identifiers

*Secrets, services, env keys with och- / och_*

**Hits:** 12 (capped per file in scanner)

- `record-platform-quic-transport-porting-bundle/scripts/lib/grpc-http3-health.sh`
  - L68: `if [[ -f "$lib_dir/ensure-och-grpc-certs.sh" ]]; then`
  - L69: `# shellcheck source=scripts/lib/ensure-och-grpc-certs.sh`
  - L70: `source "$lib_dir/ensure-och-grpc-certs.sh"`
  - L71: `och_sync_grpc_certs_to_dir "$grpc_certs_dir" "$ns" || true`
- `record-platform-quic-transport-porting-bundle/scripts/lib/packet-capture-v2.sh`
  - L17: `#      CAPTURE_V2_NODE_PCAP_BASENAME — file under VM $HOME for L1 tcpdump -w (default och-node-capture-v2.pcap; /tmp and /var/tmp may deny non-root).`
  - L55: `: "${CAPTURE_V2_NODE_PCAP_BASENAME:=och-node-capture-v2.pcap}"`
  - L132: `local _vm_bn="${CAPTURE_V2_NODE_PCAP_BASENAME:-och-node-capture-v2.pcap}"`
  - L326: `local _vm_bn_stop="${_CAPTURE_V2_NODE_VM_BN:-${CAPTURE_V2_NODE_PCAP_BASENAME:-och-node-capture-v2.pcap}}"`
- `record-platform-quic-transport-porting-bundle/scripts/test-packet-capture-standalone.sh`
  - L90: `if [[ -f "$SCRIPT_DIR/lib/ensure-och-grpc-certs.sh" ]]; then`
  - L91: `# shellcheck source=scripts/lib/ensure-och-grpc-certs.sh`
  - L92: `source "$SCRIPT_DIR/lib/ensure-och-grpc-certs.sh"`
  - L93: `och_sync_grpc_certs_to_dir "$GRPC_CERTS_DIR" "$NS" 2>/dev/null || true`

## K8s `namespace:` lines (YAML)

*Raw namespace: declarations*

*None found in scanned text files.*

## Cert / SAN hints

*x509-ish strings mentioning OCH hosts*

*None found in scanned text files.*

## Hardcoded gateway / legacy ports

*4020-style ports (RP api-gateway default is :4000)*

*None found in scanned text files.*

## HOUSING / legacy env

*Environment variables and assignments*

*None found in scanned text files.*

---

## Summary

Apply **`docs/bundles/OCH_TO_RP_CONVERSION_MATRIX.md`** when porting; prefer surgical patches over bulk replace.
