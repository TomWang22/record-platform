"""T20.15B/F — Hybrid canary gates (keyword default preserved; percentage cohort optional)."""
from __future__ import annotations

import hashlib
import os
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional, Sequence

from app.ai.config import (
    AI_RAG_HYBRID_ANCHOR_MAX,
    AI_RAG_HYBRID_CANARY,
    AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT,
    AI_RAG_HYBRID_CANARY_PERCENT,
    AI_RAG_HYBRID_CANARY_USER_ALLOWLIST,
    AI_RAG_HYBRID_LOG_PURE_VECTOR,
    AI_RAG_HYBRID_REQUIRE_KEYWORD_FALLBACK,
)
from app.ai.envelope import source_ref

_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
_PRODUCTION_NAMESPACES = frozenset({"record-platform"})

GateReason = str  # allowlist | preview_opt_in | percentage | keyword_default | prod_percent_blocked

# T20.16B — seller-domain retrieval expansion for meta-prompt tagged plans (canary only).
TAGGED_EXECUTIVE_SUMMARY_RETRIEVAL_QUERY = (
    "prioritized seller action plan offers listings auction negotiation "
    "collector metadata pricing review countered pending"
)

FINAL_TAGGED_PLAN_PROMPT_CLASS = "final_tagged_plan"


@dataclass(frozen=True)
class HybridRetrievalPlan:
    retrieval_query: str
    prompt_class: Optional[str]
    query_expanded: bool


@dataclass(frozen=True)
class HybridCanaryGate:
    canary_enabled: bool
    canary_allowed: bool
    gate_reason: GateReason
    user_allowlisted: bool
    percentage: int
    percentage_bucket: Optional[int]
    percentage_cohort: bool
    require_keyword_fallback: bool
    log_pure_vector: bool
    anchor_max: int

    @property
    def active(self) -> bool:
        return self.canary_allowed


def resolve_hybrid_retrieval_plan(question: str) -> HybridRetrievalPlan:
    """Expand meta-prompt tagged plans to seller-domain terms for retrieval only."""
    from app.ai.rag_synthesis import classify_rag_intent

    if classify_rag_intent(question) != "tagged_executive_summary":
        return HybridRetrievalPlan(
            retrieval_query=question,
            prompt_class=None,
            query_expanded=False,
        )
    return HybridRetrievalPlan(
        retrieval_query=TAGGED_EXECUTIVE_SUMMARY_RETRIEVAL_QUERY,
        prompt_class=FINAL_TAGGED_PLAN_PROMPT_CLASS,
        query_expanded=True,
    )


def refine_hybrid_fallback_reason(
    *,
    prompt_class: Optional[str],
    generic_reason: Optional[str],
) -> Optional[str]:
    if prompt_class == FINAL_TAGGED_PLAN_PROMPT_CLASS and generic_reason == "true_zero_result":
        return "final_tagged_plan_insufficient_hybrid_evidence"
    return generic_reason


def normalize_user_id(user_id: Optional[str]) -> Optional[str]:
    if user_id is None:
        return None
    s = str(user_id).strip()
    if not s or s.lower() in ("null", "none"):
        return None
    if not _UUID_RE.match(s):
        return None
    return s.lower()


def _clamp_percent(percent: int) -> int:
    if percent <= 0:
        return 0
    if percent > 100:
        return 100
    return percent


def percentage_bucket(user_id: str) -> int:
    normalized = normalize_user_id(user_id) or str(user_id).strip().lower()
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % 100


def in_percentage_cohort(user_id: str, percent: int) -> bool:
    clamped = _clamp_percent(percent)
    if clamped <= 0:
        return False
    return percentage_bucket(user_id) < clamped


def _parse_allowlist(raw: str) -> set[str]:
    return {part.strip().lower() for part in (raw or "").split(",") if part.strip()}


def _is_production_namespace() -> bool:
    ns = os.getenv("KUBERNETES_NAMESPACE", "").strip()
    return ns in _PRODUCTION_NAMESPACES


def _has_owner_scope(user_id: Optional[str]) -> bool:
    return normalize_user_id(user_id) is not None


