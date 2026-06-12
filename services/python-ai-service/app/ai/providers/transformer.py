"""Optional transformer backends — disabled unless explicitly enabled (no downloads)."""
from __future__ import annotations

from typing import Any, Dict, Optional

from app.ai.config import AI_HF_MODEL, AI_TF_MODEL, AI_TORCH_MODEL, AI_TRANSFORMER_ENABLED
from app.ai.providers.base import ModelProvider


class _DisabledTransformerProvider(ModelProvider):
    def __init__(self, name: str, env_model: str):
        self.name = name
        self._env_model = env_model

    async def status(self) -> Dict[str, Any]:
        enabled = AI_TRANSFORMER_ENABLED and bool(self._env_model)
        return {
            "available": False,
            "enabled": enabled,
            "configured_model": self._env_model or None,
            "reason": "disabled_by_default" if not enabled else "not_implemented",
        }

    async def explain(
        self,
        prompt: str,
        *,
        max_tokens: int = 512,
        system: Optional[str] = None,
    ) -> Dict[str, Any]:
        return {
            "ok": False,
            "text": "",
            "model_used": "none",
            "degraded_reason": f"{self.name}_disabled",
        }


HuggingFaceProvider = _DisabledTransformerProvider("hf", AI_HF_MODEL)
PyTorchProvider = _DisabledTransformerProvider("torch", AI_TORCH_MODEL)
TensorFlowProvider = _DisabledTransformerProvider("tensorflow", AI_TF_MODEL)
