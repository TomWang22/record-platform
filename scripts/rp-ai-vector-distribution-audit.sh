#!/usr/bin/env bash
# T19.4A — Read-only embedded corpus distribution audit (no writes).
# COMMIT GUARD: commit only after all gates pass and embedded count unchanged.
#   T19_DIAG_GATES_PASSED=1 EMBEDDED_EXPECTED=4547 bash scripts/lib/rp-ai-diagnostics-commit-guard.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/rp-python-ai-psql.sh
source "$SCRIPT_DIR/lib/rp-python-ai-psql.sh"
# shellcheck source=lib/rp-network-contract.sh
source "$SCRIPT_DIR/lib/rp-network-contract.sh"
# shellcheck source=lib/resolve-lb-ip.sh
source "$SCRIPT_DIR/lib/resolve-lb-ip.sh"

REPORT_JSON="${REPORT_JSON:-$REPO_ROOT/bench_logs/ai-platform/t19-4-vector-distribution-audit.json}"
REPORT_MD="${REPORT_MD:-$REPO_ROOT/bench_logs/ai-platform/t19-4-vector-distribution-audit.md}"
mkdir -p "$(dirname "$REPORT_JSON")"

CA="${REPO_ROOT}/certs/dev-chain.pem"
LB_IP="$(rp_discover_metallb_ip || echo "${TARGET_IP:-}")"
API_BASE="https://record-platform.test"
AUTH_EMAIL="${RP_COMB_EMAIL:-e2e-contract@record-platform.local}"
AUTH_PASS="${RP_COMB_PASSWORD:-ContractPass123!}"
CURL_TLS=(--cacert "$CA" --resolve "record-platform.test:443:${LB_IP}")

echo "=== T19.4A vector distribution audit (read-only) ==="

rp_python_ai_psql_connect_check || { echo "❌ python_ai DB unreachable"; exit 1; }

TOKEN="$(curl -sfS "${CURL_TLS[@]}" --max-time 20 -X POST "$API_BASE/api/auth/login" \
  -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
  -d "{\"email\":\"$AUTH_EMAIL\",\"password\":\"$AUTH_PASS\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))')"
[[ -n "$TOKEN" ]] || { echo "❌ auth failed"; exit 1; }

export TOKEN REPORT_JSON REPORT_MD
python3 <<'PY'
import base64, json, os, re, subprocess, sys
from datetime import datetime, timezone

report_json = os.environ["REPORT_JSON"]
report_md = os.environ["REPORT_MD"]
token = os.environ["TOKEN"]

def psql(sql: str) -> str:
    env = os.environ.copy()
    env.setdefault("PGPASSWORD", "postgres")
    env.setdefault("PGHOST", "127.0.0.1")
    env.setdefault("PYTHON_AI_PGPORT", "5440")
    env.setdefault("PGUSER", "postgres")
    env.setdefault("PYTHON_AI_DB", "python_ai")
    cmd = [
        "psql", "-h", env["PGHOST"], "-p", env["PYTHON_AI_PGPORT"],
        "-U", env["PGUSER"], "-d", env["PYTHON_AI_DB"],
        "-v", "ON_ERROR_STOP=1", "-At", "-c", sql,
    ]
    return subprocess.check_output(cmd, env=env, text=True).strip()

def psql_json(sql: str):
    raw = psql(sql)
    if not raw:
        return []
    return [json.loads(line) for line in raw.splitlines() if line.strip()]


def jwt_user_id(jwt_token: str) -> str:
    try:
        payload = jwt_token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        data = json.loads(base64.urlsafe_b64decode(payload))
        for key in ("sub", "userId", "user_id", "id"):
            val = data.get(key)
            if val and str(val).strip():
                return str(val).strip()
    except Exception:
        pass
    return ""


contract_user_id = jwt_user_id(token)
if not contract_user_id:
    contract_user_id = psql(
        "SELECT COALESCE("
        "(SELECT d.owner_user_id FROM ai.ai_documents d "
        " JOIN ai.ai_document_chunks c ON c.document_id=d.id "
        " WHERE c.embedding_vec IS NOT NULL AND d.owner_user_id IS NOT NULL "
        " GROUP BY d.owner_user_id ORDER BY count(*) DESC LIMIT 1), '');"
    )

uid_sql = contract_user_id.replace("'", "''")

total_embedded = int(psql(
    "SELECT count(*) FROM ai.ai_document_chunks WHERE embedding_vec IS NOT NULL;"
))

