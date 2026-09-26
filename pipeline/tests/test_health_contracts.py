"""
Health lens contracts: deterministic fixture logic, corpus invariants, HTTP shape.

These do not call NLM. ICD search is stubbed at the httpx boundary.
"""

from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from culin_etl.api import create_app
from culin_etl.health_serve import (
    diseases_for_ingredient,
    ingredients_for_condition,
    load_health_tables,
    match_diseases_by_condition,
    resolve_profiles,
    score_disease_name,
    search_icd10cm,
    tokenize_condition,
)
from culin_etl.vcf_serve import empty_vcf_tables


def _fixture_health():
    """Tiny graph: two MeSH diseases, two compounds, three culinary products."""
    return {
        "diseases": [
            {
                "disease_id": "e-dm2",
                "disease_name": "diabetes mellitus, type 2",
                "disease_external_id": "MESH:D003924",
            },
            {
                "disease_id": "e-hf",
                "disease_name": "heart failure",
                "disease_external_id": "MESH:D006333",
            },
        ],
        "by_compound": {
            "c-dm": [
                {
                    "compound_id": "c-dm",
                    "disease_id": "e-dm2",
                    "disease_name": "diabetes mellitus, type 2",
                    "disease_external_id": "MESH:D003924",
                    "direction": "negative",
                    "n_attestations": 4,
                    "evidence_source": "ctd",
                }
            ],
            "c-hf": [
                {
                    "compound_id": "c-hf",
                    "disease_id": "e-hf",
                    "disease_name": "heart failure",
                    "disease_external_id": "MESH:D006333",
                    "direction": "positive",
                    "n_attestations": 2,
                    "evidence_source": "ctd",
                }
            ],
        },
        "compound_name": {"c-dm": "umbelliferone", "c-hf": "oleic acid"},
        "profiles_by_name": {
            "tomato": [
                {
                    "vcf_product_id": 1,
                    "raw_name": "TOMATO",
                    "base_ingredient": "tomato",
                    "spine_id": "culin:tomato",
                    "n_compounds": 1,
                    "compound_ids": ["c-dm"],
                }
            ],
            "garlic": [
                {
                    "vcf_product_id": 2,
                    "raw_name": "GARLIC",
                    "base_ingredient": "garlic",
                    "spine_id": "culin:garlic",
                    "n_compounds": 1,
                    "compound_ids": ["c-hf"],
                }
            ],
        },
        "products_by_compound": {
            "c-dm": [
                {
                    "vcf_product_id": 1,
                    "raw_name": "TOMATO",
                    "base_ingredient": "tomato",
                    "spine_id": "culin:tomato",
                    "product_group": "Vegetables",
                },
                {
                    "vcf_product_id": 3,
                    "raw_name": "ONION",
                    "base_ingredient": "onion",
                    "spine_id": "culin:onion",
                    "product_group": "Vegetables",
                },
            ],
            "c-hf": [
                {
                    "vcf_product_id": 2,
                    "raw_name": "GARLIC",
                    "base_ingredient": "garlic",
                    "spine_id": "culin:garlic",
                    "product_group": "Vegetables",
                }
            ],
        },
    }


def _client(health=None):
    artifacts = {"cooccur": [], "ingredient_technique": [], "meta": {}, "_dir": "memory"}
    compound = {"neighbors": [], "meta": {}, "_dir": "memory"}
    return TestClient(
        create_app(
            artifacts=artifacts,
            compound=compound,
            vcf=empty_vcf_tables(),
            health_tables=health if health is not None else _fixture_health(),
        )
    )


def test_score_ignores_substring_inside_another_word():
    tokens = tokenize_condition("art")
    assert tokens == ["art"]
    assert score_disease_name("heart failure", tokens) == 0.0


def test_profile_match_is_whole_word_and_compounds_are_not_double_counted():
    health = _fixture_health()
    assert resolve_profiles(health, "gar") == []
    assert [p["vcf_product_id"] for p in resolve_profiles(health, "garlic powder")] == [2]

    health["products_by_compound"]["c-dm"].append(
        {
            "vcf_product_id": 9,
            "raw_name": "TOMATO PASTE",
            "base_ingredient": "tomato",
            "spine_id": "culin:tomato",
            "product_group": "Vegetables",
        }
    )
    payload = ingredients_for_condition(health, name="Type 2 diabetes mellitus")
    tomato = next(r for r in payload["results"] if r["ingredient"] == "tomato")
    assert tomato["n_compounds"] == 1
    assert tomato["n_attestations"] == 4


def test_stopword_only_condition_matches_nothing():
    health = _fixture_health()
    assert tokenize_condition("type unspecified disease syndrome") == []
    assert match_diseases_by_condition(health, "type unspecified disease syndrome") == []
    payload = ingredients_for_condition(health, name="type unspecified disease")
    assert payload["matched_diseases"] == []
    assert payload["results"] == []
    assert payload["bridge"] == "icd_name_to_mesh"


def test_condition_does_not_cross_contaminate_unrelated_mesh():
    health = _fixture_health()
    diabetes = match_diseases_by_condition(health, "Type 2 diabetes mellitus")
    assert [d["disease_id"] for d in diabetes] == ["e-dm2"]
    heart = match_diseases_by_condition(health, "Congestive heart failure, unspecified")
    assert [d["disease_id"] for d in heart] == ["e-hf"]
    assert 0 < diabetes[0]["match_score"] <= 1
    assert 0 < heart[0]["match_score"] <= 1


