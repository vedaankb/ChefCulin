"""
ICD-coded health lens — MeSH compound_disease + name-match bridge (v1).

ICD-10-CM codes come from NLM Clinical Tables. Disease evidence stays MeSH
(FoodAtlas / compound_disease.jsonl). Matching is token overlap on disease
names — not a UMLS crosswalk. Callers must surface that in the UI.
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Optional

DEFAULT_VCF = Path(__file__).resolve().parents[1] / "artifacts" / "vcf"

_STOP = frozenset(
    {
        "a",
        "an",
        "the",
        "and",
        "or",
        "of",
        "in",
        "with",
        "without",
        "mellitus",
        "disease",
        "diseases",
        "unspecified",
        "specified",
        "syndrome",
        "type",
        "due",
        "to",
        "other",
        "nos",
        "nec",
    }
)


def _load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    rows = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def tokenize_condition(text: str) -> list[str]:
    """Keywords from an ICD (or free-text) condition name."""
    if not text:
        return []
    parts = re.split(r"[\s,();/\-]+", text.lower())
    out = []
    for w in parts:
        w = re.sub(r"[^a-z0-9]", "", w)
        if len(w) > 2 and w not in _STOP:
            out.append(w)
    return out


def score_disease_name(disease_name: str, tokens: list[str]) -> float:
    """Share of query tokens that are whole tokens of the disease name. 0 when none match."""
    if not tokens or not disease_name:
        return 0.0
    name = disease_name.lower()
    name_tokens = set(tokenize_condition(name))
    if not name_tokens:
        return 0.0
    hits = sum(1 for t in tokens if t in name_tokens)
    if hits == 0:
        return 0.0
    overlap = hits / max(len(set(tokens)), 1)
    return min(1.0, overlap)


def load_health_tables(vcf_dir: Optional[Path] = None) -> dict[str, Any]:
    """Index compound_disease + culinary profiles for ingredient↔disease joins."""
    root = Path(vcf_dir or DEFAULT_VCF)
    disease_rows = _load_jsonl(root / "compound_disease.jsonl")
    profiles = _load_jsonl(root / "profiles.jsonl")
    compounds = _load_jsonl(root / "compounds.jsonl")

    by_compound: dict[str, list[dict]] = defaultdict(list)
    diseases_by_key: dict[str, dict] = {}
    for row in disease_rows:
        cid = row.get("compound_id")
        if not cid:
            continue
        by_compound[cid].append(row)
        did = row.get("disease_id") or row.get("disease_external_id") or row.get("disease_name")
        if did and did not in diseases_by_key:
            diseases_by_key[did] = {
                "disease_id": row.get("disease_id"),
                "disease_name": row.get("disease_name"),
                "disease_external_id": row.get("disease_external_id"),
            }

    compound_name: dict[str, str] = {}
    for c in compounds:
        cid = c.get("compound_id")
        if cid and cid not in compound_name:
            compound_name[cid] = c.get("raw_compound") or c.get("compound_group") or cid

    # compound → culinary products that contain it
    products_by_compound: dict[str, list[dict]] = defaultdict(list)
    profiles_by_name: dict[str, list[dict]] = defaultdict(list)
    culinary_profiles: list[dict] = []
    for p in profiles:
        if p.get("class") != "culinary":
            continue
        culinary_profiles.append(p)
        base = (p.get("base_ingredient") or "").strip().lower()
        raw = (p.get("raw_name") or "").strip().lower()
        if base:
            profiles_by_name[base].append(p)
        if raw and raw != base:
            profiles_by_name[raw].append(p)
        summary = {
            "vcf_product_id": p.get("vcf_product_id"),
            "raw_name": p.get("raw_name"),
            "base_ingredient": p.get("base_ingredient"),
            "spine_id": p.get("spine_id"),
            "product_group": p.get("product_group"),
        }
        for cid in p.get("compound_ids") or []:
            products_by_compound[cid].append(summary)

    return {
        "_dir": str(root.resolve()),
        "rows": disease_rows,
        "by_compound": dict(by_compound),
        "diseases": list(diseases_by_key.values()),
        "compound_name": compound_name,
        "products_by_compound": dict(products_by_compound),
        "profiles_by_name": dict(profiles_by_name),
        "culinary_profiles": culinary_profiles,
        "counts": {
            "compound_disease": len(disease_rows),
            "disease_entities": len(diseases_by_key),
            "compounds_with_disease": len(by_compound),
            "culinary_profiles": len(culinary_profiles),
        },
    }


def empty_health_tables(vcf_dir: Optional[Path] = None) -> dict[str, Any]:
    root = Path(vcf_dir or DEFAULT_VCF)
    return {
        "_dir": str(root.resolve()),
        "rows": [],
        "by_compound": {},
        "diseases": [],
        "compound_name": {},
        "products_by_compound": {},
        "profiles_by_name": {},
        "culinary_profiles": [],
        "counts": {
            "compound_disease": 0,
            "disease_entities": 0,
            "compounds_with_disease": 0,
            "culinary_profiles": 0,
        },
    }


def _word_hit(needle: str, haystack: str) -> bool:
    if not needle or not haystack or needle == haystack:
        return False
    return re.search(rf"(?:^|\b){re.escape(needle)}(?:\b|$)", haystack) is not None


def resolve_profiles(health: dict[str, Any], ingredient: str) -> list[dict]:
    """Match a free-text ingredient to culinary VCF profiles."""
    key = (ingredient or "").strip().lower()
    if not key:
        return []
    by_name = health.get("profiles_by_name") or {}
    if key in by_name:
        return list(by_name[key])
    # Whole-word fallback: "garlic powder" → garlic, not "gar" → garlic.
    hits = []
    for name, profiles in by_name.items():
        if _word_hit(key, name) or _word_hit(name, key):
            hits.extend(profiles)
    # de-dupe by product id
    seen = set()
    out = []
    for p in hits:
        pid = p.get("vcf_product_id")
        if pid in seen:
            continue
        seen.add(pid)
        out.append(p)
    return out


def diseases_for_ingredient(
    health: dict[str, Any],
    ingredient: str,
    *,
    n: int = 40,
) -> dict[str, Any]:
    profiles = resolve_profiles(health, ingredient)
    if not profiles:
        return {
            "ingredient": ingredient,
            "matched_profiles": [],
            "count": 0,
            "results": [],
            "bridge": "mesh_compound_disease",
        }

    by_compound = health.get("by_compound") or {}
    compound_name = health.get("compound_name") or {}
    # Aggregate by disease_id
    agg: dict[str, dict] = {}
    for p in profiles:
        for cid in p.get("compound_ids") or []:
            for row in by_compound.get(cid, []):
                did = row.get("disease_id") or row.get("disease_name")
                if not did:
                    continue
                slot = agg.get(did)
                if slot is None:
                    slot = {
                        "disease_id": row.get("disease_id"),
                        "disease_name": row.get("disease_name"),
                        "disease_external_id": row.get("disease_external_id"),
                        "directions": defaultdict(int),
                        "n_attestations": 0,
                        "compounds": {},
                    }
                    agg[did] = slot
                direction = row.get("direction") or "unknown"
                slot["directions"][direction] += 1
                slot["n_attestations"] += int(row.get("n_attestations") or 0)
                cslot = slot["compounds"].setdefault(
                    cid,
                    {
                        "compound_id": cid,
                        "compound_name": compound_name.get(cid) or cid,
                        "direction": direction,
                        "n_attestations": 0,
                        "evidence_source": row.get("evidence_source"),
                    },
                )
                cslot["n_attestations"] += int(row.get("n_attestations") or 0)

    results = []
    for slot in agg.values():
        compounds = sorted(
            slot["compounds"].values(),
            key=lambda c: (-c["n_attestations"], c["compound_id"]),
        )
        results.append(
            {
                "disease_id": slot["disease_id"],
                "disease_name": slot["disease_name"],
                "disease_external_id": slot["disease_external_id"],
                "direction_counts": dict(slot["directions"]),
                "n_attestations": slot["n_attestations"],
                "n_compounds": len(compounds),
                "compounds": compounds[:8],
            }
        )
    results.sort(key=lambda r: (-r["n_attestations"], -r["n_compounds"], r["disease_name"] or ""))
    results = results[:n]

    return {
        "ingredient": ingredient,
        "matched_profiles": [
            {
                "vcf_product_id": p.get("vcf_product_id"),
                "raw_name": p.get("raw_name"),
                "base_ingredient": p.get("base_ingredient"),
                "spine_id": p.get("spine_id"),
                "n_compounds": p.get("n_compounds"),
            }
            for p in profiles[:5]
        ],
        "count": len(results),
        "results": results,
        "bridge": "mesh_compound_disease",
        "note": "Disease IDs are MeSH (FoodAtlas/CTD), not ICD.",
    }


def match_diseases_by_condition(
    health: dict[str, Any],
    name: str,
    *,
    n: int = 20,
    min_score: float = 0.34,
) -> list[dict]:
    tokens = tokenize_condition(name)
    if not tokens:
        return []
    scored = []
    for d in health.get("diseases") or []:
        dname = d.get("disease_name") or ""
        s = score_disease_name(dname, tokens)
        if s >= min_score:
            scored.append({**d, "match_score": round(s, 3), "match_tokens": tokens})
    scored.sort(key=lambda r: (-r["match_score"], r.get("disease_name") or ""))
    return scored[:n]


def ingredients_for_condition(
    health: dict[str, Any],
    *,
    name: str,
    code: Optional[str] = None,
    n: int = 24,
    exclude: Optional[set[str]] = None,
) -> dict[str, Any]:
    """ICD/condition name → MeSH name-match → compounds → culinary ingredients."""
    matched = match_diseases_by_condition(health, name)
    exclude_l = {e.lower() for e in (exclude or set())}
    by_compound = health.get("by_compound") or {}
    products_by_compound = health.get("products_by_compound") or {}
    compound_name = health.get("compound_name") or {}

    matched_ids = {d.get("disease_id") for d in matched if d.get("disease_id")}
    # Gather compounds linked to matched diseases
    compound_hits: dict[str, dict] = {}
    for cid, rows in by_compound.items():
        for row in rows:
            if row.get("disease_id") not in matched_ids:
                continue
            slot = compound_hits.setdefault(
                cid,
                {
                    "compound_id": cid,
                    "compound_name": compound_name.get(cid) or cid,
                    "diseases": [],
                    "n_attestations": 0,
                },
            )
            slot["n_attestations"] += int(row.get("n_attestations") or 0)
            slot["diseases"].append(
                {
                    "disease_name": row.get("disease_name"),
                    "disease_external_id": row.get("disease_external_id"),
                    "direction": row.get("direction"),
                }
            )

    # Score ingredients by unique matched-disease compounds, not by how many
    # product forms share a base name (garlic clove + garlic powder would
    # otherwise count the same compound twice).
    ing_scores: dict[str, dict] = {}
    seen_compounds: dict[str, set[str]] = {}
    for cid, chit in compound_hits.items():
        for prod in products_by_compound.get(cid, []):
            label = (prod.get("base_ingredient") or prod.get("raw_name") or "").strip()
            if not label:
                continue
            if label.lower() in exclude_l:
                continue
            key = label.lower()
            seen = seen_compounds.setdefault(key, set())
            if cid in seen:
                continue
            seen.add(cid)
            slot = ing_scores.get(key)
            if slot is None:
                slot = {
                    "ingredient": label,
                    "base_ingredient": prod.get("base_ingredient"),
                    "raw_name": prod.get("raw_name"),
                    "spine_id": prod.get("spine_id"),
                    "vcf_product_id": prod.get("vcf_product_id"),
                    "product_group": prod.get("product_group"),
                    "n_compounds": 0,
                    "n_attestations": 0,
                    "sample_compounds": [],
                }
                ing_scores[key] = slot
            slot["n_compounds"] += 1
            slot["n_attestations"] += chit["n_attestations"]
            if len(slot["sample_compounds"]) < 4:
                slot["sample_compounds"].append(
                    {
                        "compound_id": cid,
                        "compound_name": chit["compound_name"],
                    }
                )

    results = sorted(
        ing_scores.values(),
        key=lambda r: (-r["n_compounds"], -r["n_attestations"], r["ingredient"].lower()),
    )[:n]

    return {
        "code": code,
        "name": name,
        "bridge": "icd_name_to_mesh",
        "note": (
            "ICD codes are resolved by name-match onto MeSH disease labels in "
            "compound_disease.jsonl — not a curated ICD↔MeSH crosswalk."
        ),
        "matched_diseases": matched,
        "count": len(results),
        "results": results,
    }


def search_icd10cm(term: str, *, max_results: int = 20) -> list[dict]:
    """Proxy NLM Clinical Tables ICD-10-CM search. Returns [{code, name}, ...]."""
    import httpx

    q = (term or "").strip()
    if not q:
        return []
    with httpx.Client(timeout=20.0) as client:
        res = client.get(
            "https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search",
            params={
                "terms": q,
                "sf": "code,name",
                "df": "code,name",
                "count": max_results,
            },
        )
        res.raise_for_status()
        data = res.json()
    display = data[3] if isinstance(data, list) and len(data) > 3 else []
    out = []
    for item in display:
        if not item or len(item) < 2:
            continue
        out.append({"code": item[0], "name": item[1]})
    return out