by_source_type = psql_json("""
SELECT json_build_object(
  'source_type', d.source_type,
  'count', count(*)::int
) FROM ai.ai_document_chunks c
JOIN ai.ai_documents d ON d.id = c.document_id
WHERE c.embedding_vec IS NOT NULL
GROUP BY d.source_type ORDER BY d.source_type;
""")

by_visibility = psql_json("""
SELECT json_build_object(
  'visibility', d.visibility,
  'count', count(*)::int
) FROM ai.ai_document_chunks c
JOIN ai.ai_documents d ON d.id = c.document_id
WHERE c.embedding_vec IS NOT NULL
GROUP BY d.visibility ORDER BY d.visibility;
""")

by_owner_bucket = psql_json("""
SELECT json_build_object(
  'owner_user_id_bucket', owner_user_id_bucket,
  'count', cnt
) FROM (
  SELECT
    CASE WHEN d.owner_user_id IS NULL THEN 'null' ELSE 'non_null' END AS owner_user_id_bucket,
    count(*)::int AS cnt
  FROM ai.ai_document_chunks c
  JOIN ai.ai_documents d ON d.id = c.document_id
  WHERE c.embedding_vec IS NOT NULL
  GROUP BY 1
) t ORDER BY owner_user_id_bucket;
""")

chunk_length_stats = psql_json("""
SELECT json_build_object(
  'source_type', d.source_type,
  'avg_len', round(avg(length(c.content))::numeric, 1),
  'min_len', min(length(c.content))::int,
  'max_len', max(length(c.content))::int
) FROM ai.ai_document_chunks c
JOIN ai.ai_documents d ON d.id = c.document_id
WHERE c.embedding_vec IS NOT NULL
GROUP BY d.source_type ORDER BY d.source_type;
""")

latest_embedding_updated = psql_json("""
SELECT json_build_object(
  'source_type', d.source_type,
  'latest_embedding_updated_at', max(c.embedding_updated_at)::text
) FROM ai.ai_document_chunks c
JOIN ai.ai_documents d ON d.id = c.document_id
WHERE c.embedding_vec IS NOT NULL
GROUP BY d.source_type ORDER BY d.source_type;
""")

privacy_excluded = psql_json("""
SELECT json_build_object(
  'source_type', source_type,
  'excluded_count', excluded_count,
  'reason', reason
) FROM (
  SELECT d.source_type,
    count(*)::int AS excluded_count,
    CASE
      WHEN d.source_type = 'message' THEN 'message_type'
      WHEN bool_or(c.content ~* 'max_bid_cents|proxy_bids|proxy max') THEN 'forbidden_proxy_content'
      WHEN bool_or(d.visibility = 'private') THEN 'private_visibility'
      ELSE 'other'
    END AS reason
  FROM ai.ai_document_chunks c
  JOIN ai.ai_documents d ON d.id = c.document_id
  WHERE c.embedding_vec IS NOT NULL
    AND (
      d.source_type = 'message'
      OR c.content ~* 'max_bid_cents|proxy_bids|proxy max'
      OR d.visibility = 'private'
    )
  GROUP BY d.source_type,
    CASE
      WHEN d.source_type = 'message' THEN 'message_type'
      WHEN c.content ~* 'max_bid_cents|proxy_bids|proxy max' THEN 'forbidden_proxy_content'
      WHEN d.visibility = 'private' THEN 'private_visibility'
      ELSE 'other'
    END
) t ORDER BY source_type, reason;
""")

scope_excluded = []
if contract_user_id:
    scope_excluded = psql_json(f"""
SELECT json_build_object(
  'source_type', d.source_type,
  'excluded_from_contract_scope', count(*)::int
) FROM ai.ai_document_chunks c
JOIN ai.ai_documents d ON d.id = c.document_id
WHERE c.embedding_vec IS NOT NULL
  AND NOT (
    d.visibility = 'public'
    OR (d.visibility = 'owner' AND d.owner_user_id = '{uid_sql}')
  )
GROUP BY d.source_type ORDER BY d.source_type;
""")

scope_embedded = 0
if contract_user_id:
    scope_embedded = int(psql(f"""
SELECT count(*) FROM ai.ai_document_chunks c
JOIN ai.ai_documents d ON d.id = c.document_id
WHERE c.embedding_vec IS NOT NULL
  AND d.source_type <> 'message'
  AND (
    d.visibility = 'public'
    OR (d.visibility = 'owner' AND d.owner_user_id = '{uid_sql}')
  );
"""))

