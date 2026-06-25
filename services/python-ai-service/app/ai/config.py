"""T15.3A — AI runtime configuration."""
import os

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
AI_OLLAMA_MODEL = os.getenv("AI_OLLAMA_MODEL", "llama3.2:1b")
AI_EMBEDDING_MODEL = os.getenv("AI_EMBEDDING_MODEL", "nomic-embed-text")
AI_OLLAMA_TIMEOUT_MS = int(os.getenv("AI_OLLAMA_TIMEOUT_MS", "2000"))
AI_RAG_MAX_CHUNKS = int(os.getenv("AI_RAG_MAX_CHUNKS", "8"))
AI_RAG_MAX_CONTEXT_TOKENS = int(os.getenv("AI_RAG_MAX_CONTEXT_TOKENS", "2048"))
AI_MAX_RESPONSE_TOKENS = int(os.getenv("AI_MAX_RESPONSE_TOKENS", "512"))
AI_MODEL_PROVIDER = os.getenv("AI_MODEL_PROVIDER", "rule").lower()
AI_TRANSFORMER_ENABLED = os.getenv("AI_TRANSFORMER_ENABLED", "0") == "1"
AI_HF_MODEL = os.getenv("AI_HF_MODEL", "")
AI_TORCH_MODEL = os.getenv("AI_TORCH_MODEL", "")
AI_TF_MODEL = os.getenv("AI_TF_MODEL", "")

# T18.6 — shadow vector diagnostics only; keyword remains default retrieval.
AI_RAG_SHADOW_VECTOR = os.getenv("AI_RAG_SHADOW_VECTOR", "0") == "1"
AI_RAG_SHADOW_MIN_EMBEDDED = int(os.getenv("AI_RAG_SHADOW_MIN_EMBEDDED", "1"))
AI_RAG_VECTOR_DIM = int(os.getenv("AI_RAG_VECTOR_DIM", "768"))
# T20.10E — shadow-only embed latency bounds (keyword path unaffected).
AI_RAG_SHADOW_EMBED_TIMEOUT_MS = int(os.getenv("AI_RAG_SHADOW_EMBED_TIMEOUT_MS", "5000"))
AI_RAG_SHADOW_EMBED_HINT_MAX_CHARS = int(os.getenv("AI_RAG_SHADOW_EMBED_HINT_MAX_CHARS", "512"))
AI_RAG_SHADOW_EMBED_CACHE_MAX = int(os.getenv("AI_RAG_SHADOW_EMBED_CACHE_MAX", "64"))
# T20.10AC — diagnostic-only shadow overlap refinements (default off).
AI_RAG_SHADOW_ENTITY_HINTS = os.getenv("AI_RAG_SHADOW_ENTITY_HINTS", "0") == "1"
AI_RAG_SHADOW_NEIGHBOR_EXPANSION = os.getenv("AI_RAG_SHADOW_NEIGHBOR_EXPANSION", "0") == "1"

FORBIDDEN_RESPONSE_RE = (
    "demo",
    "mock",
    "sample fallback",
    "placeholder",
    "lorem ipsum",
)