def evaluate_hybrid_canary_gate(
    user_id: Optional[str],
    *,
    preview_enrolled: bool = False,
) -> HybridCanaryGate:
    raw_uid = (user_id or "").strip()
    uid = normalize_user_id(user_id)
    allowlist = _parse_allowlist(AI_RAG_HYBRID_CANARY_USER_ALLOWLIST)
    percent = _clamp_percent(AI_RAG_HYBRID_CANARY_PERCENT)
    canary_enabled = AI_RAG_HYBRID_CANARY
    user_allowlisted = bool(raw_uid and raw_uid.lower() in allowlist)
    bucket: Optional[int] = percentage_bucket(uid) if uid else None

    base = dict(
        canary_enabled=canary_enabled,
        user_allowlisted=user_allowlisted,
        percentage=percent,
        percentage_bucket=bucket,
        require_keyword_fallback=AI_RAG_HYBRID_REQUIRE_KEYWORD_FALLBACK,
        log_pure_vector=AI_RAG_HYBRID_LOG_PURE_VECTOR,
        anchor_max=AI_RAG_HYBRID_ANCHOR_MAX,
    )

    if not canary_enabled:
        return HybridCanaryGate(
            canary_allowed=False,
            gate_reason="keyword_default",
            percentage_cohort=False,
            **base,
        )

    if user_allowlisted:
        return HybridCanaryGate(
            canary_allowed=True,
            gate_reason="allowlist",
            percentage_cohort=False,
            **base,
        )

    if preview_enrolled and uid:
        return HybridCanaryGate(
            canary_allowed=True,
            gate_reason="preview_opt_in",
            percentage_cohort=False,
            **base,
        )

    if percent <= 0:
        return HybridCanaryGate(
            canary_allowed=False,
            gate_reason="keyword_default",
            percentage_cohort=False,
            **base,
        )

    if not uid:
        return HybridCanaryGate(
            canary_allowed=False,
            gate_reason="keyword_default",
            percentage_cohort=False,
            **base,
        )

    if not _has_owner_scope(uid):
        return HybridCanaryGate(
            canary_allowed=False,
            gate_reason="keyword_default",
            percentage_cohort=False,
            **base,
        )

    if _is_production_namespace() and not AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT:
        return HybridCanaryGate(
            canary_allowed=False,
            gate_reason="prod_percent_blocked",
            percentage_cohort=False,
            **base,
        )

    if in_percentage_cohort(uid, percent):
        return HybridCanaryGate(
            canary_allowed=True,
            gate_reason="percentage",
            percentage_cohort=True,
            **base,
        )

    return HybridCanaryGate(
        canary_allowed=False,
        gate_reason="keyword_default",
        percentage_cohort=False,
        **base,
    )


def _source_types(chunks: Sequence[Mapping[str, Any]]) -> List[str]:
    types = sorted({str(c.get("source_type") or "unknown") for c in chunks})
    return types


def chunks_to_source_refs(chunks: Sequence[Mapping[str, Any]]) -> List[Dict[str, Any]]:
    refs = [
        source_ref(
            ch["source_type"],
            ch["source_id"],
            freshness=ch.get("source_updated_at"),
            checksum=ch.get("checksum"),
        )
        for ch in chunks
        if ch.get("source_type") and ch.get("source_id")
    ]
    seen: set[tuple[str, str]] = set()
    unique: List[Dict[str, Any]] = []
    for ref in refs:
        key = (str(ref["source_type"]), str(ref["source_id"]))
        if key in seen:
            continue
        seen.add(key)
        unique.append(ref)
    return unique


def hybrid_chunks_from_shadow(shadow: Mapping[str, Any]) -> List[Dict[str, Any]]:
    chunks = shadow.get("chunks") or shadow.get("weighted_chunks") or []
    return list(chunks)


def hybrid_failure_reason(
    *,
    gate: HybridCanaryGate,
    shadow: Optional[Mapping[str, Any]],
    hybrid_error: Optional[str] = None,
) -> Optional[str]:
    if not gate.canary_enabled:
        return "canary_disabled"
    if not gate.canary_allowed:
        if gate.gate_reason == "prod_percent_blocked":
            return "prod_percent_blocked"
        return "user_not_in_cohort"
    if hybrid_error:
        return "hybrid_exception"
    if shadow is None:
        return "hybrid_missing"
    status = str(shadow.get("status") or "")
    if status == "embed_timed_out":
        return "embed_timeout"
    if status and status != "ok":
        return f"hybrid_status_{status}"
    sd = shadow.get("shadow_diagnostics") or {}
    embed = sd.get("embed") or {}
    if embed.get("timed_out"):
        return "embed_timeout"
    debug = sd.get("debug") or {}
    if debug.get("true_zero_result_after_fallback"):
        return "true_zero_result"
    if not hybrid_chunks_from_shadow(shadow):
        return "empty_hybrid_chunks"
    return None


def hybrid_succeeded(
    *,
    gate: HybridCanaryGate,
    shadow: Optional[Mapping[str, Any]],
    hybrid_error: Optional[str] = None,
) -> bool:
    if not gate.canary_allowed:
        return False
    return hybrid_failure_reason(gate=gate, shadow=shadow, hybrid_error=hybrid_error) is None


