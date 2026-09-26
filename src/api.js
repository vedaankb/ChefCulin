/**
 * Thin client for the CulinAI FastAPI backend.
 * Vite proxies /api → http://127.0.0.1:8001 (see vite.config.js).
 */

const BASE = import.meta.env.VITE_API_BASE || '/api'

function requestUrl(path) {
  const p = path.startsWith('/') ? path : `/${path}`
  if (BASE.startsWith('http')) {
    const root = BASE.replace(/\/$/, '')
    return new URL(p, `${root}/`)
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return new URL(BASE + p, window.location.origin)
  }
  const api =
    (typeof process !== 'undefined' && process.env?.CULIN_API) || 'http://127.0.0.1:8001'
  return new URL(p, `${api.replace(/\/$/, '')}/`)
}

async function get(path, params = {}) {
  const url = requestUrl(path)
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
  })
  const res = await fetch(url)
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}${detail ? `: ${detail}` : ''}`)
  }
  return res.json()
}

async function post(path, body) {
  const res = await fetch(requestUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}${detail ? `: ${detail}` : ''}`)
  }
  return res.json()
}

export async function health() {
  return get('/health')
}

export async function cooccur(ingredient, n = 20) {
  return get('/cooccur', { ingredient, n })
}

/**
 * Compound lens dispatcher. Behind CULIN_COMPOUND_SOURCE on the API:
 * pairs (VCF) or flavor_network. Prefer product_id for member-level VCF.
 */
export async function compound(ingredient, n = 24, opts = {}) {
  return get('/compound', {
    ingredient,
    n,
    spine_id: opts.spineId,
    product_id: opts.productId,
  })
}

/**
 * VCF compound layer — prefer productId (member) over spineId (cluster).
 * @param {{ spineId?: string, productId?: number, n?: number, sameSourceOnly?: boolean }} opts
 */
export async function vcfPairs(opts = {}) {
  const { spineId = null, productId = null, n = 24, sameSourceOnly = false } = opts
  return get('/vcf/pairs', {
    spine_id: spineId,
    product_id: productId,
    n,
    same_source_only: sameSourceOnly ? 1 : 0,
  })
}

/** VCF form diffs for one spine entry, with an explicit coverage state (§2.4). */
export async function vcfForms(spineId, n = 24) {
  return get('/vcf/forms', { spine_id: spineId, n })
}

/** VCF phase-behaviour rows for one product (§2.5). */
export async function vcfPhase(productId, { against = null, n = 24 } = {}) {
  return get('/vcf/phase', { product_id: productId, against, n })
}

/** Dish-level phase frames (dominant_bucket across the plate). */
export async function vcfPhaseDish(productIds = []) {
  return get('/vcf/phase/dish', { product_ids: productIds.join(',') })
}

/** Counts and provenance for the VCF tables — used by lens disclosure (§2.7). */
export async function vcfMeta() {
  return get('/vcf/meta')
}

/** ICD-10-CM search via NLM (proxied). Riverside Health lens. */
export async function icdSearch(q, n = 20) {
  return get('/icd/search', { q, n })
}

/** MeSH disease associations for an ingredient's compounds. */
export async function healthDiseases(ingredient, n = 40) {
  return get('/health/diseases', { ingredient, n })
}

/**
 * Condition/ICD name → MeSH name-match → suggested culinary ingredients.
 * @param {{ name: string, code?: string, n?: number, exclude?: string[] }} opts
 */
export async function healthByCondition(opts = {}) {
  const { name, code = null, n = 24, exclude = [] } = opts
  return get('/health/by-condition', {
    name,
    code,
    n,
    exclude: exclude.length ? exclude.join(',') : undefined,
  })
}

export async function techniques(ingredient, n = 10) {
  return get('/techniques', { ingredient, n })
}

export async function listPalate(userId, limit = 50) {
  return get('/palate', { user_id: userId, limit })
}

export async function savePalate(body) {
  return post('/palate', body)
}
