from __future__ import annotations

import re
from collections import Counter
from typing import Iterable, List

# Controlled technique vocabulary (chef-real, small on purpose)
TECHNIQUE_VOCAB: frozenset[str] = frozenset(
    {
        "sear",
        "roast",
        "braise",
        "confit",
        "saute",
        "sauté",
        "poach",
        "steam",
        "grill",
        "fry",
        "bake",
        "simmer",
        "reduce",
        "pickle",
        "cure",
        "ferment",
        "blend",
        "emulsify",
        "boil",
        "deglaze",
        "baste",
    }
)

# Map surface forms → canonical technique id
_SURFACE: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bsear(?:s|ed|ing)?\b", re.I), "sear"),
    (re.compile(r"\broast(?:s|ed|ing)?\b", re.I), "roast"),
    (re.compile(r"\bbraise(?:s|d|ing)?\b", re.I), "braise"),
    (re.compile(r"\bconfit(?:s|ed|ing)?\b", re.I), "confit"),
    (re.compile(r"\bsaut[eé](?:s|d|ing)?\b", re.I), "saute"),
    (re.compile(r"\bpoach(?:es|ed|ing)?\b", re.I), "poach"),
    (re.compile(r"\bsteam(?:s|ed|ing)?\b", re.I), "steam"),
    (re.compile(r"\bgrill(?:s|ed|ing)?\b", re.I), "grill"),
    (re.compile(r"\bfry\b|\bfries\b|\bfried\b|\bfrying\b", re.I), "fry"),
    (re.compile(r"\bbake(?:s|d|ing)?\b", re.I), "bake"),
    (re.compile(r"\bsimmer(?:s|ed|ing)?\b", re.I), "simmer"),
    (re.compile(r"\breduce(?:s|d|ing)?\b|\breduction\b", re.I), "reduce"),
    (re.compile(r"\bpickle(?:s|d|ing)?\b", re.I), "pickle"),
    (re.compile(r"\bcure(?:s|d|ing)?\b", re.I), "cure"),
    (re.compile(r"\bferment(?:s|ed|ing)?\b", re.I), "ferment"),
    (re.compile(r"\bblend(?:s|ed|ing)?\b", re.I), "blend"),
    (re.compile(r"\bemulsif(?:y|ies|ied|ying)\b", re.I), "emulsify"),
    (re.compile(r"\bboil(?:s|ed|ing)?\b", re.I), "boil"),
    (re.compile(r"\bdeglaze(?:s|d|ing)?\b", re.I), "deglaze"),
    (re.compile(r"\bbaste(?:s|d|ing)?\b", re.I), "baste"),
    (re.compile(r"\bfrost(?:s|ed|ing)?\b", re.I), "frost"),
]


def extract_techniques(steps: list[str]) -> set[str]:
    found: set[str] = set()
    for step in steps:
        for pat, canon in _SURFACE:
            if pat.search(step):
                found.add(canon)
    return found


def _ingredients_in_step(step: str, ingredients: list[str]) -> list[str]:
    low = step.lower()
    hit = []
    for ing in ingredients:
        if re.search(rf"\b{re.escape(ing)}\b", low):
            hit.append(ing)
            continue
        parts = ing.split()
        if len(parts) == 1 and parts[0] in low.split():
            hit.append(ing)
    return hit


def associate_techniques(
    directions: list[str], ingredients: list[str]
) -> list[tuple[str, str]]:
    """Return (ingredient, technique) pairs for a recipe."""
    pairs: list[tuple[str, str]] = []
    if not directions or not ingredients:
        return pairs

    for step in directions:
        techs = extract_techniques([step])
        techs = {t for t in techs if t in TECHNIQUE_VOCAB or t == "saute"}
        techs = {"saute" if t == "sauté" else t for t in techs}
        ings = _ingredients_in_step(step, ingredients)
        if not techs:
            continue
        targets = ings or list(ingredients)
        for ing in targets:
            for tech in techs:
                pairs.append((ing, tech))
    return pairs


class TechniqueAccumulator:
    def __init__(self) -> None:
        self.pair_counts: Counter = Counter()
        self.ing_counts: Counter = Counter()
        self.n_recipes = 0

    def add(self, ingredients: List[str], directions: List[str]) -> None:
        if not ingredients or not directions:
            return
        self.n_recipes += 1
        for ing in ingredients:
            self.ing_counts[ing] += 1
        seen_pair: set[tuple[str, str]] = set()
        for ing, tech in associate_techniques(directions, ingredients):
            if (ing, tech) not in seen_pair:
                self.pair_counts[(ing, tech)] += 1
                seen_pair.add((ing, tech))

    def finalize(self, min_freq: int = 1) -> list[dict]:
        edges: list[dict] = []
        for (ing, tech), freq in self.pair_counts.items():
            if freq < min_freq:
                continue
            conf = freq / self.ing_counts[ing] if self.ing_counts[ing] else 0.0
            edges.append(
                {
                    "ingredient": ing,
                    "technique": tech,
                    "freq": freq,
                    "confidence": round(float(conf), 6),
                }
            )
        return edges


) -> list[dict]:
    acc = TechniqueAccumulator()
    for row in recipe_rows:
        acc.add(row["ingredients"], row["directions"])
    return acc.finalize(min_freq=min_freq)
