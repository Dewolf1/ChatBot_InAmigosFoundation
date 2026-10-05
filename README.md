# InAmigos Foundation — Hybrid FAQ + LLM Chat Widget

A support chatbot built for embedding on an NGO's website as a single `<script>` tag.
It answers common questions instantly from a prebuilt knowledge base (no API cost, no
latency), and only calls an LLM when a question doesn't match anything it already knows.

**Live flow:** visitor asks a question → fast local retrieval tries to answer it →
if confident, answers instantly for free → if not, falls back to an LLM, grounded with
the closest related FAQ entries so it doesn't invent facts about the organization.

---

## Why this architecture (and not "just use an LLM for everything")

| | Pure LLM chatbot | This project |
|---|---|---|
| Cost | Every message costs an API call | Most messages cost **$0** |
| Latency | 1-3s per reply | Instant for known questions |
| Accuracy on org facts | Can hallucinate stipend amounts, program details, etc. | Answers come verbatim from a vetted knowledge base |
| Works with no API key | No | **Yes** — degrades gracefully to a stub reply |
| Improves over time | Needs prompt/RAG tuning | Just add a line to `faq.json` |

The trade-off: TF-IDF matching is dumber than semantic embeddings — it won't always
catch a creatively-worded paraphrase. That's an intentional, documented trade-off (see
`retriever.py`), not an oversight: those misses fall through to the LLM anyway, and the
`/admin/unanswered` log shows you exactly which real questions are getting missed, so
you can add a tag or a new FAQ entry instead of re-training anything.

**A concrete example found while building this:** the query *"what kind of
internships do you have"* scored too low to confidently match its own FAQ entry,
because the word "internship" appears in five different entries' tags — common
words shared across many entries get down-weighted by TF-IDF's own idf term, so
word-overlap alone wasn't enough. The fix wasn't to lower the confidence threshold
(tried that — it let an unrelated "what is the weather on mars" question slip through
as a false match instead). The actual fix: `retriever.py` now combines TF-IDF
similarity with a second signal — an exact-phrase boost that only fires on genuine
multi-word tag phrases (e.g. "kind of internships", "street animals"), never on a
single shared word. Single generic words stay purely TF-IDF-scored; distinctive
phrases get extra weight. This whole investigation is captured in
`tests/test_retriever.py`.

---

## Architecture

```
┌─────────────────┐      1. user message       ┌──────────────────────┐
│  widget.js       │ ─────────────────────────▶ │  FastAPI backend     │
│  (any website)   │                             │                      │
│                  │                             │  ┌────────────────┐  │
│  floating bubble │                             │  │ FaqRetriever   │  │
│  + chat window   │                             │  │ (TF-IDF, free, │  │
│                  │                             │  │  instant)      │  │
│                  │ ◀───────────────────────────│  └───────┬────────┘  │
└─────────────────┘      2. reply (JSON)         │          │ low confidence
                                                  │          ▼
                                                  │  ┌────────────────┐  │
                                                  │  │ LLM fallback   │  │
                                                  │  │ (Anthropic or  │  │
                                                  │  │  OpenAI,       │  │
                                                  │  │  grounded with │  │
                                                  │  │  FAQ context)  │  │
                                                  │  └────────────────┘  │
                                                  │                      │
                                                  │  logs unanswered     │
                                                  │  queries to a file   │
                                                  └──────────────────────┘
```

---

## Project structure

```
chatbot-project/
├── backend/
│   ├── main.py              FastAPI app: /chat, /health, /admin/unanswered
│   ├── retriever.py         TF-IDF based FAQ matcher (the "no LLM needed" layer)
│   ├── llm_fallback.py      Provider-agnostic LLM adapter (Anthropic / OpenAI)
│   ├── data/
│   │   ├── faq.json         The knowledge base — edit this to add real content
│   │   └── unanswered_log.jsonl   Auto-created; queries the FAQ layer couldn't answer
│   ├── tests/
│   │   └── test_retriever.py
│   ├── requirements.txt
│   └── .env.example
├── widget/
│   └── widget.js             The embeddable widget — one file, no build step
├── demo.html                 Stand-in "host website" for local testing
└── README.md
```

---

## Keeping NGO data private while the code stays public

