#!/usr/bin/env python3
"""Assess Pending Tradition corpus-match confidence.

The demo_9 canon leaves 186 dishes at Corpus Match Confidence=Pending /
lens_confidence_state=unrated_pending_corpus_match until a dish-title matcher
runs against RecipeNLG/RecipeDB.

This repo vendors Flavor Network recipe.csv (cuisine + ingredient bags), not
RecipeNLG dish titles. Without a title corpus there is nothing honest to write
back — mapping Pending→Low would violate §2.6.

When a RecipeNLG title table is available, point --titles at a CSV with a
`title` column and this script will fuzzy-match active Pending dishes and print
a patch report. It does not mutate the sqlite DB until --apply is passed, and
even then it only writes assessed_* states for clear title hits.
"""
from __future__ import annotations

import argparse
import csv
import re
import sqlite3
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB = ROOT / "src" / "data" / "traditional_culinary_uses_database_v2.db"


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def load_titles(path: Path) -> list[str]:
    with path.open(encoding="utf-8", newline="") as f:
        sample = f.read(4096)
        f.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample)
        except csv.Error:
            dialect = csv.excel
        reader = csv.DictReader(f, dialect=dialect)
        if not reader.fieldnames:
            return []
        key = next((k for k in reader.fieldnames if k and "title" in k.lower()), None)
        if not key:
            key = reader.fieldnames[0]
        return [row[key] for row in reader if row.get(key)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--titles", type=Path, help="CSV with a title column (RecipeNLG export)")
    ap.add_argument("--apply", action="store_true", help="Write assessed confidence back to the DB")
    args = ap.parse_args()

    con = sqlite3.connect(args.db)
    pending = con.execute(
        """
        SELECT record_id, item, confidence, lens_confidence_state
        FROM use_records
        WHERE COALESCE(canon_status,'active')='active'
          AND (
            LOWER(COALESCE(confidence,''))='pending'
            OR LOWER(COALESCE(lens_confidence_state,'')) LIKE '%pending%'
          )
        ORDER BY item
        """
    ).fetchall()
    print(f"Pending active dishes: {len(pending)}")

    if not args.titles:
        print(
            "No --titles CSV provided. Flavor Network recipe.csv has no dish titles, "
            "so Pending cannot be assessed from the vendored corpus.\n"
            "Leave Pending as unassessed. Do not map it to Low."
        )
        return

    titles = load_titles(args.titles)
    title_norms = {norm(t): t for t in titles if t}
    print(f"Title corpus: {len(title_norms)}")

    hits = []
    for record_id, item, conf, state in pending:
        n = norm(item)
        if n in title_norms:
            hits.append((record_id, item, title_norms[n]))

    print(f"Exact normalized title hits: {len(hits)}")
    for record_id, item, matched in hits[:20]:
        print(f"  {record_id}  {item!r}  ←  {matched!r}")

    if not args.apply:
        print("Dry run only. Re-run with --apply to write High confidence for exact hits.")
        return

    for record_id, item, _matched in hits:
        con.execute(
            """
            UPDATE use_records
            SET confidence='High',
                lens_confidence_state='assessed_high',
                recipenlg_match_count=CASE
                  WHEN COALESCE(recipenlg_match_count,0) < 1 THEN 1
                  ELSE recipenlg_match_count
                END,
                documentation_status='corpus_observed',
                evidence_basis='Recipe corpus title match (RecipeNLG/RecipeDB)'
            WHERE record_id=?
            """,
            (record_id,),
        )
    con.commit()
    print(f"Applied {len(hits)} assessments.")


if __name__ == "__main__":
    main()
