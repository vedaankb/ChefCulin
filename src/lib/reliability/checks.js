import { INGREDIENT_LIST } from '../../data/ingredients.js'
import { associate } from '../associationEngine.js'
import { fetchFormCards } from '../formSuggestions.js'
import { heuristicRecipeNlg } from '../matchRecipeNlg.js'
import {
  bestTraditionMatches,
  getDishDetail,
  getTraditionAssociation,
  listRegionPicks,
} from '../traditionDb.js'
import {
  COMPOUND_ANCHORS,
  COOCCUR_ANCHORS,
  MIN_HEALTH,
  RECIPE_NLG_HEURISTIC,
  TRADITION_ANCHORS,
  VCF_COMPOUND_ANCHORS,
} from './anchors.js'

function sortedDesc(rows, key) {
  for (let i = 1; i < rows.length; i += 1) {
    if ((rows[i - 1][key] ?? 0) < (rows[i][key] ?? 0)) return false
  }
  return true
}

function namesLower(rows, field) {
  return rows.map((r) => String(r[field] || '').toLowerCase())
}

export async function checkHealth(api) {
  const h = await api.health()
  const fails = []
  if (!h.ok) fails.push('health.ok is false')
  if ((h.cooccur_edges ?? 0) < MIN_HEALTH.cooccur_edges) {
    fails.push(`cooccur_edges ${h.cooccur_edges} < ${MIN_HEALTH.cooccur_edges}`)
  }
  if ((h.compound_edges ?? 0) < MIN_HEALTH.compound_edges) {
    fails.push(`compound_edges ${h.compound_edges} < ${MIN_HEALTH.compound_edges}`)
  }
  if ((h.technique_edges ?? 0) < MIN_HEALTH.technique_edges) {
    fails.push(`technique_edges ${h.technique_edges} < ${MIN_HEALTH.technique_edges}`)
  }
  return {
    id: 'api.health',
    label: 'Artifact API health thresholds',
    ok: fails.length === 0,
    detail: fails.join('; ') || `cooccur=${h.cooccur_edges}, compound=${h.compound_edges}`,
  }
}

export async function checkCompoundAnchors(api) {
  const results = []
  for (const anchor of COMPOUND_ANCHORS) {
    const res = await api.compound(anchor.focus, 16)
    // Skip flavor-network anchors when the API is on the VCF pairs path.
    if (res.source === 'pairs') {
      results.push({
        id: `compound.flavor_network.${anchor.token}`,
        label: `Flavor-network anchors skipped (compound_source=pairs)`,
        ok: true,
        detail: 'CULIN_COMPOUND_SOURCE=pairs — see VCF compound anchors',
      })
      continue
    }
    const rows = res.results || []
    const tokens = namesLower(rows, 'ingredient')
    const displays = namesLower(rows, 'display')
    const fails = []
    if (res.canonical !== anchor.token) {
      fails.push(`canonical ${res.canonical} !== ${anchor.token}`)
    }
    if (rows.length < anchor.minNeighbors) {
      fails.push(`only ${rows.length} neighbors (need ${anchor.minNeighbors})`)
    }
    for (const need of anchor.mustInclude) {
      if (!tokens.includes(need) && !displays.some((d) => d.includes(need.replace(/_/g, ' ')))) {
        fails.push(`missing ${need}`)
      }
    }
    if (anchor.topNeighbor && tokens[0] !== anchor.topNeighbor) {
      fails.push(`top is ${tokens[0]}, expected ${anchor.topNeighbor}`)
    }
    for (const bad of anchor.forbidSameBase) {
      if (tokens.includes(bad)) fails.push(`forbidden same-base ${bad}`)
    }
    if (!sortedDesc(rows, 'weight')) fails.push('not sorted by weight desc')
    results.push({
      id: `compound.${anchor.token}`,
      label: `Compound neighbors for ${anchor.focus}`,
      ok: fails.length === 0,
      detail: fails.join('; ') || `top=${rows[0]?.display || rows[0]?.ingredient}`,
    })
  }
  return results
}

