"""P21.3 — Short-lived in-memory session memory for seller intelligence (non-vector)."""
from __future__ import annotations

import re
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

FORBIDDEN_MEMORY = re.compile(
    r"message_body|thread_text|private obo message|proxy_bids|max_bid_cents",
    re.I,
)

MAX_MEMORY_CHARS = 4000
MAX_PRIOR_SUMMARIES = 8
MAX_PREFERENCE_ITEMS = 12
MAX_SOURCE_REFS = 20
DEFAULT_TTL_SECONDS = 3600


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class SessionState:
    session_id: str
    user_id: str
    created_at: datetime
    updated_at: datetime
    turn_count: int = 0
    preferences: List[str] = field(default_factory=list)
    constraints: List[str] = field(default_factory=list)
    prior_summaries: List[str] = field(default_factory=list)
    source_ref_ids: List[str] = field(default_factory=list)
    missing_evidence: List[str] = field(default_factory=list)
    safety_notes: List[str] = field(default_factory=list)

    def to_public_dict(self) -> Dict[str, Any]:
        return {
            "session_id": self.session_id,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "turn_count": self.turn_count,
            "preferences": list(self.preferences),
            "constraints": list(self.constraints),
            "prior_summaries": list(self.prior_summaries),
            "source_ref_ids": list(self.source_ref_ids),
            "missing_evidence": list(self.missing_evidence),
            "safety_notes": list(self.safety_notes),
        }


class SessionMemoryStore:
    """Process-local TTL session store. Not durable across restarts or pods."""

    def __init__(self, ttl_seconds: int = DEFAULT_TTL_SECONDS) -> None:
        self._ttl = ttl_seconds
        self._lock = threading.Lock()
        self._sessions: Dict[str, Tuple[SessionState, datetime]] = {}

    def _purge_expired(self) -> None:
        now = _utc_now()
        expired = [sid for sid, (_, exp) in self._sessions.items() if exp <= now]
        for sid in expired:
            del self._sessions[sid]

    def start(self, user_id: str) -> SessionState:
        uid = (user_id or "").strip()
        if not uid:
            raise ValueError("user_id required")
        self._purge_expired()
        sid = str(uuid.uuid4())
        now = _utc_now()
        state = SessionState(
            session_id=sid,
            user_id=uid,
            created_at=now,
            updated_at=now,
            safety_notes=[
                "Private message bodies are never stored in session memory.",
                "Memory holds derived preferences and answer summaries only.",
            ],
        )
        with self._lock:
            self._sessions[sid] = (state, now + timedelta(seconds=self._ttl))
        return state

    def get(self, session_id: str, user_id: str) -> Optional[SessionState]:
        self._purge_expired()
        uid = (user_id or "").strip()
        with self._lock:
            entry = self._sessions.get(session_id)
            if not entry:
                return None
            state, exp = entry
            if exp <= _utc_now():
                del self._sessions[session_id]
                return None
            if state.user_id != uid:
                return None
            return state

    def reset(self, session_id: str, user_id: str) -> bool:
        uid = (user_id or "").strip()
        with self._lock:
            entry = self._sessions.get(session_id)
            if not entry:
                return False
            state, _ = entry
            if state.user_id != uid:
                return False
            del self._sessions[session_id]
            return True

    def save(self, state: SessionState) -> None:
        with self._lock:
            exp = _utc_now() + timedelta(seconds=self._ttl)
            self._sessions[state.session_id] = (state, exp)


store = SessionMemoryStore()


def sanitize_memory_text(text: str, *, max_len: int = 400) -> Optional[str]:
    raw = (text or "").strip()
    if not raw:
        return None
    if FORBIDDEN_MEMORY.search(raw):
        return None
    stripped = raw.strip()
    if stripped.startswith("{") and stripped.endswith("}"):
        return None
    cleaned = re.sub(r"\s+", " ", raw)[:max_len].strip()
    return cleaned or None


