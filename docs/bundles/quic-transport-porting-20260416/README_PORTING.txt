Record Platform — QUIC transport + packet capture porting bundle
==================================================================

Defaults in this bundle (rewritten from OCH upstream):
  • Edge hostname / SNI: record.test  (override HOST / CAPTURE_EXPECTED_SNI)
  • App / workload Kubernetes namespace: record-platform  (override NS / HOUSING_NS)

Wire-level HTTP/3 / QUIC capture and transport-invariant tooling:
  Colima L1 node capture in STRICT mode, analyzers v5–v7, quic_command_center, optional Jaeger.

See MANIFEST.txt. Merge make-fragments/*.fragment into your Makefile (set REPO_ROOT / SCRIPTS).

Regenerate this tarball from the OCH repo (writes archive to $HOME by default):
  bash scripts/package-quic-transport-porting-bundle.sh
  RECORD_PLATFORM_PORTING_BUNDLE_DIR=/custom/dir bash scripts/package-quic-transport-porting-bundle.sh

No secrets. PCAPs and sslkeylog outputs are created at runtime under /tmp.
