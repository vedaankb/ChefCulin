#!/usr/bin/env bash
# Bundle the full demo for founders (includes FooDB vendor data).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CONTENT="pipeline/vendor/foodb/foodb_2020_04_07_csv/Content.csv"
if [[ ! -f "$CONTENT" ]]; then
  echo "Missing $CONTENT"
  echo "Run: npm run fetch:foodb"
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "Missing .env — create it with VITE_OPENAI_API_KEY before packing."
  exit 1
fi

STAMP="$(date +%Y%m%d)"
NAME="chefculin-demo-${STAMP}"
OUT_DIR="dist"
ARCHIVE="${OUT_DIR}/${NAME}.zip"
PARENT="$(dirname "$ROOT")"
BASE="$(basename "$ROOT")"

mkdir -p "$OUT_DIR"

echo "== Packing founder demo zip =="
echo "Includes FooDB data (~1.8 GB uncompressed) and .env (OpenAI key)."
echo "Compression may take 5–15 minutes."

# Refuse to ship if Form's local artifact is missing (gitignored but required to demo).
if [[ ! -f "$ROOT/pipeline/artifacts/vcf/form_diffs.jsonl" ]]; then
  echo "Missing pipeline/artifacts/vcf/form_diffs.jsonl — Form lens will be empty."
  echo "Restore from the founder VCF dump (.gz → form_diffs.jsonl) before packing."
  exit 1
fi

cd "$PARENT"
zip -r -q "$ROOT/$ARCHIVE" "$BASE" \
  -x "${BASE}/node_modules/*" \
  -x "${BASE}/node_modules/**" \
  -x "${BASE}/pipeline/.venv/*" \
  -x "${BASE}/pipeline/.venv/**" \
  -x "${BASE}/.git/*" \
  -x "${BASE}/.git/**" \
  -x "${BASE}/dist/*" \
  -x "${BASE}/dist/**" \
  -x "${BASE}/ChefCulin*.zip" \
  -x "${BASE}/*.zip" \
  -x "${BASE}/tradition_dishes_demo_9.xlsx" \
  -x "${BASE}/**/.DS_Store" \
  -x "${BASE}/.DS_Store"

SIZE="$(du -h "$ROOT/$ARCHIVE" | cut -f1)"
echo ""
echo "Created: $ARCHIVE ($SIZE)"
echo ""
echo "Too large to attach to email — upload to Google Drive / Dropbox / WeTransfer"
echo "and send founders the link + setupinstructios.md instructions."