def extract_preferences_constraints(prompt: str) -> Tuple[List[str], List[str]]:
    q = (prompt or "").lower()
    prefs: List[str] = []
    constraints: List[str] = []

    if any(p in q for p in ("stale inventory", "move inventory", "moving stale")):
        prefs.append("prioritize moving stale inventory over maximizing top dollar")
    if any(p in q for p in ("rare jazz", "jazz records", "rare jazz records")):
        constraints.append("avoid underselling rare jazz records")
    if any(p in q for p in ("avoid underselling", "undersell", "do not want to undersell")):
        constraints.append("avoid underselling without verified pressing/scarcity evidence")
    if "30 minute" in q:
        prefs.append("time-box seller actions to ~30 minutes")
    if "care more about" in q:
        snippet = sanitize_memory_text(prompt, max_len=220)
        if snippet:
            prefs.append(snippet)

    return prefs, constraints


def _dedupe_append(items: List[str], new_items: List[str], limit: int) -> None:
    for item in new_items:
        safe = sanitize_memory_text(item, max_len=300)
        if safe and safe not in items:
            items.append(safe)
        if len(items) >= limit:
            return


def _trim_state_size(state: SessionState) -> None:
    while len(str(state.to_public_dict())) > MAX_MEMORY_CHARS and state.prior_summaries:
        state.prior_summaries.pop(0)


def update_session_from_turn(
    state: SessionState,
    *,
    prompt: str,
    summary: str,
    source_refs: List[Dict[str, Any]],
    synthesis: Optional[Dict[str, Any]] = None,
) -> SessionState:
    now = _utc_now()
    state.turn_count += 1
    state.updated_at = now

    prefs, constraints = extract_preferences_constraints(prompt)
    _dedupe_append(state.preferences, prefs, MAX_PREFERENCE_ITEMS)
    _dedupe_append(state.constraints, constraints, MAX_PREFERENCE_ITEMS)

    safe_summary = sanitize_memory_text(summary, max_len=500)
    if safe_summary:
        state.prior_summaries.append(safe_summary)
        state.prior_summaries = state.prior_summaries[-MAX_PRIOR_SUMMARIES:]

    for ref in source_refs or []:
        st = ref.get("source_type")
        sid = ref.get("source_id")
        if not st or not sid:
            continue
        rid = f"{st}:{sid}"
        if rid not in state.source_ref_ids:
            state.source_ref_ids.append(rid)
    state.source_ref_ids = state.source_ref_ids[-MAX_SOURCE_REFS:]

    if synthesis:
        for caveat in synthesis.get("caveats") or []:
            note = sanitize_memory_text(str(caveat), max_len=120)
            if note and note not in state.missing_evidence:
                state.missing_evidence.append(note)
        template = synthesis.get("template")
        if template == "tagged_executive_summary":
            _dedupe_append(
                state.missing_evidence,
                ["tagged final plan emitted in prior turn"],
                MAX_PREFERENCE_ITEMS,
            )

    state.safety_notes = [
        "Private message bodies are never stored in session memory.",
        "Memory holds derived preferences and answer summaries only.",
    ]
    _trim_state_size(state)
    store.save(state)
    return state


def build_synthesis_context(state: SessionState) -> str:
    lines = ["ACCUMULATED SESSION CONTEXT (safe server memory):"]
    if state.preferences:
        lines.append("- Preferences: " + "; ".join(state.preferences[:6]))
    if state.constraints:
        lines.append("- Constraints: " + "; ".join(state.constraints[:6]))
    if state.prior_summaries:
        lines.append("- Prior answer summaries:")
        for summary in state.prior_summaries[-3:]:
            lines.append(f"  · {summary[:200]}")
    if state.missing_evidence:
        lines.append("- Missing evidence notes: " + "; ".join(state.missing_evidence[-4:]))
    if state.source_ref_ids:
        lines.append("- Selected source refs: " + ", ".join(state.source_ref_ids[-6:]))

    blob = "\n".join(lines).lower()
    if "stale inventory" not in blob and any("stale" in p.lower() for p in state.preferences):
        lines.append("- Tradeoff: move stale inventory before maximizing top dollar.")
    if "rare jazz" not in blob and any("jazz" in c.lower() for c in state.constraints):
        lines.append("- Tradeoff: avoid underselling rare jazz records.")

    return "\n".join(lines)[:MAX_MEMORY_CHARS]


def augment_question_with_memory(question: str, state: Optional[SessionState]) -> str:
    if not state or state.turn_count <= 0:
        return question
    ctx = build_synthesis_context(state)
    return f"{ctx}\n\nCurrent user message:\n{question}"
