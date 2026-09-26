from __future__ import annotations

import math
from collections import Counter
from itertools import combinations
from typing import Iterable, List


def accumulate_cooccur(
    recipe_ingredient_lists: Iterable[List[str]],
    doc_freq: Counter | None = None,
    pair_freq: Counter | None = None,
) -> tuple[Counter, Counter, int]:
    """Update doc/pair counters from recipe ingredient lists. Returns (doc, pair, n)."""
    doc_freq = doc_freq if doc_freq is not None else Counter()
    pair_freq = pair_freq if pair_freq is not None else Counter()
    n = 0
    for ings in recipe_ingredient_lists:
        uniq = sorted(set(ings))
        if len(uniq) < 2:
            continue
        n += 1
        for ing in uniq:
            doc_freq[ing] += 1
        for a, b in combinations(uniq, 2):
            pair_freq[(a, b)] += 1
    return doc_freq, pair_freq, n


def finalize_cooccurrence(
    doc_freq: Counter,
    pair_freq: Counter,
    n: int,
    min_freq: int = 1,
) -> list[dict]:
    if n == 0:
        return []
    edges: list[dict] = []
    for (a, b), freq in pair_freq.items():
        if freq < min_freq:
            continue
        pa = doc_freq[a] / n
        pb = doc_freq[b] / n
        pab = freq / n
        if pab <= 0 or pa <= 0 or pb <= 0:
            continue
        pmi = math.log2(pab / (pa * pb))
        denom = -math.log2(pab)
        npmi = pmi / denom if denom > 0 else 0.0
        npmi = max(-1.0, min(1.0, npmi))
        edges.append(
            {
                "a": a,
                "b": b,
                "freq": freq,
                "confidence": round(float(npmi), 6),
            }
        )
    return edges


) -> list[dict]:
    """
    Build undirected co-occurrence edges with freq + NPMI confidence.
    Each input list is the set of canonical ingredients in one recipe.
    """
    doc_freq, pair_freq, n = accumulate_cooccur(recipe_ingredient_lists)
    return finalize_cooccurrence(doc_freq, pair_freq, n, min_freq=min_freq)
