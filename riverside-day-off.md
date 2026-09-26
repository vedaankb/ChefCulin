# Riverside Health demo — day-off run guide

Use this when you have a quiet hour to try the **Riverside** build (clinical nutrition brainstorm + ICD Health lens). The Nestlé chef demo is still in the same zip; this guide is Riverside only.

Zip: `chefculin-demo-20260921.zip` (or whatever date stamp you were sent).

> **Private:** The zip includes a shared OpenAI key in `.env`. Do not forward the zip or commit `.env`.

---

## What you need

| Need | Check | If missing |
|------|--------|------------|
| macOS 12+ (or Linux) | — | These steps assume Mac Terminal |
| Node.js 18+ | `node -v` | [nodejs.org](https://nodejs.org/) → LTS |
| Python 3.10+ | `python3 --version` | `brew install python3` or [python.org](https://www.python.org/downloads/) |
| Network | — | ICD search calls NLM; Brainstorm calls OpenAI |

You do **not** need Docker for this walkthrough.

---

## One-time setup (~5–10 min)

### 1. Unzip

Download and unzip. You should get a folder named **`ChefCulin`**.

```bash
cd ~/Downloads/ChefCulin   # adjust path if needed
ls
```

You should see `package.json`, `riverside/`, `pipeline/`, `setupinstructios.md`.

### 2. Install JS deps

```bash
npm install
```

### 3. Set up Python + check FooDB

```bash
npm run setup:demo
```

Wait for `Ready. Run: npm run demo`.

---

## Start Riverside

From the **same** `ChefCulin` folder:

```bash
npm run demo:riverside
```

Leave that terminal open. You should see roughly:

```
[api]        Uvicorn running on http://127.0.0.1:8001
[riverside]  Local: http://localhost:5174/
```

| Service | URL |
|---------|-----|
| **Riverside UI** | http://localhost:5174 |
| **API** (shared) | http://localhost:8001 |

Open **http://localhost:5174** in Chrome or Safari.

Stop later with `Ctrl+C` in that terminal.

> Nestlé (chef) demo is still `npm run demo` → http://localhost:5173. Do not run both at once; they share the API port.

---

## What you should see

- Brand: **CulinAI** with a **Riverside** badge
- Default tab: **Brainstorm** (not Compound)
- Tabs in order: Brainstorm → Health → Associate → Compound → Tradition → Co-occurrence → Form

---

## 15-minute walkthrough

### A. Focus ingredient

1. Top → **Focus ingredient** → pick something common (`Garlic`, `Tomato`, `Chicken`).
2. Chefline should say something like “Brainstorming around …”, not “Designing a dish…”.

### B. Health lens (the point of this build)

1. Open **Health**.
2. **ICD-10-CM** search: type `diabetes` (at least 2 characters).
3. Click a result, e.g. **E11.9** (Type 2 diabetes …).
4. Middle column: MeSH disease matches + suggested ingredients (name-match, not a curated crosswalk).
5. Right column: MeSH disease links for the focus ingredient’s compounds.
6. Click a suggested ingredient (e.g. tomato) to add it to the plate.
7. **Open Compound breakdown →** to see Nestlé-style chemistry for the plate.

### C. Brainstorm with conditions in context

1. Back to **Brainstorm**.
2. Click **What do you notice?** (or type your own question).
3. The reply should stay aware of the ICD condition(s) you selected and what’s on the plate.
4. This is brainstorming support, not clinical advice — the system prompt says so on purpose.

### D. Optional: other lenses

- **Associate** — chemistry / tradition / corpus agreement (same idea as Nestlé).
- **Compound / Form** — full chemistry and form diffs when you want depth.

---

## Honest caveat (say this out loud if you demo it)

ICD codes are **name-matched** onto MeSH labels in our compound–disease corpus. It is **not** a UMLS / curated ICD↔MeSH map. Treat matches as leads to pressure-test, then open **Compound** for the chemistry. Scores and MeSH IDs are shown so you can see how the bridge decided.

---

## If something breaks

| Symptom | Fix |
|---------|-----|
| `command not found: npm` | Install Node LTS, reopen Terminal |
| `setup:demo` fails on Python | Install Python 3.10+, retry |
| Port 5174 or 8001 in use | Quit other demos; `Ctrl+C` old terminals; retry |
| ICD search errors / empty | Need network; NLM Clinical Tables must be reachable |
| Brainstorm “LLM unavailable” | Confirm `.env` has `VITE_OPENAI_API_KEY`; restart `npm run demo:riverside` |
| Blank / weird UI | Hard refresh; confirm URL is **5174**, not 5173 |

Cold start after a long break:

```bash
cd ~/Downloads/ChefCulin
npm run demo:riverside
```

(`npm install` / `npm run setup:demo` only needed once unless you delete `node_modules` or `pipeline/.venv`.)

---

## Quick reference

```bash
cd ~/path/to/ChefCulin
npm run demo:riverside          # Riverside → http://localhost:5174
# npm run demo                  # Nestlé chef → http://localhost:5173
```

More Nestlé-oriented founder setup: `setupinstructios.md`.  
Shorter Riverside tech notes: `riverside/README.md`.
