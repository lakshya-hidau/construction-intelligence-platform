"""
Module 4b — RAG-based construction knowledge assistant.

Retrieval is a hybrid lexical scorer (unigram TF-IDF over the corpus + tag boosts +
bigram phrase matching) — dependency-free, deterministic and fast, which is the right
trade-off for a 30-document standards corpus. When a multimodal/text LLM is configured
the retrieved context is passed to the model with a strict citation contract; otherwise
an extractive synthesiser composes a grounded answer directly from the top chunks, so
the module still returns real, cited content with zero API keys.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from models.schemas import AssistantQuery, AssistantResponse, ChatTurn, Citation, EngineMode
from services.common import HEURISTIC_DISCLOSURE, LLM_DISCLOSURE, clamp, make_engine_meta
from services.llm import LLMError, get_llm

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "knowledge_base.json"

STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can", "could", "did", "do",
    "does", "for", "from", "had", "has", "have", "how", "i", "if", "in", "into", "is", "it", "its",
    "may", "me", "might", "must", "my", "no", "not", "of", "on", "or", "our", "should", "so", "than",
    "that", "the", "their", "them", "then", "there", "these", "they", "this", "to", "was", "we",
    "were", "what", "when", "where", "which", "who", "why", "will", "with", "would", "you", "your",
    "about", "any", "also", "much", "many", "some", "such", "very", "just", "only", "more", "most",
}

TOKEN_RE = re.compile(r"[a-z0-9]+(?:[.\-][a-z0-9]+)*")

# Words that appear in almost every document's metadata and therefore carry no
# discriminative power at the metadata gate (they still score in the body).
GENERIC_QUERY_TERMS = {
    "site", "construction", "build", "building", "project", "work", "worker", "engineer",
    "contractor", "method", "requirement", "recommend", "common", "failure", "frequency",
    "documentation", "keep", "file", "evidence", "control", "change", "season",
}

# Query expansion: colloquial site vocabulary -> standards vocabulary.
SYNONYMS: dict[str, list[str]] = {
    "helmet": ["helmet", "head", "protection", "hard", "hat"],
    "hardhat": ["helmet", "head", "protection"],
    "vest": ["vest", "hi-vis", "visibility", "reflective", "clothing"],
    "harness": ["harness", "fall", "arrest", "lanyard", "anchor"],
    "crack": ["crack", "cracking", "fissure", "width"],
    "cracks": ["crack", "cracking", "width"],
    "curing": ["curing", "cure", "moist", "hydration"],
    "pour": ["pour", "placement", "placing", "concreting"],
    "monsoon": ["monsoon", "rain", "rainfall", "wet", "drainage"],
    "rain": ["rain", "rainfall", "precipitation", "wet"],
    "hot": ["heat", "temperature", "hot", "summer"],
    "heat": ["heat", "temperature", "wbgt", "dehydration"],
    "scaffold": ["scaffold", "scaffolding", "platform", "guardrail"],
    "trench": ["trench", "excavation", "shoring", "cave"],
    "excavation": ["excavation", "trench", "shoring", "soil"],
    "valuation": ["valuation", "value", "price", "area", "yield"],
    "price": ["valuation", "price", "rate", "market"],
    "schedule": ["schedule", "programme", "sequencing", "cycle", "critical"],
    "delay": ["delay", "schedule", "programme", "critical"],
    "waterproof": ["waterproofing", "ponding", "membrane", "leakage"],
    "fire": ["fire", "extinguisher", "hot", "work", "permit"],
    "electric": ["electrical", "temporary", "earthing", "leakage"],
    "electrical": ["electrical", "temporary", "earthing", "leakage"],
    "crane": ["crane", "lifting", "wind", "rigging"],
    "lift": ["lifting", "crane", "load"],
    "safety": ["safety", "hazard", "risk", "protection"],
    "housekeeping": ["housekeeping", "debris", "access", "egress"],
    "cube": ["cube", "testing", "compressive", "strength"],
    "strength": ["strength", "cube", "compressive", "testing"],
    "value": ["valuat", "valuation", "price", "market"],
    "worth": ["valuat", "price"],
    "cost": ["price", "valuat", "rate"],
    "apartment": ["residential", "property", "flat", "valuat"],
    "flat": ["apartment", "residential", "property"],
    "house": ["residential", "property"],
    "plot": ["land", "residential", "property"],
    "rera": ["rera", "registration", "escrow", "regulatory"],
    "formwork": ["formwork", "shuttering", "striking", "props"],
}


@dataclass(slots=True)
class Chunk:
    doc_id: str
    title: str
    standard_code: str
    section: str
    text: str
    tags: list[str]

    @property
    def searchable(self) -> str:
        return f"{self.title} {self.section} {self.standard_code} {' '.join(self.tags)} {self.text}".lower()


def _stem(term: str) -> str:
    """Light, dependency-free English stemmer tuned for engineering vocabulary.

    Handles the inflections that actually matter on a site: scaffolding->scaffold,
    inspected/inspection->inspect, curing->cure, cracks->crack.
    """
    if len(term) <= 4:
        return term
    for suffix in ("ations", "ation", "ings", "ing", "ions", "ion", "ies", "ied", "ed", "s"):
        if term.endswith(suffix) and len(term) - len(suffix) >= 3:
            base = term[: -len(suffix)]
            if suffix in ("ies", "ied"):
                return base + "y"
            # Restore a dropped trailing 'e' (curing -> cur -> cure) for short stems.
            if len(base) <= 3 and base[-1] not in "aeiouwxy" and base[-2] in "aeiou":
                return base + "e"
            return base
    return term


def tokenize(text: str) -> list[str]:
    return [
        _stem(t)
        for t in TOKEN_RE.findall(text.lower())
        if t not in STOPWORDS and len(t) > 1
    ]


@lru_cache(maxsize=1)
def load_corpus() -> tuple[list[Chunk], dict[str, float], float]:
    import json

    raw = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    chunks = [
        Chunk(
            doc_id=item["doc_id"],
            title=item["title"],
            standard_code=item["standard_code"],
            section=item["section"],
            text=item["text"],
            tags=[t.lower() for t in item.get("tags", [])],
        )
        for item in raw
    ]

    df: Counter[str] = Counter()
    for chunk in chunks:
        df.update(set(tokenize(chunk.searchable)))
    n = max(len(chunks), 1)
    idf = {term: math.log((n + 1) / (count + 0.5)) for term, count in df.items()}
    avg_len = sum(len(tokenize(c.text)) for c in chunks) / n
    return chunks, idf, avg_len


def corpus_size() -> int:
    return len(load_corpus()[0])


@lru_cache(maxsize=1)
def _synonym_index() -> dict[str, tuple[str, ...]]:
    """Synonyms keyed and valued by stem, so 'cracks', 'cracked' and 'crack' all resolve."""
    index: dict[str, list[str]] = {}
    for key, values in SYNONYMS.items():
        stemmed_key = _stem(key)
        bucket = index.setdefault(stemmed_key, [])
        for value in values:
            for variant in {value, _stem(value)}:
                if variant and variant not in bucket:
                    bucket.append(variant)
    return {k: tuple(v) for k, v in index.items()}


def expand_query(question: str) -> list[str]:
    base = tokenize(question)
    expanded = list(base)
    index = _synonym_index()
    for term in base:
        for syn in index.get(term, ()):
            if syn not in expanded:
                expanded.append(syn)
    return expanded


def _bigrams(terms: list[str]) -> set[str]:
    return {f"{a} {b}" for a, b in zip(terms, terms[1:])}


def retrieve(question: str, top_k: int = 5) -> list[tuple[Chunk, float]]:
    chunks, idf, avg_len = load_corpus()
    query_terms = expand_query(question)
    if not query_terms:
        return []
    query_counts = Counter(query_terms)
    q_bigrams = _bigrams(tokenize(question))

    scored: list[tuple[Chunk, float]] = []
    k1, b = 1.4, 0.72

    query_set = set(query_terms)

    for chunk in chunks:
        terms = tokenize(chunk.text)
        counts = Counter(terms)
        length = max(len(terms), 1)
        score = 0.0
        for term, qf in query_counts.items():
            tf = counts.get(term, 0)
            if tf:
                idf_v = idf.get(term, 1.0)
                denom = tf + k1 * (1 - b + b * length / max(avg_len, 1.0))
                score += idf_v * (tf * (k1 + 1)) / denom * min(qf, 3)

        # --- metadata gate -------------------------------------------------------
        # Tags/title/section/standard code are curated. A document that matches the
        # query ONLY in its free text is almost always a coincidental word overlap
        # (e.g. "capital" in "capital value" for a question about capital cities),
        # so body-only matches are damped hard and usually fall below the floor.
        meta_tokens = set(tokenize(chunk.title)) | set(tokenize(chunk.section)) | set(
            tokenize(chunk.standard_code)
        ) | set(tokenize(" ".join(chunk.tags)))
        raw_meta_hits = query_set & meta_tokens
        specific_hits = {t for t in raw_meta_hits if t not in GENERIC_QUERY_TERMS}
        if not specific_hits:
            # The question shares no discriminative vocabulary with this document's
            # curated metadata: it is out of scope for the corpus, not a weak match.
            continue
        meta_hits = float(len(specific_hits)) + 0.25 * (len(raw_meta_hits) - len(specific_hits))
        score *= 1.0 + 0.20 * min(meta_hits, 3)

        if any(bg and bg in chunk.searchable for bg in q_bigrams):
            score += 2.2
        # Mild prior towards broadly useful documents.
        score += 0.15

        if score > 0:
            scored.append((chunk, score))

    scored.sort(key=lambda pair: pair[1], reverse=True)
    if not scored:
        return []
    top_score = scored[0][1]
    # Absolute floor: below this the corpus simply does not cover the question.
    if top_score < 2.0:
        return []
    threshold = max(2.0, top_score * 0.32)
    return [(c, s) for c, s in scored if s >= threshold][:top_k]


def _sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z])", text.strip())
    return [p.strip() for p in parts if len(p.strip()) > 25]


def _best_sentences(question: str, chunk: Chunk, limit: int = 2) -> str:
    terms = set(expand_query(question))
    scored: list[tuple[float, str]] = []
    for sentence in _sentences(chunk.text):
        s_terms = set(tokenize(sentence))
        overlap = len(s_terms & terms)
        if overlap:
            scored.append((overlap + 0.01 * len(sentence) / 200, sentence))
    if not scored:
        sentences = _sentences(chunk.text)
        return " ".join(sentences[:limit]) if sentences else chunk.text[:400]
    scored.sort(key=lambda pair: pair[0], reverse=True)
    chosen: list[str] = []
    for _, sentence in scored:
        if sentence not in chosen:
            chosen.append(sentence)
        if len(chosen) >= limit:
            break
    return " ".join(chosen)


def _make_citations(question: str, results: list[tuple[Chunk, float]]) -> list[Citation]:
    if not results:
        return []
    top = results[0][1] or 1.0
    citations: list[Citation] = []
    for chunk, score in results[:6]:
        citations.append(
            Citation(
                doc_id=chunk.doc_id,
                title=chunk.title[:200],
                section=chunk.section[:200],
                standard_code=chunk.standard_code[:120],
                snippet=_best_sentences(question, chunk, limit=2)[:900],
                relevance=round(clamp(score / top, 0.0, 1.0), 3),
            )
        )
    return citations


SYSTEM_PROMPT = """You are a construction engineering knowledge assistant for site engineers, \
project managers and safety officers in India. You answer strictly from the supplied context \
extracts, which come from recognised standards (IS, OSHA, ACI, NBC, RERA) and industry guidance. \
Rules:
1. Ground every factual claim in the provided extracts. Do not invent clause numbers or limits.
2. If the extracts do not cover the question, say so explicitly and give general good-practice \
guidance, clearly labelled as not from the corpus.
3. Write for a practitioner: short paragraphs, concrete numbers where the extract gives them, and \
bullet points for actions.
4. Never claim to have inspected a specific site. Never give a definitive structural sign-off.
5. Cite inline like [KB-004] when you use an extract.
6. Keep the answer under 400 words."""


def _build_context(results: list[tuple[Chunk, float]]) -> str:
    blocks = []
    for chunk, _ in results:
        blocks.append(
            f"[{chunk.doc_id}] {chunk.title} ({chunk.standard_code}, section: {chunk.section})\n{chunk.text}"
        )
    return "\n\n---\n\n".join(blocks)


def _history_block(history: list[ChatTurn]) -> str:
    if not history:
        return ""
    recent = history[-6:]
    lines = [f"{turn.role.value.capitalize()}: {turn.content[:600]}" for turn in recent]
    return "Conversation so far:\n" + "\n".join(lines) + "\n\n"


def _follow_ups(question: str, results: list[tuple[Chunk, float]]) -> list[str]:
    base = [
        "What documentation should I keep on file to evidence this control?",
        "How does this change during the monsoon season?",
        "What is the inspection frequency for this activity?",
    ]
    if results:
        tags = results[0][0].tags[:2]
        for tag in tags:
            base.append(f"What are the most common failures related to {tag.replace('-', ' ')}?")
    return base[:4]


def answer_question(query: AssistantQuery, *, request_id: str) -> AssistantResponse:
    results = retrieve(query.question, top_k=query.top_k)
    citations = _make_citations(query.question, results)
    low_confidence = not results or results[0][1] < 2.4

    client = get_llm()
    if client.available and results:
        context = _build_context(results)
        prompt = (
            f"{_history_block(query.history)}"
            f"{'Project context: ' + query.project_context + chr(10) if query.project_context else ''}"
            f"{'Site location: ' + query.city + chr(10) if query.city else ''}"
            f"Question: {query.question}\n\n"
            f"Context extracts:\n{context}\n\n"
            "Answer using only the extracts above. Use inline citations like [KB-004]. "
            "If the extracts are insufficient, say so plainly."
        )
        try:
            raw, result = client.text(SYSTEM_PROMPT, prompt, temperature=0.2, max_tokens=900, json_mode=False)
            answer = raw.strip()
            if answer:
                return AssistantResponse(
                    answer=answer[:6000],
                    citations=citations,
                    follow_ups=_follow_ups(query.question, results),
                    grounded=True,
                    low_confidence=low_confidence,
                    engine=make_engine_meta(
                        mode=EngineMode.LLM,
                        provider=result.provider,
                        model=result.model,
                        latency_ms=result.latency_ms,
                        confidence=0.82 if not low_confidence else 0.55,
                        request_id=request_id,
                        disclosure=LLM_DISCLOSURE,
                    ),
                )
        except LLMError:
            pass

    # -- extractive fallback -----------------------------------------------------------
    if not results:
        return AssistantResponse(
            answer=(
                "I could not find anything in the standards corpus that addresses this question directly. "
                "The corpus covers hot/cold weather concreting, crack diagnosis and repair, fall protection, "
                "PPE, scaffolds, excavation, lifting, heat stress, curing, cube testing, waterproofing, "
                "masonry, formwork, housekeeping, temporary electrical, fire safety, RERA and valuation "
                "basics.\n\nTry rephrasing with a trade or activity keyword, for example: 'cold joint in "
                "slab', 'scaffold inspection frequency', or 'crack width limit for severe exposure'.\n\n"
                "This platform does not provide a certified engineering opinion; escalate to a licensed "
                "structural engineer for a definitive assessment."
            ),
            citations=[],
            follow_ups=[
                "What are the crack width limits for severe exposure?",
                "What controls apply to hot-weather concreting?",
                "How often must a scaffold be inspected?",
            ],
            grounded=False,
            low_confidence=True,
            engine=make_engine_meta(
                mode=EngineMode.HEURISTIC,
                provider="rag-extractive",
                model="bm25-extractive-v1",
                latency_ms=0,
                confidence=0.2,
                request_id=request_id,
                disclosure=HEURISTIC_DISCLOSURE,
            ),
        )

    paragraphs: list[str] = []
    intro_terms = query.question.strip().rstrip("?")
    paragraphs.append(
        f'Here is what the platform\'s standards corpus says about “{intro_terms}”. '
        f"The {len(results)} most relevant extracts are summarised below and cited inline."
    )

    for chunk, _ in results[:4]:
        body = _best_sentences(query.question, chunk, limit=3)
        paragraphs.append(f"**{chunk.title}** — {chunk.standard_code} ({chunk.section})\n{body} [{chunk.doc_id}]")

    if low_confidence:
        paragraphs.append(
            "⚠️ Retrieval confidence is low for this query — the extracts above are the closest matches "
            "available but may not fully answer the question. Refine the query with a specific trade, "
            "material or standard if you need a sharper answer."
        )

    paragraphs.append(
        "This answer is assembled directly from the corpus extracts without a generative model, so every "
        "sentence is traceable to the citation shown. Confirm against the current edition of the standard "
        "and the project's approved specifications before instructing works."
    )

    return AssistantResponse(
        answer="\n\n".join(paragraphs)[:6000],
        citations=citations,
        follow_ups=_follow_ups(query.question, results),
        grounded=True,
        low_confidence=low_confidence,
        engine=make_engine_meta(
            mode=EngineMode.HEURISTIC,
            provider="rag-extractive",
            model="bm25-extractive-v1",
            latency_ms=0,
            confidence=0.55 if not low_confidence else 0.35,
            request_id=request_id,
            disclosure=(
                "Retrieval-augmented answer assembled extractively from the local standards corpus "
                "(no generative model configured). Every claim is traceable to the cited document."
            ),
        ),
    )


def list_documents() -> list[dict[str, Any]]:
    chunks, _, _ = load_corpus()
    return [
        {
            "doc_id": c.doc_id,
            "title": c.title,
            "standard_code": c.standard_code,
            "section": c.section,
            "tags": c.tags,
        }
        for c in chunks
    ]

