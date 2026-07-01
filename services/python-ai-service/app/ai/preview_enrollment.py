"""T20.25B — Opt-in hybrid preview enrollment persistence."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from app.ai.hybrid_canary import normalize_user_id
from app.db import get_pool

logger = logging.getLogger(__name__)

_ENROLLMENT_DDL = """
CREATE TABLE IF NOT EXISTS ai.ai_rag_preview_enrollment (
  user_id UUID PRIMARY KEY,
  owner_user_id UUID NOT NULL,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  enrolled_by UUID NOT NULL,
  revoked_at TIMESTAMPTZ NULL,
  source TEXT NOT NULL DEFAULT 'owner_opt_in',
  CONSTRAINT ai_rag_preview_enrollment_owner_match CHECK (user_id = owner_user_id)
);
CREATE INDEX IF NOT EXISTS idx_ai_rag_preview_enrollment_active
  ON ai.ai_rag_preview_enrollment (user_id)
  WHERE revoked_at IS NULL;
"""

_ddl_applied = False


async def ensure_enrollment_table() -> bool:
    global _ddl_applied
    if _ddl_applied:
        return True
    pool = await get_pool()
    if not pool:
        return False
    try:
        await pool.execute(_ENROLLMENT_DDL)
        _ddl_applied = True
        return True
    except Exception as exc:
        logger.warning("[preview_enrollment] DDL failed: %s", exc)
        return False


@dataclass(frozen=True)
class PreviewEnrollmentRow:
    user_id: str
    owner_user_id: str
    enrolled_at: datetime
    enrolled_by: str
    revoked_at: Optional[datetime]
    source: str

    @property
    def active(self) -> bool:
        return self.revoked_at is None


async def get_enrollment(user_id: Optional[str]) -> Optional[PreviewEnrollmentRow]:
    uid = normalize_user_id(user_id)
    if not uid:
        return None
    if not await ensure_enrollment_table():
        return None
    pool = await get_pool()
    if not pool:
        return None
    row = await pool.fetchrow(
        """
        SELECT user_id, owner_user_id, enrolled_at, enrolled_by, revoked_at, source
        FROM ai.ai_rag_preview_enrollment
        WHERE user_id = $1::uuid
        """,
        uid,
    )
    if not row:
        return None
    return PreviewEnrollmentRow(
        user_id=str(row["user_id"]),
        owner_user_id=str(row["owner_user_id"]),
        enrolled_at=row["enrolled_at"],
        enrolled_by=str(row["enrolled_by"]),
        revoked_at=row["revoked_at"],
        source=str(row["source"] or "owner_opt_in"),
    )


async def is_preview_enrolled(user_id: Optional[str]) -> bool:
    row = await get_enrollment(user_id)
    return row is not None and row.active


async def enroll_user(user_id: Optional[str]) -> Dict[str, Any]:
    uid = normalize_user_id(user_id)
    if not uid:
        return {"ok": False, "error": "invalid_user_id"}
    if not await ensure_enrollment_table():
        return {"ok": False, "error": "python_ai_db_unavailable"}
    pool = await get_pool()
    if not pool:
        return {"ok": False, "error": "python_ai_db_unavailable"}
    now = datetime.now(timezone.utc)
    await pool.execute(
        """
        INSERT INTO ai.ai_rag_preview_enrollment (
          user_id, owner_user_id, enrolled_at, enrolled_by, revoked_at, source
        ) VALUES ($1::uuid, $1::uuid, $2, $1::uuid, NULL, 'owner_opt_in')
        ON CONFLICT (user_id) DO UPDATE SET
          owner_user_id = EXCLUDED.owner_user_id,
          enrolled_at = EXCLUDED.enrolled_at,
          enrolled_by = EXCLUDED.enrolled_by,
          revoked_at = NULL,
          source = EXCLUDED.source
        """,
        uid,
        now,
    )
    return {
        "ok": True,
        "enrolled": True,
        "user_id": uid,
        "source": "owner_opt_in",
        "enrolled_at": now.isoformat(),
    }


async def revoke_user(user_id: Optional[str]) -> Dict[str, Any]:
    uid = normalize_user_id(user_id)
    if not uid:
        return {"ok": False, "error": "invalid_user_id"}
    if not await ensure_enrollment_table():
        return {"ok": False, "error": "python_ai_db_unavailable"}
    pool = await get_pool()
    if not pool:
        return {"ok": False, "error": "python_ai_db_unavailable"}
    now = datetime.now(timezone.utc)
    result = await pool.execute(
        """
        UPDATE ai.ai_rag_preview_enrollment
        SET revoked_at = $2
        WHERE user_id = $1::uuid AND revoked_at IS NULL
        """,
        uid,
        now,
    )
    revoked = result.endswith("1")
    return {
        "ok": True,
        "enrolled": False,
        "user_id": uid,
        "revoked": revoked,
        "revoked_at": now.isoformat() if revoked else None,
    }


async def revoke_all_active() -> int:
    if not await ensure_enrollment_table():
        return 0
    pool = await get_pool()
    if not pool:
        return 0
    now = datetime.now(timezone.utc)
    result = await pool.execute(
        """
        UPDATE ai.ai_rag_preview_enrollment
        SET revoked_at = $1
        WHERE revoked_at IS NULL
        """,
        now,
    )
    try:
        return int(str(result).split()[-1])
    except (ValueError, IndexError):
        return 0


async def preview_status_payload(user_id: Optional[str]) -> Dict[str, Any]:
    uid = normalize_user_id(user_id)
    if not uid:
        return {
            "enrolled": False,
            "user_id": None,
            "source": None,
            "gate_reason": "keyword_default",
            "error": "authentication_required",
        }
    row = await get_enrollment(uid)
    if row and row.active:
        return {
            "enrolled": True,
            "user_id": uid,
            "source": row.source,
            "gate_reason": "preview_opt_in",
            "enrolled_at": row.enrolled_at.isoformat(),
        }
    return {
        "enrolled": False,
        "user_id": uid,
        "source": None,
        "gate_reason": "keyword_default",
    }