export async function checkVcfCompoundAnchors(api) {
  const results = []
  for (const anchor of VCF_COMPOUND_ANCHORS) {
    const res = await api.vcfPairs({
      spineId: anchor.spineId,
      productId: anchor.productId,
      n: 16,
    })
    const rows = res.results || []
    const names = rows.map((r) => String(r.match_raw_name || '').toLowerCase())
    const fails = []
    if (rows.length < anchor.minNeighbors) {
      fails.push(`only ${rows.length} neighbors (need ${anchor.minNeighbors})`)
    }
    if (anchor.mustIncludeAny?.length) {
      const hit = anchor.mustIncludeAny.some((tok) => names.some((n) => n.includes(tok)))
      if (!hit) fails.push(`missing any of ${anchor.mustIncludeAny.join('/')}`)
    }
    for (const bad of anchor.forbidTokens || []) {
      if (names.some((n) => n.includes(bad))) fails.push(`forbidden ${bad}`)
    }
    if (res.scope && res.scope !== 'product' && anchor.productId != null) {
      fails.push(`expected product scope, got ${res.scope}`)
    }
    results.push({
      id: `vcf.compound.${anchor.focus.toLowerCase()}`,
      label: `VCF pairs for ${anchor.focus}`,
      ok: fails.length === 0,
      detail: fails.join('; ') || `top=${rows[0]?.match_raw_name}`,
    })
  }
  return results
}

export async function checkCooccurAnchors(api) {
  const results = []
  for (const anchor of COOCCUR_ANCHORS) {
    const res = await api.cooccur(anchor.seed, 16)
    const rows = res.results || []
    const names = namesLower(rows, 'ingredient')
    const fails = []
    if (rows.length < anchor.minNeighbors) {
      fails.push(`only ${rows.length} neighbors (need ${anchor.minNeighbors})`)
    }
    for (const need of anchor.mustInclude) {
      if (!names.includes(need)) fails.push(`missing ${need}`)
    }
    if (!sortedDesc(rows, 'confidence')) fails.push('not sorted by confidence desc')
    results.push({
      id: `cooccur.${anchor.seed}`,
      label: `Corpus NPMI neighbors for ${anchor.seed}`,
      ok: fails.length === 0,
      detail: fails.join('; ') || `top=${rows[0]?.ingredient}`,
    })
  }
  return results
}

export async function checkTraditionAnchors() {
  const results = []
  for (const anchor of TRADITION_ANCHORS) {
    const key = `${anchor.focus}${anchor.cuisine ? `.${anchor.cuisine}` : ''}`
    const rows = await bestTraditionMatches({
      focus: anchor.focus,
      names: [],
      cuisine: anchor.cuisine,
      limit: 5,
    })
    const fails = []
    if (rows.length < anchor.minMatches) {
      fails.push(`only ${rows.length} matches (need ${anchor.minMatches})`)
    }
    for (const row of rows) {
      if (!/^R/.test(row.id)) fails.push(`bad id ${row.id}`)
      const detail = await getDishDetail({ record_id: row.id })
      if (!detail?.item) fails.push(`no detail for ${row.id}`)
    }
    results.push({
      id: `tradition.${key}`,
      label: `Tradition matches for ${anchor.focus}${anchor.cuisine ? ` (${anchor.cuisine})` : ''}`,
      ok: fails.length === 0,
      detail: fails.join('; ') || rows.map((r) => r.title).slice(0, 3).join(', '),
    })
  }
  return results
}

export async function checkTraditionAssociationIntegrity() {
  const { candidates, threads } = await getTraditionAssociation('chicken', { limit: 12 })
  const fails = []
  if (!candidates.length) fails.push('no tradition companions for chicken')
  if (!threads.length) fails.push('no tradition threads for chicken')
  for (const c of candidates) {
    if (c.name.toLowerCase() === 'chicken') fails.push('self-neighbor chicken')
    if (!c.lens) fails.push(`missing lens on ${c.name}`)
  }
  return {
    id: 'tradition.association.chicken',
    label: 'Tradition association graph for chicken',
    ok: fails.length === 0,
    detail: fails.join('; ') || `${candidates.length} companions, ${threads.length} threads`,
  }
}

