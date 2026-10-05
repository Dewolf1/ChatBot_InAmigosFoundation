"""
Provider-agnostic LLM fallback.

Only called when the FAQ retriever isn't confident enough to answer alone.
Swap providers by setting LLM_PROVIDER in your environment — no code changes
needed elsewhere in the app.

Supported: "anthropic", "openai". Defaults to a safe offline stub if no
provider/key is configured, so the rest of the app still runs and is
demoable without any API key.
"""

import os
import requests

SYSTEM_PROMPT_TEMPLATE = """You are a helpful assistant for {org_name}, a nonprofit organization.
First, verify if the visitor's question is related to {org_name}, NGOs, volunteering, donations, or general greetings. If the question is completely off-topic (e.g., coding/DSA questions, math, or general trivia), politely decline to answer by stating you can only assist with inquiries related to the organization.

If the question is related, answer it using ONLY the context below. If the context doesn't
contain enough information to answer confidently, say you're not certain and
suggest they contact the team at {contact_email} — do NOT invent facts about the
organization (no made-up programs, numbers, dates, or policies).

Keep answers short (2-4 sentences), warm, and plain-language.

Context about {org_name}:
{context}
"""

ORG_NAME = os.environ.get("ORG_NAME", "InAmigos Foundation")
CONTACT_EMAIL = os.environ.get("ORG_CONTACT_EMAIL", "support@inamigosfoundation.org.in")


def _build_context(faq_matches: list) -> str:
    if not faq_matches:
        return "(no closely related FAQ entries found)"
    lines = []
    for entry in faq_matches:
        lines.append(f"- Q: {entry['question']}\n  A: {entry['answer']}")
    return "\n".join(lines)


def _stub_response(query: str, faq_matches: list) -> str:
    """Used when no LLM provider/key is configured — keeps the app runnable and demoable."""
    if faq_matches:
        closest = faq_matches[0]
        return (
            f"I don't have an exact answer for that yet, but the closest thing I know is: "
            f"\"{closest['answer']}\" If that doesn't cover it, please reach out to "
            f"{CONTACT_EMAIL} and the team will help directly."
        )
    return (
        f"I'm not fully sure about that one. Could you rephrase, or reach out to "
        f"{CONTACT_EMAIL} and the team will get back to you?"
    )


def _call_anthropic(system_prompt: str, query: str) -> str:
    api_key = os.environ["ANTHROPIC_API_KEY"]
    model = os.environ.get("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")
    resp = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": model,
            "max_tokens": 300,
            "system": system_prompt,
            "messages": [{"role": "user", "content": query}],
        },
        timeout=20,
    )
    resp.raise_for_status()
    data = resp.json()
    return "".join(block.get("text", "") for block in data.get("content", []))


def _call_openai(system_prompt: str, query: str) -> str:
    api_key = os.environ["OPENAI_API_KEY"]
    model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
    resp = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "content-type": "application/json",
        },
        json={
            "model": model,
            "max_tokens": 300,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": query},
            ],
        },
        timeout=20,
    )
    resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"]


def get_llm_answer(query: str, faq_matches: list) -> dict:
    """
    Returns {"answer": str, "provider": str} so the API layer can log which
    path served the response.
    """
    provider = os.environ.get("LLM_PROVIDER", "").lower()
    context = _build_context(faq_matches)
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        org_name=ORG_NAME, contact_email=CONTACT_EMAIL, context=context
    )

    try:
        if provider == "anthropic" and os.environ.get("ANTHROPIC_API_KEY"):
            return {"answer": _call_anthropic(system_prompt, query), "provider": "anthropic"}
        if provider == "openai" and os.environ.get("OPENAI_API_KEY"):
            return {"answer": _call_openai(system_prompt, query), "provider": "openai"}
    except Exception as exc:  # noqa: BLE001 - we want ANY provider failure to degrade gracefully
        return {
            "answer": _stub_response(query, faq_matches)
            + f" (note: LLM call failed — {type(exc).__name__})",
            "provider": "stub-after-error",
        }

    return {"answer": _stub_response(query, faq_matches), "provider": "stub"}
