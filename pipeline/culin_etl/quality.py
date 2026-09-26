from __future__ import annotations

from culin_etl.normalize import normalize_ner
from culin_etl.parse import Recipe


def is_low_quality(recipe: Recipe, min_ingredients: int = 2, min_steps: int = 1) -> bool:
    ner = recipe.ner or []
    ings = recipe.ingredients or []
    dirs = recipe.directions or []
    if not dirs:
        return True
    if len(ner) < min_ingredients and len(ings) < min_ingredients:
        return True
    if len(dirs) < min_steps:
        return True
    # single-ingredient "recipes"
    if len(normalize_ner(ner) if ner else []) < min_ingredients and len(ings) < min_ingredients:
        return True
    if len(ner) == 1 or (len(ings) == 1 and len(ner) <= 1):
        return True
    return False


def _fingerprint(recipe: Recipe) -> tuple:
    ner = tuple(sorted(normalize_ner(recipe.ner)))
    dirs = tuple(d.strip().lower() for d in recipe.directions)
    return (ner, dirs)


