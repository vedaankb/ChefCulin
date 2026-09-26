#!/usr/bin/env python3
"""Build src/data/traditional_culinary_uses_database_v2.db from the Tradition canon workbook.

Default source: pipeline/vendor/tradition/tradition_dishes_demo_9.xlsx

The lens reads active canon rows only. Hold/excluded stay in the file with
canon_status set so they cannot leak into matches. Pending corpus-match
confidence is stored as Pending / unrated_pending_corpus_match — never as Low.

Validated live-spine IDs from the audit sheet are attached to companions
when Resolution State is resolved. Version/product conflicts are recorded
on ingredient_spine_resolution and are not forced onto a cluster id.
"""
from __future__ import annotations

import argparse
import hashlib
import shutil
import sqlite3
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path
from zipfile import ZipFile

NS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
ROOT = Path(__file__).resolve().parents[2]
DEFAULT_XLSX = ROOT / "pipeline" / "vendor" / "tradition" / "tradition_dishes_demo_9.xlsx"
DEFAULT_OUT = ROOT / "src" / "data" / "traditional_culinary_uses_database_v2.db"
ROOT_COPY = ROOT / "traditional_culinary_uses_database_v2.db"

COLS = []
n = 1
while n <= 40:
    s, x = "", n
    while x:
        x, r = divmod(x - 1, 26)
        s = chr(65 + r) + s
    COLS.append(s)
    n += 1

PRIMARY_RANK = {
    "Wikipedia article": 0,
    "Wikipedia": 1,
    "Wikipedia fallback": 2,
    "RecipeNLG": 3,
    "RecipeDB": 4,
}


def cell_value(c):
    t = c.attrib.get("t")
    v = c.find("x:v", NS)
    is_el = c.find("x:is", NS)
    if t == "inlineStr" and is_el is not None:
        return "".join((n.text or "") for n in is_el.findall(".//x:t", NS))
    if v is None or v.text is None:
        return None
    if t in ("str", "inlineStr"):
        return v.text
    if t == "b":
        return "1" if v.text == "1" else "0"
    return v.text


def col_letter(ref: str) -> str:
    return "".join(ch for ch in ref if ch.isalpha())


def load_sheet(zf: ZipFile, n: int) -> list[dict]:
    root = ET.fromstring(zf.read(f"xl/worksheets/sheet{n}.xml"))
    rows = []
    for row in root.findall("x:sheetData/x:row", NS):
        cells = {}
        for c in row.findall("x:c", NS):
            cells[col_letter(c.attrib.get("r", ""))] = cell_value(c)
        rows.append(cells)
    return rows


def table_from(rows: list[dict], header_idx: int) -> list[dict]:
    header = rows[header_idx]
    keys = [k for k in COLS if header.get(k)]
    names = [header[k] for k in keys]
    out = []
    for r in rows[header_idx + 1 :]:
        if not any(r.get(k) for k in keys):
            continue
        out.append({names[i]: r.get(keys[i]) for i in range(len(keys))})
    return out


def clean(v):
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def to_int(v):
    s = clean(v)
    if s is None:
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


def load_workbook(path: Path):
    with ZipFile(path) as zf:
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        canon = table_from(load_sheet(zf, 2), 3)
        ingredients = table_from(load_sheet(zf, 3), 3)
        sources = table_from(load_sheet(zf, 4), 3)
        qa = table_from(load_sheet(zf, 8), 3)
        audit = table_from(load_sheet(zf, 13), 3)
    return digest, canon, ingredients, sources, qa, audit


def existing_record_ids(db_path: Path) -> dict[str, str]:
    if not db_path.exists():
        return {}
    con = sqlite3.connect(db_path)
    try:
        rows = con.execute("SELECT dish_id, record_id FROM use_records").fetchall()
        return {d: r for d, r in rows}
    except sqlite3.Error:
        return {}
    finally:
        con.close()


def is_dish_specific(source_type: str | None, note: str | None) -> int:
    st = (source_type or "").lower()
    nt = (note or "").lower()
    if "unesco" in st or "ich" in st:
        return 0
    if "cuisine-level" in nt or "culinary practice" in nt:
        return 0
    return 1


def pick_primary(sources: list[dict]) -> dict | None:
    specific = [s for s in sources if is_dish_specific(s.get("Source Type"), s.get("Note"))]
    pool = specific or sources
    if not pool:
        return None
    return min(pool, key=lambda s: PRIMARY_RANK.get(s.get("Source Type") or "", 50))


