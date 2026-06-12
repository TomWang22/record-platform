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

FORBIDDEN_RESPONSE_RE = (
    "demo",
    "mock",
    "sample fallback",
    "placeholder",
    "lorem ipsum",
)
