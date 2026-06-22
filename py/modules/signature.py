from __future__ import annotations

import re
from typing import Dict, List, Set, Tuple

from ..core.embedding import normalize
from ..data import signature_patterns


class TrieNode:
    __slots__ = ("next", "end")

    def __init__(self) -> None:
        self.next: Dict[str, "TrieNode"] = {}
        self.end: List[str] = []


def _build_trie(patterns: List[str]) -> TrieNode:
    root = TrieNode()
    for phrase in patterns:
        node = root
        for ch in phrase.lower():
            node = node.next.setdefault(ch, TrieNode())
        node.end.append(phrase.lower())
    return root


SIG_TRIE = _build_trie(signature_patterns())


def _scan(txt: str) -> List[str]:
    hits: List[str] = []
    lo = txt.lower()
    for i in range(len(lo)):
        node = SIG_TRIE
        j = i
        while j < len(lo):
            ch = lo[j]
            if ch not in node.next:
                break
            node = node.next[ch]
            if node.end:
                hits.extend(node.end)
            j += 1
    return list(dict.fromkeys(hits))


def _collapse_repeats_mild(s: str) -> str:
    result: List[str] = []
    prev = prev_prev = ""
    for ch in s:
        if ch == prev == prev_prev:
            continue
        result.append(ch)
        prev_prev = prev
        prev = ch
    return "".join(result)


def _collapse_repeats(s: str) -> str:
    result: List[str] = []
    prev = ""
    for ch in s:
        if ch == prev:
            continue
        result.append(ch)
        prev = ch
    return "".join(result)


_LEET_MAP = str.maketrans({
    "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b",
    "@": "a", "$": "s", "!": "i", "+": "t",
})
_NON_ALPHA_SPACE_RE = re.compile(r"[^a-z ]")
_MULTI_SPACE_RE = re.compile(r"\s+")


def _normalize_for_fuzzy(s: str) -> str:
    s = _collapse_repeats(s.lower().translate(_LEET_MAP))
    s = _NON_ALPHA_SPACE_RE.sub("", s)
    return _MULTI_SPACE_RE.sub(" ", s).strip()


def _char_trigrams(s: str) -> Set[str]:
    return {s[i : i + 3] for i in range(len(s) - 2)}


# Pre-computed trigram data for each pattern
_PatternEntry = Tuple[Set[str], str, int]  # (trigrams, original_pattern, size)

_pattern_trigram_data: List[_PatternEntry] = []
_trigram_index: Dict[str, List[int]] = {}


def _build_trigram_index() -> None:
    patterns = signature_patterns()
    for idx, p in enumerate(patterns):
        norm = _normalize_for_fuzzy(p)
        tris = _char_trigrams(norm)
        _pattern_trigram_data.append((tris, p, len(tris)))
        for tri in tris:
            _trigram_index.setdefault(tri, []).append(idx)


_build_trigram_index()


def _fuzzy_hits(txt: str) -> List[Dict[str, float]]:
    norm = _normalize_for_fuzzy(txt)
    input_tris = _char_trigrams(norm)

    hit_counts: Dict[int, int] = {}
    for tri in input_tris:
        indices = _trigram_index.get(tri)
        if indices:
            for idx in indices:
                hit_counts[idx] = hit_counts.get(idx, 0) + 1

    results: List[Dict[str, float]] = []
    for idx, count in hit_counts.items():
        tris, pattern, size = _pattern_trigram_data[idx]
        if size == 0:
            continue
        containment = count / size
        threshold = 0.88 if size < 15 else 0.78
        if containment >= threshold:
            results.append({"phrase": pattern, "sim": containment})

    return results


def score_signatures(text: str) -> Dict[str, object]:
    exact = _scan(text)

    collapsed = _collapse_repeats_mild(text)
    if collapsed != text:
        extra = _scan(collapsed)
        seen = set(exact)
        for h in extra:
            if h not in seen:
                exact.append(h)
                seen.add(h)

    fuzzy = _fuzzy_hits(text)
    detail: List[str] = []
    if exact:
        detail.append(f"direct_signature_{exact[0]}")
    if fuzzy:
        detail.append(f"fuzzy_signature_{fuzzy[0]['phrase']}")
    ex_score = min(1.0, 0.6 + 0.1 * (len(exact) - 1)) if exact else 0.0
    f_best = max((hit["sim"] for hit in fuzzy), default=0.0)
    f_threshold = 0.88 if f_best >= 0.88 else 0.78
    f_score = ((f_best - f_threshold) / (1 - f_threshold)) * 0.6 if f_best >= f_threshold else 0.0
    return {"score": normalize(ex_score + f_score), "detail": detail}


def sanitize_text(text: str) -> str:
    hits = _scan(text)
    collapsed = _collapse_repeats_mild(text)
    if collapsed != text:
        extra = _scan(collapsed)
        seen = set(hits)
        for h in extra:
            if h not in seen:
                hits.append(h)
                seen.add(h)
    if not hits:
        return text.strip()
    sentences = [seg.strip() for seg in re.split(r"(?<=[.!?])", text) if seg.strip()]
    sanitized_parts: List[str] = []
    for seg in sentences:
        low = seg.lower()
        if any(hit in low for hit in hits):
            continue
        sanitized_parts.append(seg)
    sanitized = " ".join(sanitized_parts).strip()
    return sanitized or "[sanitized user prompt removed]"
