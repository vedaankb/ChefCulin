"""
VCF artifact tables for the app's Compound, Form and Phase lenses.

These are the Step 3-8 artifacts (spine, pairs, form diffs, competition,
phase frames), kept out of api.py so the corpus/palate service stays readable.
Loaded once at startup and indexed by spine_id / vcf_product_id.

Everything here serves rows the pipeline already decided. No scoring, no
sentence generation: the lens renders what the corpus says or says nothing.
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Any, Optional

DEFAULT_VCF = Path(__file__).resolve().parents[1] / "artifacts" / "vcf"


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


def load_vcf_tables(vcf_dir: Optional[Path] = None) -> dict[str, Any]:
    root = Path(vcf_dir or DEFAULT_VCF)
    spine = _load_jsonl(root / "spine.jsonl")
    pairs = _load_jsonl(root / "pairs.jsonl")
    form_diffs = _load_jsonl(root / "form_diffs.jsonl")
    competition = _load_jsonl(root / "competition.jsonl")
    phase_frames = _load_jsonl(root / "phase_frames.jsonl")
    profiles = _load_jsonl(root / "profiles.jsonl")
    descriptors = _load_jsonl(root / "compound_descriptors.jsonl")
    compounds = _load_jsonl(root / "compounds.jsonl")
    meta_path = root / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}

    # pairs are stored per anchor product; the app asks by spine id or product id.
    pairs_by_spine: dict[str, list[dict]] = defaultdict(list)
    pairs_by_product: dict[int, list[dict]] = defaultdict(list)
    for row in pairs:
        pairs_by_spine[row["anchor_spine_id"]].append(row)
        pairs_by_product[row["anchor_vcf_product_id"]].append(row)
    for bucket in (pairs_by_spine, pairs_by_product):
        for rows in bucket.values():
            rows.sort(key=lambda r: r.get("rank", 10**6))

    # form diffs are double-stored (A->B and B->A), so one lookup per anchor.
    forms_by_product: dict[int, list[dict]] = defaultdict(list)
    forms_by_spine: dict[str, list[dict]] = defaultdict(list)
    for row in form_diffs:
        anchor = row.get("from_vcf_product_id") or row.get("vcf_product_id_a")
        if anchor is not None:
            forms_by_product[anchor].append(row)
        sid = row.get("spine_id")
        if sid:
            forms_by_spine[sid].append(row)

    comp_by_product: dict[int, list[dict]] = defaultdict(list)
    for row in competition:
        comp_by_product[row["vcf_product_id_a"]].append(row)
        comp_by_product[row["vcf_product_id_b"]].append(row)

    spine_by_id = {e["spine_id"]: e for e in spine}
    member_to_spine: dict[int, str] = {}
    for entry in spine:
        for m in entry.get("members") or []:
            member_to_spine[m["vcf_product_id"]] = entry["spine_id"]

    profiles_by_id = {p["vcf_product_id"]: p for p in profiles if "vcf_product_id" in p}
    phase_bucket_by_compound = {
        c["compound_id"]: c.get("phase_bucket")
        for c in compounds
        if c.get("compound_id") and c.get("phase_bucket")
    }

    # First useful descriptor per compound_id (source already priority-sorted in the artifact).
    descriptors_by_id: dict[str, list[str]] = defaultdict(list)
    LOW_INFO = {"odorless", "characteristic odor", "characteristic odour"}
    for d in descriptors:
        cid = d.get("compound_id")
        phrase = (d.get("descriptor") or "").strip()
        if not cid or not phrase:
            continue
        if phrase.lower() in LOW_INFO:
            continue
        bucket = descriptors_by_id[cid]
        if phrase not in bucket and len(bucket) < 3:
            bucket.append(phrase)

    return {
        "_dir": str(root.resolve()),
        "meta": meta,
        "spine": spine,
        "spine_by_id": spine_by_id,
        "member_to_spine": member_to_spine,
        "pairs_by_spine": dict(pairs_by_spine),
        "pairs_by_product": dict(pairs_by_product),
        "forms_by_product": dict(forms_by_product),
        "forms_by_spine": dict(forms_by_spine),
        "competition_by_product": dict(comp_by_product),
        "phase_frames": phase_frames,
        "profiles_by_id": profiles_by_id,
        "descriptors_by_id": dict(descriptors_by_id),
        "phase_bucket_by_compound": phase_bucket_by_compound,
        "counts": {
            "spine": len(spine),
            "pairs": len(pairs),
            "form_diffs": len(form_diffs),
            "competition": len(competition),
            "phase_frames": len(phase_frames),
            "profiles": len(profiles),
            "descriptors": len(descriptors),
            "compounds": len(compounds),
        },
    }


def empty_vcf_tables(vcf_dir: Optional[Path] = None) -> dict[str, Any]:
    root = Path(vcf_dir or DEFAULT_VCF)
    return {
        "_dir": str(root.resolve()),
        "meta": {},
        "spine": [],
        "spine_by_id": {},
        "member_to_spine": {},
        "pairs_by_spine": {},
        "pairs_by_product": {},
        "forms_by_product": {},
        "forms_by_spine": {},
        "competition_by_product": {},
        "phase_frames": [],
        "profiles_by_id": {},
        "descriptors_by_id": {},
        "phase_bucket_by_compound": {},
        "counts": {
            "spine": 0,
            "pairs": 0,
            "form_diffs": 0,
            "competition": 0,
            "phase_frames": 0,
            "profiles": 0,
            "descriptors": 0,
            "compounds": 0,
        },
    }


def enrich_pair_row(row: dict, vcf: dict[str, Any]) -> dict:
    """Attach profile_source and optional odor descriptors — never invent either."""
    out = dict(row)
    profiles = vcf.get("profiles_by_id") or {}
    descriptors = vcf.get("descriptors_by_id") or {}
    anchor = profiles.get(row.get("anchor_vcf_product_id")) or {}
    match = profiles.get(row.get("match_vcf_product_id")) or {}
    out["anchor_profile_source"] = anchor.get("profile_source")
    out["match_profile_source"] = match.get("profile_source")
    out["mixed_profile_source"] = bool(
        out["anchor_profile_source"]
        and out["match_profile_source"]
        and out["anchor_profile_source"] != out["match_profile_source"]
    )
    shared = []
    for c in row.get("top_shared_compounds") or []:
        item = dict(c)
        phrases = descriptors.get(c.get("compound_id") or "") or []
        if phrases:
            item["descriptors"] = phrases
        shared.append(item)
    out["top_shared_compounds"] = shared
    return out


def dominant_bucket_for_product(product_id: int, vcf: dict[str, Any]) -> Optional[str]:
    """Majority phase_bucket across a product's compounds. None when unknown."""
    profile = (vcf.get("profiles_by_id") or {}).get(product_id)
    buckets_map = vcf.get("phase_bucket_by_compound") or {}
    if not profile:
        return None
    counts: dict[str, int] = defaultdict(int)
    for cid in profile.get("compound_ids") or []:
        b = buckets_map.get(cid)
        if b:
            counts[b] += 1
    if not counts:
        return None
    return sorted(counts, key=lambda k: (-counts[k], k))[0]
