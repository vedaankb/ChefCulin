"""Unit tests for ICD name→MeSH health bridge (no network)."""

from culin_etl.health_serve import (
    diseases_for_ingredient,
    ingredients_for_condition,
    load_health_tables,
    match_diseases_by_condition,
    score_disease_name,
    tokenize_condition,
)


def test_tokenize_condition_strips_stopwords():
    tokens = tokenize_condition("Type 2 diabetes mellitus, unspecified")
    assert "diabetes" in tokens
    assert "type" not in tokens
    assert "mellitus" not in tokens
    assert "unspecified" not in tokens


def test_score_disease_name_prefers_overlap():
    tokens = tokenize_condition("Type 2 diabetes mellitus")
    assert score_disease_name("diabetes mellitus, type 2", tokens) > 0.5
    assert score_disease_name("arrhythmias, cardiac", tokens) == 0.0


def test_match_and_ingredients_for_diabetes():
    health = load_health_tables()
    assert health["counts"]["compound_disease"] > 0
    matched = match_diseases_by_condition(health, "Type 2 diabetes mellitus")
    assert matched, "expected MeSH diabetes hits for ICD-style name"
    assert any("diabet" in (m.get("disease_name") or "").lower() for m in matched)

    payload = ingredients_for_condition(
        health, name="Type 2 diabetes mellitus", code="E11.9", n=10
    )
    assert payload["bridge"] == "icd_name_to_mesh"
    assert payload["matched_diseases"]
    assert payload["count"] > 0
    assert payload["results"][0]["ingredient"]


def test_diseases_for_known_ingredient():
    health = load_health_tables()
    # Garlic is in the culinary spine / profiles
    payload = diseases_for_ingredient(health, "garlic", n=20)
    assert payload["matched_profiles"]
    # May or may not have disease rows depending on compound overlap; just ensure shape
    assert "results" in payload
    assert payload["bridge"] == "mesh_compound_disease"
