"""
Derive culinary balance axes from FooDB Content tables (mg/100g) and
volatile-compound assignments from the flavor-network projection.

Content: pipeline/vendor/foodb/.../Content.csv (+ Compound.csv, Nutrient.csv)
Compounds: pipeline/vendor/flavor_network/compound_ingredient_health_mapping.tsv

Each axis score is percentile-normalised across the corpus (0–1); content and
compound sources are scaled separately then merged with max().
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

from culin_etl.compound_network import network_token
from culin_etl.foodb_content import load_content_profiles
from culin_etl.vendor_paths import FOODB_CONTENT_CSV, HEALTH_MAPPING_TSV

ROOT = Path(__file__).resolve().parents[2]
FOODB_JSON = ROOT / "src" / "data" / "ingredients.json"

AXES = (
    "glut",
    "nucl",
    "salt",
    "fat",
    "acid",
    "sweet",
    "capsaicin",
    "pungent",
    "trigeminal",
)

# Compound-name patterns → axis weights (literature-backed sensory chemistry).
COMPOUND_RULES: Tuple[Tuple[re.Pattern[str], str, float], ...] = tuple(
    (re.compile(pat, re.I), axis, weight)
    for pat, axis, weight in [
        (r"glutamic|glutamate", "glut", 1.0),
        (r"\bglutamine\b", "glut", 0.35),
        (r"inosin|guanosin|guanyl|5.?.inosinate|5.?.guanylate", "nucl", 1.0),
        (r"\bsodium\b|sodium_chloride", "salt", 1.0),
        (
            r"citric|malic|tartaric|acetic|lactic|fumaric|succinic|oxalic|ascorbic|quinic",
            "acid",
            1.0,
        ),
        (r"sucrose|fructose|glucose|maltose|lactose|galactose|maltol", "sweet", 1.0),
        (r"capsaicin|dihydrocapsaicin|nordihydrocapsaicin|nonivamide", "capsaicin", 1.0),
        (r"isothiocyanate|sinigrin", "pungent", 1.0),
        (r"piperine|gingerol|shogaol|sanshool|\beugenol\b", "trigeminal", 1.0),
        (
            r"hexanoic|octanoic|decanoic|dodecanoic|tetradecanoic|hexadecanoic|"
            r"palmitic|stearic|oleic|linoleic|butyric|propionic|decanol|octanol",
            "fat",
            0.6,
        ),
    ]
)

# FooDB taxonomy fallback when compound coverage is thin (food_group from ingredients.json).
GROUP_FALLBACK: Dict[str, Dict[str, float]] = {
    "Fruits": {"acid": 0.45, "sweet": 0.5},
    "Nuts": {"fat": 0.65},
    "Milk and milk products": {"fat": 0.55, "salt": 0.25},
    "Cocoa and cocoa products": {"fat": 0.4, "sweet": 0.35},
    "Confectioneries": {"sweet": 0.7},
    "Soy": {"glut": 0.55, "salt": 0.35},
    "Animal foods": {"nucl": 0.7, "fat": 0.4},
    "Aquatic foods": {"glut": 0.35, "nucl": 0.75, "salt": 0.2},
    "Vegetables": {},
    "Herbs and Spices": {},
}

NAME_HINTS: Tuple[Tuple[re.Pattern[str], Dict[str, float]], ...] = tuple(
    (re.compile(pat, re.I), axes)
    for pat, axes in [
        (r"vinegar|verjus", {"acid": 0.9}),
        (r"\bsorrel\b", {"acid": 0.85}),
        (r"soy sauce|fish sauce|miso|anchovy|parmesan|pecorino|aged cheese", {"glut": 0.7, "salt": 0.6, "nucl": 0.4}),
        (r"citrus|lemon|lime|grapefruit|orange", {"acid": 0.75}),
        (r"chile|chili|capsicum|jalapeno|habanero|serrano|ancho|pasilla", {"capsaicin": 0.85}),
        (r"horseradish|wasabi|mustard", {"pungent": 0.9}),
        (r"ginger|galangal|sansh|peppercorn", {"trigeminal": 0.7}),
    ]
)


def classify_compound(compound_norm: str) -> Dict[str, float]:
    out: Dict[str, float] = {}
    name = str(compound_norm or "").strip()
    if not name:
        return out
    for pattern, axis, weight in COMPOUND_RULES:
        if pattern.search(name):
            out[axis] = max(out.get(axis, 0.0), weight)
    return out


def _norm_ingredient_key(name: str) -> str:
    return re.sub(r"\s+", " ", str(name or "").strip().lower())


def load_compound_profiles(path: Path = HEALTH_MAPPING_TSV) -> Dict[str, Dict[str, float]]:
    """ingredient_name_norm → raw axis totals from distinct compounds."""
    by_ing: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    seen: Dict[str, set] = defaultdict(set)

    with path.open(encoding="utf-8") as f:
        header = f.readline()
        if not header.startswith("#"):
            f.seek(0)
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split("\t")
            if len(parts) < 10:
                continue
            compound_norm = parts[5].strip()
            ing_norm = _norm_ingredient_key(parts[9])
            if not ing_norm:
                continue
            key = (ing_norm, compound_norm)
            if key in seen[ing_norm]:
                continue
            seen[ing_norm].add(key)
            for axis, weight in classify_compound(compound_norm).items():
                by_ing[ing_norm][axis] += weight

    return {k: dict(v) for k, v in by_ing.items()}


def _token_keys(name: str) -> List[str]:
    token = network_token(name)
    keys = []
    if token:
        keys.append(_norm_ingredient_key(token.replace("_", " ")))
    lower = _norm_ingredient_key(name)
    keys.append(lower)
    keys.append(lower.replace("(", " ").replace(")", " ").strip())
    compact = re.sub(r"[^a-z0-9]+", " ", lower).strip()
    if compact:
        keys.append(compact)
    out = []
    seen = set()
    for k in keys:
        if k and k not in seen:
            seen.add(k)
            out.append(k)
    return out


def lookup_compound_profile(name: str, profiles: Dict[str, Dict[str, float]]) -> Dict[str, float]:
    best: Dict[str, float] = {}
    for key in _token_keys(name):
        if key in profiles:
            cand = profiles[key]
            if sum(cand.values()) > sum(best.values()):
                best = cand
        # substring match on compound-db names (e.g. "chicken" → "chicken breast")
        for ing_key, axes in profiles.items():
            if key and (key in ing_key or ing_key in key):
                if sum(axes.values()) > sum(best.values()):
                    best = dict(axes)
    return best


def name_hint_axes(name: str) -> Dict[str, float]:
    blob = str(name or "")
    out: Dict[str, float] = {}
    for pattern, axes in NAME_HINTS:
        if pattern.search(blob):
            for axis, weight in axes.items():
                out[axis] = max(out.get(axis, 0.0), weight)
    return out


def foodb_fallback_axes(food_group: str, food_subgroup: str) -> Dict[str, float]:
    group = GROUP_FALLBACK.get(food_group or "", {})
    out = dict(group)
    sub = (food_subgroup or "").lower()
    if sub == "spices":
        out.setdefault("trigeminal", 0.3)
    return out


def merge_axes(*parts: Dict[str, float]) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for part in parts:
        for axis, value in part.items():
            if axis not in AXES:
                continue
            out[axis] = max(out.get(axis, 0.0), float(value))
    return out


def normalize_corpus(rows: Iterable[Dict[str, float]], percentile: float = 0.92) -> Dict[str, float]:
    """Per-axis scale factors so p-th percentile maps to 1.0."""
    buckets: Dict[str, List[float]] = {a: [] for a in AXES}
    for row in rows:
        for axis in AXES:
            v = float(row.get(axis, 0) or 0)
            if v > 0:
                buckets[axis].append(v)
    scales: Dict[str, float] = {}
    for axis, vals in buckets.items():
        if not vals:
            scales[axis] = 1.0
            continue
        vals.sort()
        idx = min(len(vals) - 1, int(len(vals) * percentile))
        scales[axis] = max(vals[idx], 0.001)
    return scales


def scale_axes(raw: Dict[str, float], scales: Dict[str, float]) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for axis in AXES:
        raw_v = float(raw.get(axis, 0) or 0)
        if raw_v <= 0:
            continue
        out[axis] = min(1.0, round(raw_v / scales.get(axis, 1.0), 4))
    return out


def build_foodb_balance_rows(
    foodb_path: Path = FOODB_JSON,
    compound_path: Path = HEALTH_MAPPING_TSV,
    content_path: Path = FOODB_CONTENT_CSV,
) -> Tuple[List[dict], dict]:
    profiles = load_compound_profiles(compound_path)
    foodb = json.loads(foodb_path.read_text(encoding="utf-8"))

    target_ids = [str(row.get("foodb_id")) for row in foodb if row.get("foodb_id")]
    content_profiles: Dict[str, Dict[str, float]] = {}
    content_meta: dict = {}
    if content_path.exists():
        content_profiles, content_meta = load_content_profiles(target_ids, content_path=content_path)

    raw_rows = []
    for row in foodb:
        name = row["name"]
        foodb_id = str(row.get("foodb_id") or "")
        compound_raw = lookup_compound_profile(name, profiles)
        content_raw = dict(content_profiles.get(foodb_id, {}))
        hints = name_hint_axes(name)
        fallback = foodb_fallback_axes(row.get("food_group"), row.get("food_subgroup"))
        raw_rows.append(
            {
                "foodb_id": row.get("foodb_id"),
                "name": name,
                "food_group": row.get("food_group"),
                "compound_hits": len(compound_raw),
                "content_hits": len(content_raw),
                "compound_raw": compound_raw,
                "content_raw": content_raw,
                "hints": hints,
                "fallback": fallback,
            }
        )

    compound_scales = normalize_corpus(r["compound_raw"] for r in raw_rows)
    content_scales = normalize_corpus(r["content_raw"] for r in raw_rows) if content_profiles else {a: 1.0 for a in AXES}

    out_rows = []
    compound_backed = 0
    content_backed = 0
    for item in raw_rows:
        scaled = merge_axes(
            scale_axes(item["compound_raw"], compound_scales),
            scale_axes(item["content_raw"], content_scales),
            item["hints"],
            item["fallback"],
        )
        source_parts = []
        if item["content_hits"]:
            content_backed += 1
            source_parts.append("content")
        if item["compound_hits"]:
            compound_backed += 1
            source_parts.append("compounds")
        if item["hints"] and not source_parts:
            source_parts.append("hints")
        if item["fallback"] and not source_parts:
            source_parts.append("taxonomy")
        source = "foodb_" + "+".join(source_parts) if source_parts else "none"
        out_rows.append(
            {
                "foodb_id": item["foodb_id"],
                "name": item["name"],
                "food_group": item["food_group"],
                "source": source,
                "compound_hits": item["compound_hits"],
                "content_hits": item["content_hits"],
                "axes": scaled,
            }
        )

    meta = {
        "source_tsv": str(compound_path.resolve()),
        "content_csv": content_meta.get("content_csv") if content_meta else None,
        "foodb_count": len(out_rows),
        "compound_backed": compound_backed,
        "content_backed": content_backed,
        "compound_ingredients": len(profiles),
        "compound_axis_scales": compound_scales,
        "content_axis_scales": content_scales,
        "version": "foodb_content_v1",
    }
    if content_meta:
        meta["content_rows_scanned"] = content_meta.get("content_rows_scanned")
        meta["content_foods"] = content_meta.get("content_foods")
    return out_rows, meta


