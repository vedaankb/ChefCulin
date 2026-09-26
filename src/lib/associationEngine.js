import { FRAMES } from '../data/domain.js'
import * as defaultApi from '../api.js'
import * as defaultTraditionDb from './traditionDb.js'
import { plateSeed } from './plateSeed.js'
import { resolveIngredient } from './spineResolve.js'
import { matchRecipeNlg } from './matchRecipeNlg.js'
import { getFrame } from './frameRegistry.js'

/**
 * Association Engine (D1 + D2).
 *
 * Asks every association lens the same question — "given what is on the plate,
 * what else?" — and returns one payload showing where the answers converge and
 * where they pull apart.
 *
 * It does not choose. It does not rank one lens above another. It writes
 * nothing: no Palate Memory, no POST /palate. See docs/association-engine.md.
 */

/**
 * Presentation order, NOT precedence. Chemistry is listed before tradition
 * before the corpus because a reader needs a stable order, not because one is
 * a better answer than another. Nothing in this module ranks lens against lens.
 */
export const LENSES = ['compound', 'tradition', 'co-occurrence']

/** `Candidate.lens` id → key in the `byLens` payload. */
export const LENS_KEYS = {
  compound: 'compound',
  tradition: 'tradition',
  'co-occurrence': 'cooccurrence',
}

export const LENS_LABELS = {
  compound: 'Compound',
  tradition: 'Tradition',
  'co-occurrence': 'Corpus',
}

/**
 * Corpus hubs — salt, butter, onion — co-occur with everything, so they carry
 * little information about a specific seed. Filtered for display only.
 */
export const HUBS = new Set([
  'salt',
  'butter',
  'sugar',
  'water',
  'pepper',
  'black pepper',
  'oil',
  'olive oil',
  'vegetable oil',
  'flour',
  'egg',
  'eggs',
  'onion',
  'garlic',
])

const nameOf = (d) => (typeof d === 'string' ? d : d?.name)
const dishNames = (dish) => (dish || []).map(nameOf).filter(Boolean)

/**
 * Compound lens — VCF shared-compound neighbours (member-scoped when resolved).
 */
export async function collectCompound(dish, focusIngredient = null, options = {}) {
  const apiClient = options.api || defaultApi
  const names = dishNames(dish)
  const have = new Set(names)
  const haveLower = new Set([...names].map((n) => n.toLowerCase()))
  const display = plateSeed(dish, focusIngredient)
  if (!display) return []

  try {
    const r = resolveIngredient(display)
    let res
    if (r.state === 'resolved' && r.member_id != null && apiClient.vcfPairs) {
      res = await apiClient.vcfPairs({
        productId: r.member_id,
        spineId: r.spine_id,
        n: options.limit || 24,
      })
      return (res.results || [])
        .filter((row) => {
          const label = String(row.match_raw_name || '')
            .replace(/\s*\([^)]*\)/g, '')
            .trim()
          return label && !haveLower.has(label.toLowerCase()) && !have.has(label)
        })
        .map((row) => {
          const label = String(row.match_raw_name || '')
            .replace(/\s*\([A-Z][a-z]+ (?:[a-z]+|species)[^)]*\)/g, '')
            .trim()
            .toLowerCase()
            .replace(/\b\w/g, (c) => c.toUpperCase())
          return {
            name: label,
            lens: 'compound',
            reason: `${row.shared_count || 0} shared compounds`,
            meta: {
              shared_count: row.shared_count,
              mixed_profile_source: row.mixed_profile_source,
              network: row.match_raw_name,
              engaged: false,
              hits: 0,
            },
          }
        })
    }

    res = await apiClient.compound(display, options.limit || 24)
    return (res.results || [])
      .filter(
        (row) =>
          !have.has(row.display) &&
          !have.has(row.ingredient) &&
          !haveLower.has(String(row.display || '').toLowerCase()) &&
          !haveLower.has(String(row.ingredient || '').toLowerCase())
      )
      .map((row) => ({
        name: row.display || row.ingredient || row.label || row.match_raw_name,
        lens: 'compound',
        reason: row.shared_count
          ? `${row.shared_count} shared compounds`
          : `shared compounds · ${row.weight}`,
        meta: {
          weight: row.weight,
          confidence: row.confidence,
          shared_count: row.shared_count,
          network: row.ingredient || row.match_raw_name,
          engaged: false,
          hits: 0,
        },
      }))
  } catch {
    return []
  }
}

/**
 * Tradition lens — documented companions from the Tradition SQLite DB.
 * Injectable `traditionDb` for tests.
 */