export function checkFoodbInventory() {
  const fails = []
  if (INGREDIENT_LIST.length < MIN_HEALTH.foodb_ingredients) {
    fails.push(`only ${INGREDIENT_LIST.length} Foodb rows`)
  }
  const dupes = INGREDIENT_LIST.length - new Set(INGREDIENT_LIST.map((n) => n.toLowerCase())).size
  if (dupes > 0) fails.push(`${dupes} duplicate names`)
  return {
    id: 'foodb.inventory',
    label: 'Foodb ingredient inventory',
    ok: fails.length === 0,
    detail: fails.join('; ') || `${INGREDIENT_LIST.length} ingredients`,
  }
}

export function checkRecipeNlgHeuristics() {
  const fails = []
  for (const [foodb, expected] of RECIPE_NLG_HEURISTIC) {
    const got = heuristicRecipeNlg(foodb)
    if (got !== expected) fails.push(`${foodb} → ${got} (want ${expected})`)
  }
  return {
    id: 'recipenlg.heuristic',
    label: 'Foodb → RecipeNLG heuristic mapping',
    ok: fails.length === 0,
    detail: fails.join('; ') || `${RECIPE_NLG_HEURISTIC.length} cases`,
  }
}

export async function checkRegionPicksFromDb() {
  const picks = await listRegionPicks({ limit: 10 })
  const fails = []
  if (picks.length < 5) fails.push(`only ${picks.length} region picks`)
  for (const p of picks) {
    if (!p.label || !p.key) fails.push('pick missing label/key')
    if ((p.dish_count ?? 0) < 1) fails.push(`${p.label} has zero dishes`)
  }
  return {
    id: 'tradition.regions',
    label: 'Cuisine scope picks from Tradition DB',
    ok: fails.length === 0,
    detail: fails.join('; ') || picks.map((p) => p.label).slice(0, 5).join(', '),
  }
}

export async function checkAssociateIntegrity(api, deps = {}) {
  const data = await associate(
    { dish: [{ name: 'Garlic', lens: 'compound' }], focusIngredient: 'Chicken' },
    { api, traditionDb: deps.traditionDb }
  )
  const fails = []
  if (data.cooccur?.status !== 'ok') fails.push(`cooccur ${data.cooccur?.status}`)
  for (const c of data.combined) {
    if (!['compound', 'tradition', 'co-occurrence'].includes(c.primaryLens)) {
      fails.push(`invented lens ${c.primaryLens}`)
    }
  }
  const lensCounts = {
    compound: data.byLens.compound.length,
    tradition: data.byLens.tradition.length,
    cooccurrence: data.byLens.cooccurrence.length,
  }
  if (lensCounts.compound < 1) fails.push('compound lens empty')
  if (lensCounts.tradition < 1) fails.push('tradition lens empty')
  if (lensCounts.cooccurrence < 1) fails.push('cooccurrence lens empty')
  return {
    id: 'associate.merge',
    label: 'Associate merges three live lenses',
    ok: fails.length === 0,
    detail: fails.join('; ') || JSON.stringify(lensCounts),
  }
}

export async function checkFormSchemaLive() {
  const res = await fetchFormCards('Chicken')
  const fails = []
  if (res.source !== 'llm') fails.push(`source=${res.source} (${res.error || 'no llm'})`)
  if (!res.forms?.length) fails.push('no form cards')
  for (const f of res.forms) {
    if (!f.name || !f.craft?.length) fails.push(`invalid card ${f.name || '(unnamed)'}`)
    if (f.craft.length < 2) fails.push(`${f.name} craft too thin`)
  }
  return {
    id: 'form.llm.chicken',
    label: 'LLM form cards for Chicken (live OpenAI)',
    ok: fails.length === 0,
    detail: fails.join('; ') || `${res.forms.length} frames`,
  }
}

export function formatReport(results) {
  const pass = results.filter((r) => r.ok).length
  const fail = results.filter((r) => !r.ok)
  const lines = [
    '',
    '═'.repeat(60),
    `RELIABILITY REPORT — ${pass}/${results.length} passed`,
    '═'.repeat(60),
    ...results.map((r) => {
      const mark = r.ok ? '✓' : '✗'
      return `${mark} ${r.label}\n    ${r.detail || ''}`
    }),
  ]
  if (fail.length) {
    lines.push('─'.repeat(60), 'FAILED:', ...fail.map((r) => `  • ${r.id}: ${r.detail}`))
  }
  lines.push('═'.repeat(60))
  return lines.join('\n')
}
