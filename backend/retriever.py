"""
Lightweight, non-LLM retrieval layer.

Why TF-IDF instead of embeddings:
- No model download, no GPU, near-zero latency, runs fine on a free-tier instance.
- Good enough for short FAQ-style questions where exact wording tends to overlap
  with the stored question (donation, volunteer, internship, etc.).
- Trade-off: weaker on paraphrases with zero shared vocabulary ("how do I help animals"
  vs a FAQ phrased as "animal welfare programs") — that's exactly the case we want to
  fall through to the LLM anyway.
"""

import json
import re
from pathlib import Path

import math
from collections import Counter

class TfidfVectorizer:
    def __init__(self, ngram_range=(1, 2), stop_words="english"):
        self.ngram_range = ngram_range
        self.stop_words = {"a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "if", "in", "into", "is", "it", "no", "not", "of", "on", "or", "such", "that", "the", "their", "then", "there", "these", "they", "this", "to", "was", "will", "with"}
        self.vocab = []
        self.idf = {}
        self.vocab_idx = {}
        
    def _tokenize(self, text):
        words = text.split()
        words = [w for w in words if w not in self.stop_words]
        tokens = []
        # scikit-learn ngram_range logic
        if self.ngram_range[0] <= 1 <= self.ngram_range[1]:
            tokens.extend(words)
        if self.ngram_range[0] <= 2 <= self.ngram_range[1]:
            tokens.extend([words[i] + " " + words[i+1] for i in range(len(words)-1)])
        return tokens

    def fit_transform(self, texts):
        df = Counter()
        tokenized_texts = []
        for text in texts:
            tokens = self._tokenize(text)
            tokenized_texts.append(tokens)
            df.update(set(tokens))
            
        N = len(texts)
        self.vocab = list(df.keys())
        self.vocab_idx = {w: i for i, w in enumerate(self.vocab)}
        self.idf = {w: math.log((1 + N) / (1 + df[w])) + 1 for w in self.vocab}
        
        return self.transform(texts, is_tokenized=True, tokenized_texts=tokenized_texts)
        
    def transform(self, texts, is_tokenized=False, tokenized_texts=None):
        matrix = []
        for i, text in enumerate(texts):
            tokens = tokenized_texts[i] if is_tokenized else self._tokenize(text)
            tf = Counter(tokens)
            vec = [0.0] * len(self.vocab)
            for w, count in tf.items():
                if w in self.vocab_idx:
                    vec[self.vocab_idx[w]] = count * self.idf[w]
            norm = math.sqrt(sum(v*v for v in vec))
            if norm > 0:
                vec = [v/norm for v in vec]
            matrix.append(vec)
        return matrix

def cosine_similarity(query_vecs, matrix):
    res = []
    for q in query_vecs:
        row = []
        for doc in matrix:
            row.append(sum(q[i]*doc[i] for i in range(len(q))))
        res.append(row)
    return res

# The real knowledge base (faq.json) is gitignored on purpose — it contains the
# organization's actual registration numbers, process details, etc. and shouldn't
# sit in a public GitHub repo just because the code demonstrating the retrieval
# logic is public. Anyone cloning the repo still gets a working demo via the
# tracked faq.sample.json; deploying for real just means adding your own faq.json
# locally / as a server-side file, which .gitignore keeps out of version control.
_REAL_PATH = Path(__file__).parent / "data" / "faq.json"
_SAMPLE_PATH = Path(__file__).parent / "data" / "faq.sample.json"
DATA_PATH = _REAL_PATH if _REAL_PATH.exists() else _SAMPLE_PATH

# Below this similarity score, we don't trust the prebuilt answer and fall back to the LLM.
# Tuned against backend/tests/test_retriever.py — raise this if you see FAQ answers
# firing on unrelated questions; lower it if clearly-matching questions fall through
# to the LLM unnecessarily.
CONFIDENCE_THRESHOLD = 0.30


def _normalize(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text


#  Boost added when a FAQ's own tag phrase appears verbatim inside the query (or vice
#  versa for short queries). This compensates for a real TF-IDF weakness: a word like
#  "internship" that appears in many entries' tags gets a LOW idf weight, so a query
#  built almost entirely from such shared words can score low on cosine similarity
#  alone even when a human would call it an obvious match. An exact phrase hit is
#  strong independent evidence, so it's treated as a separate signal rather than
#  trying to fix it purely by reweighting the vectorizer.
PHRASE_MATCH_BOOST = 0.30


class FaqRetriever:
    def __init__(self, data_path: Path = DATA_PATH):
        with open(data_path, "r", encoding="utf-8") as f:
            self.entries = json.load(f)

        # Each FAQ entry contributes its question + tags as searchable text,
        # so a query can match on either phrasing or a keyword.
        self._entry_texts = [
            _normalize(entry["question"] + " " + " ".join(entry.get("tags", [])))
            for entry in self.entries
        ]
        self._entry_tags = [
            [_normalize(t) for t in entry.get("tags", [])] for entry in self.entries
        ]

        self.vectorizer = TfidfVectorizer(ngram_range=(1, 2), stop_words="english")
        self.matrix = self.vectorizer.fit_transform(self._entry_texts)

    def _phrase_boost(self, normalized_query: str, entry_idx: int) -> float:
        for tag in self._entry_tags[entry_idx]:
            # Only MULTI-WORD tags are eligible to trigger the boost. A single
            # word (even a specific-looking one like "internships") is too likely
            # to show up incidentally in an unrelated sentence, and is exactly the
            # kind of signal TF-IDF's own idf weighting is already built to handle.
            # A multi-word phrase match ("kind of internships", "street animals")
            # is much stronger, harder-to-fake evidence of a real topical match.
            if " " not in tag or len(tag) < 8:
                continue
            if tag in normalized_query or normalized_query in tag:
                return PHRASE_MATCH_BOOST
        return 0.0

    def _exact_tag_match(self, normalized_query: str):
        """
        Direct tag lookup for short conversational queries.
        Words like 'hi', 'thanks', 'bye' are too short for TF-IDF
        (often removed as stop words or scored near zero due to high idf).
        This catches them by checking if any tag is an exact substring match.
        """
        query_words = set(normalized_query.split())
        best_entry = None
        best_overlap = 0

        for idx, tags in enumerate(self._entry_tags):
            tag_set = set(tags)
            # Check if any single-word tag exactly matches a query word
            overlap = len(query_words & tag_set)
            # Also check if the full query matches a tag or vice versa
            for tag in tags:
                if tag == normalized_query or normalized_query == tag:
                    overlap += 3  # strong boost for exact match
                elif tag in normalized_query or normalized_query in tag:
                    overlap += 1

            if overlap > best_overlap:
                best_overlap = overlap
                best_entry = idx

        return best_entry, best_overlap

    def best_match(self, query: str):
        """
        Returns (entry, score) for the closest FAQ match, or (None, 0.0) if the
        knowledge base is empty. Caller decides what to do with a low score.

        Uses a three-layer approach:
        1. Exact tag match — catches short conversational queries (hi, thanks, bye)
        2. TF-IDF cosine similarity — handles longer, keyword-rich questions
        3. Phrase match boost — compensates for shared-vocabulary TF-IDF weakness
        """
        if not self.entries:
            return None, 0.0

        normalized_query = _normalize(query)
        query_words = normalized_query.split()

        # Layer 1: For very short queries (1-2 words), try exact tag match first
        if len(query_words) <= 2:
            tag_idx, tag_overlap = self._exact_tag_match(normalized_query)
            if tag_idx is not None and tag_overlap >= 1:
                return self.entries[tag_idx], 0.85  # high confidence for exact tag hit

        # Layer 2: TF-IDF cosine similarity
        query_vec = self.vectorizer.transform([normalized_query])
        tfidf_scores = cosine_similarity(query_vec, self.matrix)[0]

        # Layer 3: Combine with phrase match boost
        combined_scores = [
            tfidf_scores[i] + self._phrase_boost(normalized_query, i)
            for i in range(len(self.entries))
        ]

        best_idx = max(range(len(self.entries)), key=lambda i: combined_scores[i])

        # For medium queries (3-4 words), also check tag match as a tiebreaker
        if len(query_words) <= 4 and combined_scores[best_idx] < CONFIDENCE_THRESHOLD:
            tag_idx, tag_overlap = self._exact_tag_match(normalized_query)
            if tag_idx is not None and tag_overlap >= 2:
                return self.entries[tag_idx], 0.65

        return self.entries[best_idx], float(combined_scores[best_idx])

    def answer(self, query: str):
        """
        High-level call used by the API layer.
        Returns a dict describing what happened, so main.py can decide
        whether to respond directly or call the LLM fallback.
        """
        entry, score = self.best_match(query)

        if entry is not None and score >= CONFIDENCE_THRESHOLD:
            return {
                "source": "faq",
                "answer": entry["answer"],
                "matched_question": entry["question"],
                "confidence": round(score, 3),
            }

        return {
            "source": "none",
            "answer": None,
            "matched_question": entry["question"] if entry else None,
            "confidence": round(score, 3),
        }

    def top_k_context(self, query: str, k: int = 3):
        """
        Used to ground the LLM fallback: even when no single FAQ is confident
        enough to answer alone, the top few entries are usually still relevant
        context the LLM can use instead of inventing facts about the org.
        """
        if not self.entries:
            return []
        query_vec = self.vectorizer.transform([_normalize(query)])
        scores = cosine_similarity(query_vec, self.matrix)[0]
        top_idx = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:k]
        return [self.entries[i] for i in top_idx if scores[i] > 0.05]
