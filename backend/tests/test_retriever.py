"""
Tests for the non-LLM retrieval layer.

Run with: pytest backend/tests/test_retriever.py -v
(run from the backend/ directory, or adjust sys.path as below)
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from retriever import FaqRetriever, CONFIDENCE_THRESHOLD  # noqa: E402


retriever = FaqRetriever()


# --- Queries that SHOULD be answered by the FAQ layer (no LLM needed) ---

CONFIDENT_CASES = [
    ("how can i donate money to you guys", "how-to-donate"),
    ("is the internship paid", "internship-stipend"),
    ("are you a registered ngo", "registration-details"),
    ("hi there", "greeting"),
    ("how do i apply for an internship", "internship-apply"),
    ("will i get a certificate", "internship-certificate"),
    ("is my donation tax deductible", "is-donation-tax-exempt"),
    ("what did you do during covid", "covid-relief"),
    ("tell me about project seva", "project-seva"),
    ("where is your office located", "location"),
    ("do you help street dogs", "project-jeev"),
    ("what kind of internships do you have", "internship-domains"),
]


def test_confident_matches_hit_expected_faq():
    for query, expected_id in CONFIDENT_CASES:
        entry, score = retriever.best_match(query)
        assert entry is not None, f"No match at all for: {query!r}"
        assert entry["id"] == expected_id, (
            f"Query {query!r} matched {entry['id']!r} (score={score:.3f}), "
            f"expected {expected_id!r}"
        )
        assert score >= CONFIDENCE_THRESHOLD, (
            f"Query {query!r} matched the right FAQ ({entry['id']}) but scored "
            f"{score:.3f}, below the {CONFIDENCE_THRESHOLD} threshold — it would "
            f"incorrectly fall through to the LLM."
        )


# --- Queries that should NOT be confidently answered (must fall back to LLM) ---

OUT_OF_SCOPE_CASES = [
    "what is the weather like on mars",
    "can you write me a python function to sort a list",
    "what is the capital of france",
    "tell me a joke about cats",
]


def test_out_of_scope_queries_fall_below_threshold():
    for query in OUT_OF_SCOPE_CASES:
        entry, score = retriever.best_match(query)
        assert score < CONFIDENCE_THRESHOLD, (
            f"Out-of-scope query {query!r} scored {score:.3f} against "
            f"{entry['id'] if entry else None} — this would incorrectly be "
            f"answered by the FAQ layer instead of falling back to the LLM."
        )


def test_answer_wrapper_matches_best_match_behaviour():
    result = retriever.answer("how can i donate")
    assert result["source"] == "faq"
    assert len(result["answer"]) > 0
    assert "{{REPLACE" not in result["answer"], "Placeholder text should never reach a real user"

    result = retriever.answer("what is the weather like on mars")
    assert result["source"] == "none"
    assert result["answer"] is None


def test_no_placeholder_text_remains_in_any_faq_answer():
    """Guards against ever shipping a {{REPLACE: ...}} placeholder to a real visitor."""
    for entry in retriever.entries:
        assert "{{REPLACE" not in entry["answer"], (
            f"FAQ entry {entry['id']!r} still has unfilled placeholder text"
        )


def test_top_k_context_returns_related_entries_even_when_not_confident():
    context = retriever.top_k_context("tell me about helping stray dogs", k=3)
    ids = [e["id"] for e in context]
    assert "project-jeev" in ids
