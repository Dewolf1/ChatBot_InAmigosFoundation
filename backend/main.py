import json
import os
import time
import uuid
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from retriever import FaqRetriever
from llm_fallback import get_llm_answer

app = FastAPI(title="InAmigos Foundation Chatbot API")

# Wide-open CORS is intentional here: this API is meant to be called from
# whatever website embeds the widget script, which we don't control in advance.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

retriever = FaqRetriever()

UNANSWERED_LOG = Path(__file__).parent / "data" / "unanswered_log.jsonl"
ADMIN_KEY = os.environ.get("ADMIN_KEY", "")  # set this in production; empty = admin route disabled

# In-memory per-session history — fine for a single-instance MVP demo.
# For real production scale (multiple server instances / restarts), swap this
# for Redis or a small DB table keyed by session_id.
SESSION_HISTORY: dict[str, deque] = defaultdict(lambda: deque(maxlen=6))


class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None


class ChatResponse(BaseModel):
    reply: str
    source: str  # "faq" | "llm" | "stub" | "stub-after-error"
    session_id: str
    confidence: float | None = None


def _log_unanswered(query: str, faq_confidence: float):
    UNANSWERED_LOG.parent.mkdir(parents=True, exist_ok=True)
    with open(UNANSWERED_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps({
            "query": query,
            "faq_confidence": faq_confidence,
            "timestamp": time.time(),
        }) + "\n")


@app.get("/health")
def health():
    return {"status": "ok", "faq_entries": len(retriever.entries)}


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    message = req.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="message cannot be empty")

    session_id = req.session_id or str(uuid.uuid4())

    # 1. Try the fast, free, prebuilt-answer path first.
    faq_result = retriever.answer(message)

    if faq_result["source"] == "faq":
        reply = faq_result["answer"]
        source = "faq"
        confidence = faq_result["confidence"]
    else:
        # 2. Not confident enough -> fall back to the LLM, grounded with the
        #    closest FAQ entries so it doesn't invent facts about the org.
        _log_unanswered(message, faq_result["confidence"])
        context_matches = retriever.top_k_context(message)
        llm_result = get_llm_answer(message, context_matches)
        reply = llm_result["answer"]
        source = llm_result["provider"]
        confidence = faq_result["confidence"]

    SESSION_HISTORY[session_id].append({"user": message, "bot": reply})

    return ChatResponse(reply=reply, source=source, session_id=session_id, confidence=confidence)


@app.get("/admin/unanswered")
def unanswered(x_admin_key: str = Header(default="")):
    """
    Returns queries the FAQ layer couldn't confidently answer, so the team can
    review real gaps and expand data/faq.json over time.
    Protect this in production by setting ADMIN_KEY in the environment.
    """
    if not ADMIN_KEY or x_admin_key != ADMIN_KEY:
        raise HTTPException(status_code=403, detail="forbidden")

    if not UNANSWERED_LOG.exists():
        return {"entries": []}

    entries = []
    with open(UNANSWERED_LOG, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                entries.append(json.loads(line))
    return {"entries": entries}
