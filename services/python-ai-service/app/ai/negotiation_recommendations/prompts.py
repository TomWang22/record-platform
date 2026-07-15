"""Versioned prompt metadata only — no private message bodies."""

PROMPT_TEMPLATES = {
    "negotiation_assistance": {
        "prompt_template_id": "negotiation-reply-draft",
        "prompt_version": "1",
        "role": "draft_after_facts",
    },
    "recommendations": {
        "prompt_template_id": "recommendation-explain",
        "prompt_version": "1",
        "role": "explain_after_rank",
    },
}
