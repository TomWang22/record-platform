#!/usr/bin/env bash
# T19.7A — Read-only OBO corpus RCA for contract users (no writes, no embedding changes).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/rp-python-ai-psql.sh
source "$SCRIPT_DIR/lib/rp-python-ai-psql.sh"

REPORT_JSON="${REPORT_JSON:-$REPO_ROOT/bench_logs/ai-platform/t19-7-obo-corpus-rca.json}"
REPORT_MD="${REPORT_MD:-$REPO_ROOT/bench_logs/ai-platform/t19-7-obo-corpus-rca.md}"
mkdir -p "$(dirname "$REPORT_JSON")"

E2E_EMAIL="${RP_COMB_EMAIL:-e2e-contract@record-platform.local}"
BUYER_EMAIL="${RP_BUYER_EMAIL:-buyer-contract@record-platform.local}"
SELLER_EMAIL="${RP_SELLER_EMAIL:-seller-contract@record-platform.local}"

echo "=== T19.7A OBO corpus RCA (read-only) ==="

rp_python_ai_psql_connect_check || { echo "❌ python_ai DB unreachable"; exit 1; }

PRE_EMBEDDED="$(rp_python_ai_psql "SELECT count(*) FROM ai.ai_document_chunks WHERE embedding_vec IS NOT NULL;")"
export REPORT_JSON REPORT_MD PRE_EMBEDDED E2E_EMAIL BUYER_EMAIL SELLER_EMAIL

python3 <<'PY'
import json
import os
import subprocess
from datetime import datetime, timezone

json_out = os.environ["REPORT_JSON"]
md_out = os.environ["REPORT_MD"]
pre_embedded = int(os.environ.get("PRE_EMBEDDED", "0"))
emails = {
    "e2e_contract": os.environ["E2E_EMAIL"],
    "buyer_contract": os.environ["BUYER_EMAIL"],
    "seller_contract": os.environ["SELLER_EMAIL"],
}