export async function collectTradition(dish, cuisineScope, options = {}) {
  const {
    traditionDb = defaultTraditionDb,
    focusIngredient = null,
  } = options
  const names = dishNames(dish)
  const display = plateSeed(dish, focusIngredient)
  if (!display) return { candidates: [], threads: [] }
  const have = new Set(names)
  const seed = display

  const { candidates, threads } = await traditionDb.getTraditionAssociation(seed, {
    exclude: names,
    limit: 16,
    cuisineScope,
  })

  const engagedThreads = threads.map((t) => {
    const hits = candidates.filter((c) => have.has(c.name)).map((c) => c.name)
    return { ...t, engaged: hits.length > 0, hits }
  })

  candidates.forEach((c) => {
    const threadHits = engagedThreads.filter((t) => t.thread === c.meta?.thread)
    c.meta = {
      ...c.meta,
      engaged: threadHits.some((t) => t.engaged),
      hits: threadHits.reduce((n, t) => n + t.hits.length, 0),
    }
  })

  return {
    candidates: candidates.sort((a, b) => b.meta.hits - a.meta.hits),
    threads: engagedThreads,
  }
}

/** @deprecated static threads removed — returns [] unless threads passed in. */
export function traditionThreads(_dish, _cuisineScope) {
  return []
}

/**
 * Co-occurrence lens — the live corpus, via the same precomputed artifact API
 * the Co-occurrence pane uses. No CSV is scanned here.
 *
 * `api` is injectable so the merge can be tested without a running backend.
 */
export async function collectCooccur(seed, options = {}) {
  const { api = defaultApi, n = 24, exclude = [], limit = 16 } = options
  const res = await api.cooccur(seed, n)
  const canonical = res?.canonical || seed
  const skip = new Set(exclude)
  const rows = (res?.results || [])
    .filter((r) => !skip.has(r.ingredient) && !HUBS.has(r.ingredient))
    .slice(0, limit)
  return {
    canonical,
    candidates: rows.map((r) => ({
      name: r.ingredient,
      lens: 'co-occurrence',
      reason: `Co-occurs with ${canonical} across the corpus`,
      meta: { confidence: r.confidence, freq: r.freq },
    })),
  }
}

/**
 * Merge the three answers by ingredient name.
 *
 * `agreement: 'multi'` means two or more lenses named it independently — that is
 * the only cross-lens claim this engine makes, and it is a count, not a verdict.
 * Sorting is by that count descending; ties keep LENSES order, which is
 * presentation order and nothing more.
 *
 * `primaryLens` is the first lens in LENSES order that named the candidate. It
 * is what a chip uses for colour and what `addIngredient` records as provenance,
 * so a dish item's lens is always one of the three real lenses — the merged view
 * never invents a fourth source. (See docs/association-engine.md.)
 */
export function mergeCandidates(byLens) {
  const map = new Map()
  LENSES.forEach((lens) => {
    const list = byLens[LENS_KEYS[lens]] || []
    list.forEach((c) => {
      const cur = map.get(c.name)
      if (cur) {
        if (!cur.lenses.includes(lens)) cur.lenses.push(lens)
        cur.reasons.push(c.reason)
        cur.meta = { ...c.meta, ...cur.meta }
        cur.engaged = cur.engaged || Boolean(c.meta?.engaged)
        return
      }
      map.set(c.name, {
        name: c.name,
        lenses: [lens],
        reasons: [c.reason],
        agreement: 'single',
        primaryLens: lens,
        engaged: Boolean(c.meta?.engaged),
        meta: { ...c.meta },
      })
    })
  })

  const combined = [...map.values()]
  combined.forEach((c) => {
    c.agreement = c.lenses.length > 1 ? 'multi' : 'single'
  })
  /* Stable sort: convergence first, then whether the dish already engages that
     thread. Everything below that keeps the order the lenses produced. */
  return combined.sort(
    (a, b) => b.lenses.length - a.lenses.length || Number(b.engaged) - Number(a.engaged)
  )
}

const namesOf = (list) => list.map((c) => c.name)

/**
 * D2 — resolution approach: **flag, don't suppress.**
 *
 * The same rule cuisine scope already follows. Nothing is dropped because
 * another lens disagrees, and no lens is declared the winner. Where the lenses
 * genuinely describe the plate differently, that difference is surfaced as a
 * thing to notice — two valid frames, not an error to fix.
 */