def test_exclude_drops_plate_ingredients_case_insensitively():
    health = _fixture_health()
    kept = ingredients_for_condition(
        health, name="Type 2 diabetes mellitus", code="E11.9", exclude={"Tomato"}
    )
    names = [r["ingredient"].lower() for r in kept["results"]]
    assert "tomato" not in names
    assert "onion" in names
    # Code is echoed; disease evidence stays MeSH, never the ICD code.
    assert kept["code"] == "E11.9"
    assert all(d["disease_external_id"].startswith("MESH:") for d in kept["matched_diseases"])


def test_ingredient_diseases_rank_by_attestations_and_cap():
    health = _fixture_health()
    # Attach a second, weaker disease to the same tomato compound.
    health["by_compound"]["c-dm"].append(
        {
            "compound_id": "c-dm",
            "disease_id": "e-hf",
            "disease_name": "heart failure",
            "disease_external_id": "MESH:D006333",
            "direction": "positive",
            "n_attestations": 1,
            "evidence_source": "ctd",
        }
    )
    payload = diseases_for_ingredient(health, "tomato", n=1)
    assert payload["count"] == 1
    assert payload["results"][0]["disease_id"] == "e-dm2"
    assert payload["results"][0]["direction_counts"]["negative"] == 1
    assert payload["results"][0]["compounds"][0]["compound_name"] == "umbelliferone"
    assert payload["bridge"] == "mesh_compound_disease"
    assert "not ICD" in payload["note"]


def test_unknown_ingredient_is_empty_not_an_error():
    payload = diseases_for_ingredient(_fixture_health(), "unicorn dust")
    assert payload["matched_profiles"] == []
    assert payload["results"] == []
    assert payload["count"] == 0


def test_score_is_zero_without_token_overlap():
    tokens = tokenize_condition("Type 2 diabetes mellitus")
    assert score_disease_name("heart failure", tokens) == 0.0
    assert score_disease_name("", tokens) == 0.0
    assert score_disease_name("diabetes mellitus, type 2", []) == 0.0


def test_match_order_is_stable():
    health = _fixture_health()
    a = match_diseases_by_condition(health, "diabetes mellitus")
    b = match_diseases_by_condition(health, "diabetes mellitus")
    assert a == b
    scores = [d["match_score"] for d in a]
    assert scores == sorted(scores, reverse=True)


def test_http_health_endpoints_contract():
    client = _client()
    missing = client.get("/health/by-condition")
    assert missing.status_code == 422

    too_small = client.get("/health/diseases", params={"ingredient": "tomato", "n": 0})
    assert too_small.status_code == 422

    diseases = client.get("/health/diseases", params={"ingredient": "GARLIC", "n": 10})
    assert diseases.status_code == 200
    body = diseases.json()
    assert body["bridge"] == "mesh_compound_disease"
    assert body["matched_profiles"][0]["base_ingredient"] == "garlic"
    assert body["results"][0]["disease_external_id"] == "MESH:D006333"

    cond = client.get(
        "/health/by-condition",
        params={"name": "Type 2 diabetes mellitus", "code": "E11.9", "exclude": "tomato", "n": 10},
    )
    assert cond.status_code == 200
    data = cond.json()
    assert data["bridge"] == "icd_name_to_mesh"
    assert "crosswalk" in data["note"]
    assert all(r["ingredient"].lower() != "tomato" for r in data["results"])
    assert any(r["ingredient"].lower() == "onion" for r in data["results"])

    status = client.get("/health")
    assert status.status_code == 200
    assert status.json()["ok"] is True


def test_icd_search_parses_nlm_tuple_and_rejects_upstream_failure():
    client = _client()
    nlm = [2, ["E11.9", "E11"], None, [["E11.9", "Type 2 diabetes mellitus without complications"], ["E11", "Type 2 diabetes mellitus"]], ["ICD10CM", "ICD10CM"]]

    class _Resp:
        def raise_for_status(self):
            return None

        def json(self):
            return nlm

    with patch("httpx.Client") as client_cls:
        client_cls.return_value.__enter__.return_value.get.return_value = _Resp()
        res = client.get("/icd/search", params={"q": "diabetes", "n": 5})
    assert res.status_code == 200
    payload = res.json()
    assert payload["query"] == "diabetes"
    assert payload["count"] == 2
    assert payload["results"][0] == {
        "code": "E11.9",
        "name": "Type 2 diabetes mellitus without complications",
    }

    class _Boom(httpx.HTTPError):
        pass

    # search_icd10cm imports httpx inside the function, so patch the httpx client it constructs.
    with patch("httpx.Client") as inner:
        inner.return_value.__enter__.return_value.get.side_effect = httpx.ConnectError("down")
        failed = client.get("/icd/search", params={"q": "diabetes"})
    assert failed.status_code == 502

    assert search_icd10cm("   ") == []


def test_corpus_diabetes_bridge_stays_mesh_and_ranked():
    """Real artifact: name-match must hit diabetes MeSH rows and stay ordered."""
    health = load_health_tables()
    matched = match_diseases_by_condition(health, "Type 2 diabetes mellitus", n=12)
    assert matched
    assert all(str(d.get("disease_external_id") or "").startswith("MESH:") for d in matched)
    scores = [d["match_score"] for d in matched]
    assert scores == sorted(scores, reverse=True)
    names = " ".join((d.get("disease_name") or "").lower() for d in matched[:5])
    assert "diabet" in names
    # A cardiac query must not be dominated by diabetes labels.
    heart = match_diseases_by_condition(health, "heart failure", n=5)
    assert heart
    assert "heart" in (heart[0].get("disease_name") or "").lower()
    assert "diabet" not in (heart[0].get("disease_name") or "").lower()