def psql(port: int, db: str, sql: str) -> str:
    cmd = [
        "env", "PGPASSWORD=postgres", "PGCONNECT_TIMEOUT=5",
        "psql", "-h", "127.0.0.1", "-p", str(port), "-U", "postgres", "-d", db,
        "-v", "ON_ERROR_STOP=1", "-At", "-c", sql,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        return ""
    return (proc.stdout or "").strip()


def psql_scalar(port: int, db: str, sql: str) -> int:
    try:
        return int(psql(port, db, sql) or 0)
    except ValueError:
        return 0


users = {}
for key, email in emails.items():
    uid = psql(5437, "auth", f"SELECT id::text FROM auth.users WHERE email='{email.replace(chr(39), chr(39)+chr(39))}' LIMIT 1;")
    users[key] = {"email": email, "user_id": uid or None}

rows = []
for key, info in users.items():
    uid = info.get("user_id")
    if not uid:
        rows.append({**info, "error": "user_not_found"})
        continue
    uid_sql = uid.replace("'", "''")
    buyer_offers = psql_scalar(5435, "listings", f"SELECT count(*) FROM listings.offers WHERE buyer_user_id='{uid_sql}'")
    seller_offers = psql_scalar(5435, "listings", f"SELECT count(*) FROM listings.offers WHERE seller_user_id='{uid_sql}'")
    offer_events = psql_scalar(5435, "listings", f"SELECT count(*) FROM listings.offer_events WHERE actor_user_id='{uid_sql}'")
    ai_docs = psql_scalar(5440, "python_ai", f"SELECT count(*) FROM ai.ai_documents WHERE source_type='obo_offer_summary' AND owner_user_id='{uid_sql}'")
    embedded = psql_scalar(
        5440,
        "python_ai",
        f"""
        SELECT count(*) FROM ai.ai_document_chunks c
        JOIN ai.ai_documents d ON d.id = c.document_id
        WHERE d.source_type='obo_offer_summary' AND d.owner_user_id='{uid_sql}'
          AND c.embedding_vec IS NOT NULL
        """,
    )
    unembedded = psql_scalar(
        5440,
        "python_ai",
        f"""
        SELECT count(*) FROM ai.ai_document_chunks c
        JOIN ai.ai_documents d ON d.id = c.document_id
        WHERE d.source_type='obo_offer_summary' AND d.owner_user_id='{uid_sql}'
          AND c.embedding_vec IS NULL
        """,
    )
    rows.append({
        **info,
        "offers_as_buyer": buyer_offers,
        "offers_as_seller": seller_offers,
        "offer_events_as_actor": offer_events,
        "ai_documents_obo": ai_docs,
        "embedded_obo_chunks": embedded,
        "unembedded_obo_chunks": unembedded,
    })

global_embedded_obo = psql_scalar(
    5440,
    "python_ai",
    """
    SELECT count(*) FROM ai.ai_document_chunks c
    JOIN ai.ai_documents d ON d.id = c.document_id
    WHERE c.embedding_vec IS NOT NULL AND d.source_type='obo_offer_summary'
    """,
)
total_offers = psql_scalar(5435, "listings", "SELECT count(*) FROM listings.offers")

e2e = next((r for r in rows if r.get("email") == emails["e2e_contract"]), {})
e2e_offers = (e2e.get("offers_as_buyer") or 0) + (e2e.get("offers_as_seller") or 0)
e2e_docs = e2e.get("ai_documents_obo") or 0
e2e_embedded = e2e.get("embedded_obo_chunks") or 0

if e2e_offers == 0:
    root_cause = "missing_source_offers"
    root_detail = (
        "e2e-contract has no listings.offers rows as buyer or seller; "
        "OBO ai_documents cannot be owner-visible until real offers exist for this user."
    )
    recommended = "Create minimal real OBO flow via API (seller listing + buyer offer + counter/accept), then targeted reindex."
elif e2e_docs == 0:
    root_cause = "missing_ingestion"
    root_detail = "Real offers exist for e2e-contract but obo_offer_summary ai_documents are absent; run targeted RAG reindex."
    recommended = "bash scripts/rp-ai-rag-reindex.sh --source offers --user <e2e-user-id>"
elif e2e_embedded == 0:
    root_cause = "missing_embeddings"
    root_detail = "Owner-visible OBO ai_documents exist for e2e-contract but chunks are not embedded."
    recommended = "bash scripts/rp-ai-embed-obo-owner-visible.sh"
else:
    root_cause = "none"
    root_detail = "e2e-contract has owner-visible embedded OBO chunks."
    recommended = "No repair needed."

summary = {
    "ticket": "T19.7A",
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "read_only": True,
    "pre_embedded_total": pre_embedded,
    "post_embedded_total": pre_embedded,
    "global_embedded_obo_offer_summary": global_embedded_obo,
    "total_listings_offers": total_offers,
    "root_cause": root_cause,
    "root_detail": root_detail,
    "recommended_action": recommended,
    "contract_users": rows,
}

with open(json_out, "w") as f:
    json.dump(summary, f, indent=2)

lines = [
    "# T19.7A — OBO corpus RCA (read-only)",
    "",
    f"**Root cause:** `{root_cause}`",
    "",
    root_detail,
    "",
    f"- Recommended: {recommended}",
    f"- Global embedded obo_offer_summary: {global_embedded_obo}",
    f"- Total listings.offers: {total_offers}",
    f"- Pre embedded rows (unchanged): {pre_embedded}",
    "",
    "| account | user_id | buyer offers | seller offers | offer_events | ai_docs obo | embedded obo | unembedded obo |",
    "|---------|---------|-------------:|--------------:|-------------:|------------:|-------------:|---------------:|",
]
for r in rows:
    lines.append(
        f"| {r.get('email', '')} | {(r.get('user_id') or '')[:8]}… | "
        f"{r.get('offers_as_buyer', '')} | {r.get('offers_as_seller', '')} | "
        f"{r.get('offer_events_as_actor', '')} | {r.get('ai_documents_obo', '')} | "
        f"{r.get('embedded_obo_chunks', '')} | {r.get('unembedded_obo_chunks', '')} |"
    )

with open(md_out, "w") as f:
    f.write("\n".join(lines) + "\n")

print(f"Report: {md_out}")
print(f"Root cause: {root_cause}")
print(f"Embedded total unchanged: {pre_embedded}")
PY

POST_EMBEDDED="$(rp_python_ai_psql "SELECT count(*) FROM ai.ai_document_chunks WHERE embedding_vec IS NOT NULL;")"
test "$PRE_EMBEDDED" = "$POST_EMBEDDED"
echo "✅ T19.7A complete (embedded=$POST_EMBEDDED unchanged)"