`backend/data/faq.json` (the real knowledge base) is **gitignored on purpose**. It
contains organization-specific details — registration numbers, process specifics,
internal contact info — that don't need to sit in a searchable public GitHub repo
just because the *code* demonstrating the retrieval logic is public.

- **Public repo** (safe to share, link on LinkedIn/resume): all the code —
  `retriever.py`, `main.py`, `llm_fallback.py`, `widget.js`, `tests/` — plus
  `backend/data/faq.sample.json`, a small placeholder knowledge base that shows the
  expected format without any real org data.
- **Private / local only**: `backend/data/faq.json` with the organization's actual
  content. The backend automatically uses it when present and falls back to the
  sample file otherwise (see `retriever.py`) — so anyone cloning the public repo
  still gets a working demo, just answering from placeholder content instead of
  real NGO details.

In other words: showcase the engineering, not the organization's internal data.

---

## Running it locally

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

In another terminal, serve the demo page (any static server works):

```bash
cd chatbot-project
python3 -m http.server 8080
```

Open `http://localhost:8080/demo.html` and click the chat bubble.

Run the retrieval tests:

```bash
cd backend
pytest tests/ -v
```

---

## Configuring the LLM fallback

Copy `backend/.env.example` to `backend/.env` and fill in **one** provider:

```
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

or

```
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

If you leave these blank, the app still runs — it just returns a safe stub reply
("I'm not sure, please contact the team") for anything the FAQ layer can't answer.
This means the demo works even before you have an API key.

---

## Editing the knowledge base

Open `backend/data/faq.json`. Each entry looks like:

```json
{
  "id": "how-to-donate",
  "question": "How can I donate to InAmigos Foundation?",
  "answer": "You can donate through ...",
  "tags": ["donate", "donation", "payment", "contribute"]
}
```

- `tags` matter as much as `question` — they're what catches different phrasings
  ("how do I give money" vs "how can I donate"). When you check `/admin/unanswered`
  and see a real question your bot missed, the fix is usually just adding a tag.
- Several answers in the starter file contain `{{REPLACE: ...}}` placeholders —
  these must be filled in with real organization details before going live, so the
  bot never states unverified information as fact.

---

## Deploying

### Backend (FastAPI)
Any Python host works. Easiest free option: **Render.com**
1. Push this repo to GitHub.
2. New → Web Service → connect the repo, root directory `backend/`.
3. Build command: `pip install -r requirements.txt`
4. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Add your `LLM_PROVIDER` / API key as environment variables in Render's dashboard.
6. Note the deployed URL, e.g. `https://inamigos-chatbot.onrender.com`.

### Widget (static file)
Host `widget/widget.js` anywhere static files are served — GitHub Pages, or let
jsDelivr mirror it straight from GitHub for free:
```
https://cdn.jsdelivr.net/gh/<your-username>/<your-repo>@main/widget/widget.js
```

### Embedding on the real NGO website
Add this one line before `</body>` on any page (WordPress, Wix, plain HTML — doesn't
matter, it's framework-independent):

```html
<script
  src="https://cdn.jsdelivr.net/gh/<your-username>/<your-repo>@main/widget/widget.js"
  data-api="https://inamigos-chatbot.onrender.com"
  data-org="InAmigos Foundation">
</script>
```

That's the whole integration — no dependency on the site's tech stack, which is the
"non-dependent" requirement this was built around.

---

## Reviewing what the bot couldn't answer

```bash
curl -H "x-admin-key: YOUR_ADMIN_KEY" https://your-backend/admin/unanswered
```

Returns every query that fell through to the LLM, with the FAQ confidence score it
scored against the closest entry — this is the feedback loop for improving `faq.json`
over time without needing to touch any ML code.

---

## Possible next steps

- Swap the in-memory session store for Redis/a DB so conversations survive a server
  restart or multiple backend instances.
- Add a 👍/👎 on each bot reply, logged alongside the query, as a second signal
  (beyond "FAQ vs fallback") for which answers actually satisfy visitors.
- Optional: swap TF-IDF for sentence-embedding similarity if paraphrase recall becomes
  a real problem in practice — the `FaqRetriever` interface is already isolated so this
  is a drop-in swap, not a rewrite.
- Multi-language FAQ entries + a language-detection step before retrieval.
