"""Model provider interface."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, Optional


class ModelProvider(ABC):
    name: str = "base"

    @abstractmethod
    async def status(self) -> Dict[str, Any]:
        ...

    @abstractmethod
    async def explain(
        self,
        prompt: str,
        *,
        max_tokens: int = 512,
        system: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Return {ok, text, model_used, degraded_reason}. Never fabricate on failure."""
