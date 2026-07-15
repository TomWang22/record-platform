"""Versioned prompt metadata only — no private transcripts."""

PROMPT_TEMPLATES = {
    "market_analytics": {
        "prompt_template_id": "analytics-explain",
        "prompt_version": "1",
        "role": "explain_after_facts",
    },
    "multi_turn_memory": {
        "prompt_template_id": "memory-summarize",
        "prompt_version": "1",
        "role": "explain_after_recall",
    },
}