export function findDisagreements({
  byLens,
  threads = [],
  cuisineScope = null,
  form = null,
  seed = 'chicken',
  cooccurStatus = 'ok',
} = {}) {
  const out = []
  const compound = byLens.compound || []
  const tradition = byLens.tradition || []
  const cooccurrence = byLens.cooccurrence || []
  const corpusNames = new Set(namesOf(cooccurrence))

  const divergence = (list, lens, label) => {
    if (cooccurStatus !== 'ok' || !cooccurrence.length || !list.length) return
    if (namesOf(list).some((n) => corpusNames.has(n))) return
    out.push({
      theme: `corpus vs ${label}`,
      lenses: ['co-occurrence', lens],
      summary: `Nothing the corpus puts near ${seed} appears in ${label} for this set. Neither is wrong — ${label} describes why something works, the corpus describes what cooks actually wrote down. A gap here usually means the dish is off the well-trodden path, which may be the point.`,
      candidates: [
        { lens: 'co-occurrence', names: namesOf(cooccurrence).slice(0, 8) },
        { lens, names: namesOf(list).slice(0, 8) },
      ],
    })
  }
  divergence(compound, 'compound', 'chemistry')
  divergence(tradition, 'tradition', 'tradition')

  if (cuisineScope) {
    const inScope = threads.filter((t) => t.inScope)
    const outScope = threads.filter((t) => t.inScope === false)
    if (outScope.length) {
      out.push({
        theme: 'scope vs thread',
        lenses: ['tradition'],
        summary: `Scope is locked to ${cuisineScope.label}. ${outScope.length} documented thread${outScope.length > 1 ? 's fall' : ' falls'} outside it and ${outScope.length > 1 ? 'are' : 'is'} still listed — a scope flags, it never filters.`,
        candidates: [
          {
            lens: 'tradition',
            names: inScope.map((t) => t.title).slice(0, 8),
            note: 'in scope',
          },
          {
            lens: 'tradition',
            names: outScope.map((t) => t.title).slice(0, 8),
            note: 'outside scope',
          },
        ],
      })
    }
  }

  /* Form vs thread disagreements need static thread metadata — skipped for DB threads. */

  if (cooccurStatus === 'error') {
    out.push({
      theme: 'corpus unavailable',
      lenses: ['co-occurrence'],
      summary:
        'The corpus lens did not answer, so this merge is chemistry and tradition only. Convergence below is between two lenses, not three — start the API (cd pipeline && python -m culin_etl.serve) to hear the third.',
      candidates: [],
    })
  }

  return out
}

/**
 * D1 — orchestration. Ask every lens, merge, and report the disagreements.
 *
 * Never throws for a corpus outage: the co-occurrence lens degrades to empty and
 * says so in `disagreements`, because two lenses answering is still useful.
 */
export async function associate(state = {}, deps = {}) {
  const { dish = [], form = null, cuisineScope = null, focusIngredient = null } = state
  const names = dishNames(dish)
  const display = plateSeed(dish, focusIngredient)

  if (!display) {
    return {
      seed: null,
      dish: names,
      form: form ? { name: form.name, overlay: getFrame(form.name)?.overlay || null } : null,
      cuisineScope,
      threads: [],
      byLens: { compound: [], tradition: [], cooccurrence: [] },
      combined: [],
      disagreements: [],
      cooccur: {
        status: 'idle',
        seed: null,
        canonical: null,
        error: null,
        matchSource: null,
      },
    }
  }

  const matched = await matchRecipeNlg(display)
  const recipeSeed = matched.canonical
  const matchSource = matched.source

  const traditionRes = await collectTradition(dish, cuisineScope, {
    traditionDb: deps.traditionDb,
    focusIngredient,
  })
  const threads = traditionRes.threads

  const byLens = {
    compound: await collectCompound(dish, focusIngredient, { api: deps.api || defaultApi }),
    tradition: traditionRes.candidates,
    cooccurrence: [],
  }

  let cooccur = { status: 'ok', seed: recipeSeed, canonical: recipeSeed, error: null, matchSource }
  try {
    const res = await collectCooccur(recipeSeed, { api: deps.api, exclude: names })
    byLens.cooccurrence = res.candidates
    cooccur = { ...cooccur, canonical: res.canonical }
  } catch (err) {
    cooccur = {
      status: 'error',
      seed: recipeSeed,
      canonical: recipeSeed,
      error: err?.message || String(err),
      matchSource,
    }
  }

  const combined = mergeCandidates(byLens)
  const disagreements = findDisagreements({
    byLens,
    threads,
    cuisineScope,
    form,
    seed: cooccur.canonical,
    cooccurStatus: cooccur.status,
  })

  return {
    seed: cooccur.canonical,
    dish: names,
    form: form ? { name: form.name, overlay: getFrame(form.name)?.overlay || null } : null,
    cuisineScope,
    threads: threads.map(({ title, thread, region, inScope, engaged, hits }) => ({
      title,
      thread,
      region,
      inScope,
      engaged,
      hits,
    })),
    byLens,
    combined,
    disagreements,
    cooccur,
  }
}