def evidence_basis(doc_status: str | None, nlg: int | None, rdb: int | None) -> str:
    if (nlg or 0) + (rdb or 0) > 0 or (doc_status or "") == "corpus_observed":
        return "Recipe corpus title match (RecipeNLG/RecipeDB)"
    return "Wikipedia-based dish documentation (no recipe-corpus title match)"


SCHEMA = """
CREATE TABLE use_records (
    record_id TEXT PRIMARY KEY,
    dish_id TEXT UNIQUE NOT NULL,
    cuisine TEXT NOT NULL,
    item TEXT NOT NULL,
    item_type TEXT NOT NULL,
    traditionality_class TEXT,
    traditionality_score INTEGER,
    use_or_dish TEXT,
    use_category TEXT,
    source_thread TEXT,
    country TEXT,
    region_or_community TEXT,
    cuisine_facet TEXT,
    macro_region TEXT,
    prep_family TEXT,
    technique_tags TEXT,
    preparation_or_function TEXT,
    occasion_or_context TEXT,
    historical_or_cultural_note TEXT,
    confidence TEXT,
    lens_confidence_state TEXT,
    evidence_basis TEXT,
    documentation_status TEXT,
    recipenlg_match_count INTEGER,
    recipedb_match_count INTEGER,
    recipe_match_count INTEGER,
    primary_source_id TEXT REFERENCES sources(source_id),
    primary_source_url TEXT,
    secondary_source_id TEXT REFERENCES sources(source_id),
    secondary_source_url TEXT,
    caveat TEXT,
    tags TEXT,
    wikipedia_url TEXT,
    canon_status TEXT NOT NULL DEFAULT 'active',
    qa_disposition TEXT
);
CREATE TABLE sources (
    source_id TEXT PRIMARY KEY,
    dish_id TEXT REFERENCES use_records(dish_id),
    title TEXT,
    publisher TEXT,
    source_type TEXT,
    is_dish_specific INTEGER NOT NULL,
    cuisine_coverage TEXT,
    item_coverage TEXT,
    url TEXT,
    source_use_note TEXT
);
CREATE TABLE companion_ingredients (
    companion_id TEXT PRIMARY KEY,
    dish_id TEXT NOT NULL REFERENCES use_records(dish_id),
    record_id TEXT NOT NULL REFERENCES use_records(record_id),
    cuisine TEXT,
    ingredient_name TEXT NOT NULL,
    ingredient_category TEXT,
    role_in_dish TEXT,
    is_optional INTEGER,
    use_priority TEXT,
    traditional_fit TEXT,
    dish_or_technique_family TEXT,
    preparation_note TEXT,
    region_or_context TEXT,
    primary_source_id TEXT REFERENCES sources(source_id),
    primary_source_url TEXT,
    secondary_source_id TEXT REFERENCES sources(source_id),
    secondary_source_url TEXT,
    spine_id TEXT,
    spine_match_basis TEXT
);
CREATE TABLE pair_ingredient_guide (
    pair_id TEXT PRIMARY KEY,
    dish_id TEXT UNIQUE NOT NULL REFERENCES use_records(dish_id),
    record_id TEXT UNIQUE NOT NULL REFERENCES use_records(record_id),
    cuisine TEXT,
    matrix_item TEXT,
    item_type TEXT,
    traditionality_score TEXT,
    companion_strategy TEXT,
    anchor_dishes TEXT,
    essential_companions TEXT,
    optional_amplifiers TEXT,
    technique_or_form TEXT,
    companion_record_count INTEGER,
    essential_or_high_count INTEGER,
    primary_source_id TEXT REFERENCES sources(source_id),
    primary_source_url TEXT,
    secondary_source_id TEXT REFERENCES sources(source_id),
    secondary_source_url TEXT,
    caveat TEXT
);
CREATE TABLE ingredient_spine_resolution (
    ingredient_raw TEXT PRIMARY KEY,
    working_canonical TEXT,
    ingredient_rows INTEGER,
    dish_count INTEGER,
    supplied_spine_id TEXT,
    final_spine_id TEXT,
    spine_match_basis TEXT,
    resolution_state TEXT,
    source_method TEXT,
    adjudication TEXT,
    live_candidate TEXT,
    note TEXT
);
CREATE TABLE qa_review (
    dish_id TEXT NOT NULL,
    cuisine TEXT,
    source_thread TEXT,
    title TEXT,
    severity TEXT,
    issue TEXT,
    basis TEXT,
    workbook_evidence TEXT,
    recommended_action TEXT,
    exclude_from_depth INTEGER,
    disposition TEXT,
    review_status TEXT
);
CREATE TABLE data_dictionary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section TEXT,
    field_term TEXT,
    definition TEXT,
    example TEXT
);
CREATE INDEX idx_ur_cuisine ON use_records(cuisine);
CREATE INDEX idx_ur_source_thread ON use_records(source_thread);
CREATE INDEX idx_ur_canon_status ON use_records(canon_status);
CREATE INDEX idx_src_dish ON sources(dish_id);
CREATE INDEX idx_ci_dish ON companion_ingredients(dish_id);
CREATE INDEX idx_ci_cuisine ON companion_ingredients(cuisine);
CREATE INDEX idx_ci_ingredient ON companion_ingredients(ingredient_name);
CREATE INDEX idx_ci_role ON companion_ingredients(role_in_dish);
CREATE INDEX idx_pg_dish ON pair_ingredient_guide(dish_id);
"""


