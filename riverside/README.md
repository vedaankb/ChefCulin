# Riverside Health demo

Brainstorm-first CulinAI workspace for Riverside Health. Nestlé chef demo at the repo root is unchanged (`npm run demo` on port 5173).

## Run

From the repo root (same API / artifacts as Nestlé):

```bash
npm run demo:riverside
```

- Web: http://127.0.0.1:5174  
- API: http://127.0.0.1:8001 (shared)

Vite only: `npm run dev:riverside`

## What differs from Nestlé

- Default tab is **Brainstorm**, then **Health**, then Associate / Compound / Tradition / Co-occurrence / Form.
- **Health** lens: ICD-10-CM search (NLM Clinical Tables) + plate disease associations from `compound_disease.jsonl`.
- Compound / Form / etc. stay available for the full Nestlé-style chemistry breakdown.

## ICD bridge (v1 — honest caveat)

ICD codes are **name-matched** onto MeSH disease labels in FoodAtlas-backed `compound_disease.jsonl`. This is **not** a curated ICD↔MeSH / UMLS crosswalk. The UI shows matched MeSH IDs and scores so reviewers can pressure-test before investing in a real crosswalk.

## Layout

```
riverside/           # this Vite app (port 5174)
  src/               # Riverside-only UI
../src/              # shared Nestlé modules via @culin alias
../pipeline/         # shared FastAPI + VCF / disease artifacts
```