def _gate_metadata(
    gate: HybridCanaryGate,
    retrieval_mode: str,
    *,
    preview_opt_in: bool = False,
    preview_source: Optional[str] = None,
) -> Dict[str, Any]:
    return {
        "enabled": gate.canary_enabled,
        "eligible": gate.canary_allowed,
        "gate_reason": gate.gate_reason,
        "percentage": gate.percentage,
        "percentage_bucket": gate.percentage_bucket,
        "percentage_cohort": gate.percentage_cohort,
        "allowlisted": gate.user_allowlisted,
        "require_keyword_fallback": gate.require_keyword_fallback,
        "pure_vector_logged": gate.log_pure_vector,
        "anchor_max": gate.anchor_max,
        "retrieval_mode": retrieval_mode,
        "preview_opt_in": preview_opt_in,
        "preview_source": preview_source,
    }


def build_hybrid_canary_diagnostics(
    *,
    gate: HybridCanaryGate,
    keyword_result: Mapping[str, Any],
    shadow: Optional[Mapping[str, Any]],
    keyword_latency_ms: float,
    hybrid_latency_ms: Optional[float],
    hybrid_fallback: bool,
    hybrid_fallback_reason: Optional[str],
    hybrid_error: Optional[str],
    retrieval_mode: str,
    retrieval_plan: Optional[HybridRetrievalPlan] = None,
    preview_opt_in: bool = False,
    preview_source: Optional[str] = None,
) -> Dict[str, Any]:
    meta = _gate_metadata(
        gate,
        retrieval_mode,
        preview_opt_in=preview_opt_in,
        preview_source=preview_source,
    )
    if not gate.canary_allowed:
        return {
            **meta,
            "canary_enabled": gate.canary_enabled,
            "canary_allowed": False,
            "canary_lane": "lane_c_keyword",
        }

    keyword_chunks = list(keyword_result.get("chunks") or [])
    hybrid_chunk_list = hybrid_chunks_from_shadow(shadow) if shadow else []
    sd = (shadow or {}).get("shadow_diagnostics") or {}
    debug = sd.get("debug") or {}
    embed = sd.get("embed") or {}
    overlap = sd.get("overlap") or {}

    pure_doc = int(debug.get("pure_vector_doc_overlap") or 0)
    pure_ent = int(debug.get("pure_vector_entity_overlap") or 0)
    anchored_doc = int(
        debug.get("shadow_plus_anchor_doc_overlap")
        or overlap.get("document_overlap_count")
        or 0
    )
    anchored_ent = int(
        debug.get("shadow_plus_anchor_entity_overlap")
        or overlap.get("entity_overlap_count")
        or 0
    )

    if gate.log_pure_vector:
        pure_doc_out = pure_doc
        pure_ent_out = pure_ent
    else:
        pure_doc_out = 0
        pure_ent_out = 0

    if hybrid_succeeded(gate=gate, shadow=shadow, hybrid_error=hybrid_error):
        canary_lane = "lane_b_hybrid_anchored"
    else:
        canary_lane = "lane_b_hybrid_attempted"

    retrieval_meta: Dict[str, Any] = {}
    if retrieval_plan is not None:
        retrieval_meta = {
            "retrieval_prompt_class": retrieval_plan.prompt_class,
            "retrieval_query_expanded": retrieval_plan.query_expanded,
        }

    return {
        **meta,
        **retrieval_meta,
        "canary_enabled": gate.canary_enabled,
        "canary_allowed": gate.canary_allowed,
        "canary_lane": canary_lane,
        "keyword_latency_ms": round(keyword_latency_ms, 2),
        "hybrid_latency_ms": round(hybrid_latency_ms, 2) if hybrid_latency_ms is not None else None,
        "pure_vector_doc_overlap": pure_doc_out,
        "pure_vector_entity_overlap": pure_ent_out,
        "anchored_doc_overlap": anchored_doc,
        "anchored_entity_overlap": anchored_ent,
        "overlap_anchor_added": bool(debug.get("overlap_anchor_added")),
        "overlap_anchor_count": int(debug.get("overlap_anchor_count") or 0),
        "entity_expansion_added_count": int(debug.get("entity_expansion_added_count") or 0),
        "keyword_anchor_added": bool(debug.get("keyword_anchor_added")),
        "true_zero_result": bool(debug.get("true_zero_result_after_fallback")),
        "embed_timeout": bool(embed.get("timed_out") or (shadow or {}).get("status") == "embed_timed_out"),
        "hybrid_fallback": hybrid_fallback,
        "hybrid_fallback_reason": hybrid_fallback_reason,
        "canary_error": hybrid_error,
        "source_types_keyword": _source_types(keyword_chunks),
        "source_types_hybrid": _source_types(hybrid_chunk_list),
        "source_refs_keyword_count": len(keyword_result.get("source_refs") or []),
        "source_refs_hybrid_count": len(chunks_to_source_refs(hybrid_chunk_list)),
    }
