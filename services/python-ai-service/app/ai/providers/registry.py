"""Provider registry and selection."""
from __future__ import annotations

from typing import Any, Dict, List

from app.ai.config import AI_MODEL_PROVIDER, AI_OLLAMA_MODEL
from app.ai.providers.base import ModelProvider
from app.ai.providers.ollama import OllamaProvider
from app.ai.providers.rule_engine import RuleEngineProvider
from app.ai.providers.transformer import HuggingFaceProvider, PyTorchProvider, TensorFlowProvider

_ollama = OllamaProvider()
_rule = RuleEngineProvider()
_all: List[ModelProvider] = [_ollama, _rule, HuggingFaceProvider, PyTorchProvider, TensorFlowProvider]


def get_provider(name: str | None = None) -> ModelProvider:
    key = (name or AI_MODEL_PROVIDER or "rule").lower()
    if key == "ollama":
        return _ollama
    if key in ("hf", "huggingface"):
        return HuggingFaceProvider
    if key in ("torch", "pytorch"):
        return PyTorchProvider
    if key in ("tensorflow", "tf"):
        return TensorFlowProvider
    return _rule


async def provider_status_map() -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for p in _all:
        out[p.name] = await p.status()
    out["active"] = AI_MODEL_PROVIDER
    return out


async def resolve_model_used() -> tuple[str, str | None]:
    """Return (model_used label, degraded_reason if explanation skipped)."""
    primary = get_provider()
    if primary.name == "ollama":
        st = await primary.status()
        if st.get("available"):
            return AI_OLLAMA_MODEL, None
        return "rule-engine", st.get("reason", "ollama_unavailable")
    if primary.name == "rule":
        return "rule-engine", None
    st = await primary.status()
    if st.get("available"):
        return primary.name, None
    return "none", st.get("reason", f"{primary.name}_unavailable")