samples = psql_json("""
SELECT json_build_object(
  'source_type', d.source_type,
  'sample_index', rn,
  'label', left(regexp_replace(COALESCE(d.title, ''), E'[\\n\\r\\t]+', ' ', 'g'), 120)
) FROM (
  SELECT d.source_type, d.title,
    row_number() OVER (PARTITION BY d.source_type ORDER BY d.source_updated_at DESC, c.chunk_index) AS rn
  FROM ai.ai_document_chunks c
  JOIN ai.ai_documents d ON d.id = c.document_id
  WHERE c.embedding_vec IS NOT NULL
) d
WHERE rn <= 5
ORDER BY source_type, rn;
""")

samples_by_type = {}
for row in samples:
    st = row["source_type"]
    samples_by_type.setdefault(st, []).append(row["label"])

report = {
    "ticket": "T19.4A",
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "read_only": True,
    "contract_user_id": contract_user_id or None,
    "total_embedded": total_embedded,
    "embedded_in_contract_scope": scope_embedded,
    "embedded_by_source_type": by_source_type,
    "embedded_by_visibility": by_visibility,
    "embedded_by_owner_user_id_bucket": by_owner_bucket,
    "chunk_length_by_source_type": chunk_length_stats,
    "latest_embedding_updated_at_by_source_type": latest_embedding_updated,
    "privacy_excluded_embedded_by_source_type": privacy_excluded,
    "scope_excluded_from_contract_user_by_source_type": scope_excluded,
    "safe_sample_labels_by_source_type": samples_by_type,
}

with open(report_json, "w") as f:
    json.dump(report, f, indent=2)

lines = [
    "# T19.4A — Vector distribution audit (read-only)",
    "",
    f"**Generated:** {report['generated_at']}",
    f"**Total embedded:** {total_embedded}",
    f"**Contract user scope embedded (excl. message):** {scope_embedded}",
    f"**Contract user id:** `{contract_user_id or '(unknown)'}`",
    "",
    "## Embedded by source_type",
    "",
    "| source_type | count |",
    "|-------------|------:|",
]
for row in by_source_type:
    lines.append(f"| {row['source_type']} | {row['count']} |")

lines += ["", "## Embedded by visibility", "", "| visibility | count |", "|------------|------:|"]
for row in by_visibility:
    lines.append(f"| {row['visibility']} | {row['count']} |")

lines += ["", "## Owner user_id bucket", "", "| bucket | count |", "|--------|------:|"]
for row in by_owner_bucket:
    lines.append(f"| {row['owner_user_id_bucket']} | {row['count']} |")

lines += [
    "",
    "## Chunk length by source_type",
    "",
    "| source_type | avg | min | max |",
    "|-------------|----:|----:|----:|",
]
for row in chunk_length_stats:
    lines.append(
        f"| {row['source_type']} | {row['avg_len']} | {row['min_len']} | {row['max_len']} |"
    )

lines += [
    "",
    "## Latest embedding_updated_at by source_type",
    "",
    "| source_type | latest |",
    "|-------------|--------|",
]
for row in latest_embedding_updated:
    lines.append(f"| {row['source_type']} | {row['latest_embedding_updated_at'] or '(null)'} |")

lines += [
    "",
    "## Privacy-excluded embedded chunks (global)",
    "",
]
if privacy_excluded:
    lines += ["| source_type | reason | excluded |", "|-------------|--------|--------:|"]
    for row in privacy_excluded:
        lines.append(f"| {row['source_type']} | {row['reason']} | {row['excluded_count']} |")
else:
    lines.append("_None (no message/private/forbidden-proxy embedded rows)._")

lines += ["", "## Excluded from contract user scope (owner/public filter)", "",]
if scope_excluded:
    lines += ["| source_type | excluded_from_scope |", "|-------------|--------------------:|"]
    for row in scope_excluded:
        lines.append(f"| {row['source_type']} | {row['excluded_from_contract_scope']} |")
else:
    lines.append("_All embedded rows visible to contract user (or scope user unknown)._")

lines += ["", "## Safe sample labels (title only, max 5 per type)", ""]
for st in sorted(samples_by_type):
    lines.append(f"### {st}")
    for i, label in enumerate(samples_by_type[st], 1):
        safe = re.sub(r"[^\x20-\x7E]", "?", label or "(empty)")
        lines.append(f"{i}. {safe}")
    lines.append("")

with open(report_md, "w") as f:
    f.write("\n".join(lines) + "\n")

print(f"JSON → {report_json}")
print(f"MD   → {report_md}")
print(f"total_embedded={total_embedded}")
PY

echo "✅ T19.4A complete"
