"""Ollama HTTP provider — model backend only."""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

import httpx

from app.ai.config import (
    AI_EMBEDDING_MODEL,
    AI_MAX_RESPONSE_TOKENS,
    AI_OLLAMA_MODEL,
    AI_OLLAMA_TIMEOUT_MS,
    OLLAMA_BASE_URL,
)
from app.ai.providers.base import ModelProvider

logger = logging.getLogger(__name__)


class OllamaProvider(ModelProvider):
    name = "ollama"

    async def status(self) -> Dict[str, Any]:
        timeout = AI_OLLAMA_TIMEOUT_MS / 1000.0
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                r = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
                if r.status_code != 200:
                    return {"available": False, "reason": f"http_{r.status_code}"}
                names = [m.get("name", "") for m in r.json().get("models", [])]
                model_ok = any(AI_OLLAMA_MODEL.split(":")[0] in n for n in names)
                embed_ok = any(AI_EMBEDDING_MODEL.split(":")[0] in n for n in names)
                return {
                    "available": model_ok,
                    "base_url": OLLAMA_BASE_URL,
                    "model_configured": AI_OLLAMA_MODEL,
                    "model_present": model_ok,
                    "embedding_model": AI_EMBEDDING_MODEL,
                    "embedding_model_present": embed_ok,
                }
        except Exception as e:
            logger.debug("[ollama] status failed: %s", e)
            return {"available": False, "reason": str(e)[:120]}

    async def explain(
        self,
        prompt: str,
        *,
        max_tokens: int = AI_MAX_RESPONSE_TOKENS,
        system: Optional[str] = None,
    ) -> Dict[str, Any]:
        st = await self.status()
        if not st.get("available"):
            return {
                "ok": False,
                "text": "",
                "model_used": "none",
                "degraded_reason": st.get("reason", "ollama_unavailable"),
            }
        timeout = max(AI_OLLAMA_TIMEOUT_MS / 1000.0, 5.0)
        payload: Dict[str, Any] = {
            "model": AI_OLLAMA_MODEL,
            "prompt": prompt,
            "stream": False,
            "options": {"num_predict": min(max_tokens, AI_MAX_RESPONSE_TOKENS)},
        }
        if system:
            payload["system"] = system
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                r = await client.post(f"{OLLAMA_BASE_URL}/api/generate", json=payload)
                if r.status_code != 200:
                    return {
                        "ok": False,
                        "text": "",
                        "model_used": "none",
                        "degraded_reason": f"ollama_http_{r.status_code}",
                    }
                text = (r.json().get("response") or "").strip()
                return {"ok": True, "text": text, "model_used": AI_OLLAMA_MODEL, "degraded_reason": None}
        except Exception as e:
            return {
                "ok": False,
                "text": "",
                "model_used": "none",
                "degraded_reason": str(e)[:120],
            }