def build(xlsx: Path, out: Path) -> None:
    digest, canon, ingredients, sources, qa, audit = load_workbook(xlsx)
    prior = existing_record_ids(out)
    used = set(prior.values())
    next_n = 1
    while f"R{next_n:04d}" in used:
        next_n += 1

    def record_id_for(dish_id: str) -> str:
        nonlocal next_n
        if dish_id in prior:
            return prior[dish_id]
        rid = f"R{next_n:04d}"
        next_n += 1
        while f"R{next_n:04d}" in used:
            next_n += 1
        used.add(rid)
        return rid

    record_of = {row["Dish Id"]: record_id_for(row["Dish Id"]) for row in canon if row.get("Dish Id")}

    spine_by_raw = {}
    for row in audit:
        raw = clean(row.get("Ingredient Raw"))
        if not raw:
            continue
        spine_by_raw[raw.lower()] = row

    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".db.tmp")
    if tmp.exists():
        tmp.unlink()
    con = sqlite3.connect(tmp)
    con.executescript(SCHEMA)

    sources_by_dish: dict[str, list[dict]] = defaultdict(list)
    for src in sources:
        dish_id = clean(src.get("Dish Id"))
        if dish_id:
            sources_by_dish[dish_id].append(src)

    titles = {row["Dish Id"]: row.get("Title") for row in canon}

    for src in sources:
        sid = clean(src.get("Source Id"))
        dish_id = clean(src.get("Dish Id"))
        if not sid:
            continue
        st = clean(src.get("Source Type"))
        note = clean(src.get("Note"))
        con.execute(
            """INSERT OR REPLACE INTO sources (
                source_id, dish_id, title, publisher, source_type, is_dish_specific,
                cuisine_coverage, item_coverage, url, source_use_note
            ) VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (
                sid,
                dish_id,
                clean(src.get("Title")),
                st,
                st,
                is_dish_specific(st, note),
                None,
                titles.get(dish_id),
                clean(src.get("Url")),
                note,
            ),
        )

    for row in canon:
        dish_id = clean(row.get("Dish Id"))
        if not dish_id:
            continue
        nlg = to_int(row.get("Recipenlg Match Count")) or 0
        rdb = to_int(row.get("Recipedb Match Count")) or 0
        primary = pick_primary(sources_by_dish.get(dish_id, []))
        secondary = None
        if primary:
            rest = [s for s in sources_by_dish.get(dish_id, []) if s.get("Source Id") != primary.get("Source Id")]
            secondary = pick_primary(rest) if rest else None
        facet = clean(row.get("Cuisine Facet")) or clean(row.get("Source Thread"))
        country = clean(row.get("Country"))
        region = ", ".join(p for p in [facet, country] if p)
        wiki = clean(row.get("Wikipedia Url"))
        con.execute(
            """INSERT INTO use_records (
                record_id, dish_id, cuisine, item, item_type, traditionality_class,
                traditionality_score, use_or_dish, use_category, source_thread, country,
                region_or_community, cuisine_facet, macro_region, prep_family, technique_tags,
                preparation_or_function, occasion_or_context, historical_or_cultural_note,
                confidence, lens_confidence_state, evidence_basis, documentation_status,
                recipenlg_match_count, recipedb_match_count, recipe_match_count,
                primary_source_id, primary_source_url, secondary_source_id, secondary_source_url,
                caveat, tags, wikipedia_url, canon_status, qa_disposition
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                record_of[dish_id],
                dish_id,
                clean(row.get("National Cuisine")) or "Unknown",
                clean(row.get("Title")) or dish_id,
                "Dish",
                clean(row.get("Traditionality Class")),
                to_int(row.get("Traditionality Score")),
                clean(row.get("Dish Context")) or clean(row.get("Title")),
                clean(row.get("Prep Family")),
                facet,
                country,
                region or None,
                facet,
                clean(row.get("Macro Region")),
                clean(row.get("Prep Family")),
                clean(row.get("Technique Tags")),
                clean(row.get("Prep Note")),
                clean(row.get("Occasion")),
                None,
                clean(row.get("Corpus Match Confidence")),
                clean(row.get("Lens Confidence State")),
                evidence_basis(clean(row.get("Documentation Status")), nlg, rdb),
                clean(row.get("Documentation Status")),
                nlg,
                rdb,
                to_int(row.get("Recipe Match Count")),
                clean(primary.get("Source Id")) if primary else None,
                clean(primary.get("Url")) if primary else wiki,
                clean(secondary.get("Source Id")) if secondary else None,
                clean(secondary.get("Url")) if secondary else None,
                clean(row.get("Caveat")),
                None,
                wiki,
                (clean(row.get("Canon Status")) or "active").lower(),
                clean(row.get("QA Disposition")),
            ),
        )

    ci_n = 1
    companions_by_dish: dict[str, list[dict]] = defaultdict(list)
    for ing in ingredients:
        dish_id = clean(ing.get("Dish Id"))
        name = clean(ing.get("Ingredient Name"))
        if not dish_id or not name or dish_id not in record_of:
            continue
        optional = (clean(ing.get("Optional")) or "no").lower() in {"yes", "1", "true"}
        role = (clean(ing.get("Role")) or "").lower() or None
        audit_row = spine_by_raw.get(name.lower())
        spine_id = None
        basis = None
        if audit_row and (audit_row.get("Resolution State") or "") == "resolved":
            spine_id = clean(audit_row.get("Final spine_id"))
            basis = clean(audit_row.get("spine_match_basis"))
        cid = f"CI{ci_n:05d}"
        ci_n += 1
        dish = next((r for r in canon if r.get("Dish Id") == dish_id), {})
        primary = pick_primary(sources_by_dish.get(dish_id, []))
        facet = clean(dish.get("Cuisine Facet"))
        country = clean(dish.get("Country"))
        rec = {
            "companion_id": cid,
            "name": name,
            "optional": optional,
            "role": role,
        }
        companions_by_dish[dish_id].append(rec)
        con.execute(
            """INSERT INTO companion_ingredients (
                companion_id, dish_id, record_id, cuisine, ingredient_name, ingredient_category,
                role_in_dish, is_optional, use_priority, traditional_fit, dish_or_technique_family,
                preparation_note, region_or_context, primary_source_id, primary_source_url,
                secondary_source_id, secondary_source_url, spine_id, spine_match_basis
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                cid,
                dish_id,
                record_of[dish_id],
                clean(ing.get("Cuisine")) or clean(dish.get("National Cuisine")),
                name,
                None,
                role,
                1 if optional else 0,
                "Optional" if optional else "Essential",
                "Established",
                clean(dish.get("Prep Family")),
                None,
                ", ".join(p for p in [facet, country] if p) or None,
                clean(primary.get("Source Id")) if primary else None,
                clean(primary.get("Url")) if primary else None,
                None,
                None,
                spine_id,
                basis,
            ),
        )

    pg_n = 1
    for dish_id, comps in companions_by_dish.items():
        dish = next((r for r in canon if r.get("Dish Id") == dish_id), {})
        essential = [c["name"] for c in comps if not c["optional"]]
        optional = [c["name"] for c in comps if c["optional"]]
        mains = [c["name"] for c in comps if c["role"] == "main" and not c["optional"]]
        facet = clean(dish.get("Cuisine Facet")) or ""
        cuisine = clean(dish.get("National Cuisine")) or ""
        title = clean(dish.get("Title")) or dish_id
        around = " or ".join(mains[:3]) if mains else (essential[0] if essential else title)
        extras = optional[:3] or essential[3:6]
        strategy = f"Build {facet} ({cuisine})-style '{title}' around {around}"
        if extras:
            strategy += f", using {'; '.join(extras)} to round out flavor."
        else:
            strategy += "."
        primary = pick_primary(sources_by_dish.get(dish_id, []))
        con.execute(
            """INSERT INTO pair_ingredient_guide (
                pair_id, dish_id, record_id, cuisine, matrix_item, item_type, traditionality_score,
                companion_strategy, anchor_dishes, essential_companions, optional_amplifiers,
                technique_or_form, companion_record_count, essential_or_high_count,
                primary_source_id, primary_source_url, secondary_source_id, secondary_source_url, caveat
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                f"P{pg_n:04d}",
                dish_id,
                record_of[dish_id],
                cuisine,
                title,
                "Dish",
                clean(dish.get("Traditionality Score")),
                strategy,
                title,
                "; ".join(essential),
                "; ".join(optional),
                clean(dish.get("Prep Note")) or clean(dish.get("Prep Family")),
                len(comps),
                len(essential),
                clean(primary.get("Source Id")) if primary else None,
                clean(primary.get("Url")) if primary else None,
                None,
                None,
                clean(dish.get("Caveat")),
            ),
        )
        pg_n += 1

    for row in audit:
        raw = clean(row.get("Ingredient Raw"))
        if not raw:
            continue
        con.execute(
            """INSERT OR REPLACE INTO ingredient_spine_resolution (
                ingredient_raw, working_canonical, ingredient_rows, dish_count, supplied_spine_id,
                final_spine_id, spine_match_basis, resolution_state, source_method, adjudication,
                live_candidate, note
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                raw,
                clean(row.get("Working Canonical")),
                to_int(row.get("Ingredient Rows")),
                to_int(row.get("Dish Count")),
                clean(row.get("Supplied spine_id")),
                clean(row.get("Final spine_id")),
                clean(row.get("spine_match_basis")),
                clean(row.get("Resolution State")),
                clean(row.get("Source Method")),
                clean(row.get("Adjudication")),
                clean(row.get("Live Candidate")),
                clean(row.get("Note")),
            ),
        )

    for row in qa:
        dish_id = clean(row.get("Dish Id"))
        if not dish_id:
            continue
        con.execute(
            """INSERT INTO qa_review (
                dish_id, cuisine, source_thread, title, severity, issue, basis, workbook_evidence,
                recommended_action, exclude_from_depth, disposition, review_status
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                dish_id,
                clean(row.get("Cuisine")),
                clean(row.get("Source Thread")),
                clean(row.get("Title")),
                clean(row.get("Severity")),
                clean(row.get("Issue")),
                clean(row.get("Basis")),
                clean(row.get("Workbook Evidence / Caveat")),
                clean(row.get("Recommended Action")),
                to_int(row.get("Exclude From Depth")) or 0,
                clean(row.get("Disposition")),
                clean(row.get("Review Status")),
            ),
        )

    n_active = sum(1 for r in canon if (clean(r.get("Canon Status")) or "active").lower() == "active")
    n_resolved = sum(1 for r in audit if (r.get("Resolution State") or "") == "resolved")
    con.executemany(
        "INSERT INTO data_dictionary (section, field_term, definition, example) VALUES (?,?,?,?)",
        [
            (
                "Version",
                "demo_9 rebuild",
                "Dish-first Tradition canon from tradition_dishes_demo_9.xlsx. "
                "Active rows feed the lens; hold/excluded keep canon_status. "
                "Pending corpus-match confidence is unassessed, not Low.",
                f"workbook sha256={digest} active={n_active} total={len(canon)}",
            ),
            (
                "Field",
                "lens_confidence_state",
                "assessed_low/medium/high vs unrated_pending_corpus_match. "
                "Pending must not render as Low.",
                None,
            ),
            (
                "Field",
                "companion_ingredients.spine_id",
                "Live-spine entry id only when the audit marked the raw name resolved. "
                "Version/product conflicts are withheld (garlic stays unresolved rather than collapsing onto culin:leek).",
                f"{n_resolved} unique raw names resolved",
            ),
            (
                "Method",
                "Role-aware focus match",
                "Focus matches use role_in_dish in (main, seasoning, aromatic, ingredient). "
                "Fat/garnish qualify a dish as a companion once opened, not as the focus hit.",
                "olive oil is fat; olives are main/seasoning",
            ),
        ],
    )

    # Fill tags from companions after insert
    for dish_id, comps in companions_by_dish.items():
        names = "; ".join(c["name"] for c in comps[:12])
        con.execute("UPDATE use_records SET tags = ? WHERE dish_id = ?", (names, dish_id))

    con.commit()
    con.close()
    tmp.replace(out)
    shutil.copy2(out, ROOT_COPY)
    print(f"Wrote {out}")
    print(f"Copied {ROOT_COPY}")
    print(f"canon={len(canon)} active={n_active} ingredients={len(ingredients)} sources={len(sources)}")
    print(f"resolved unique names={n_resolved} workbook={digest[:16]}…")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", type=Path, default=DEFAULT_XLSX)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args()
    if not args.xlsx.exists():
        raise SystemExit(f"Missing workbook: {args.xlsx}")
    build(args.xlsx, args.out)


if __name__ == "__main__":
    main()
