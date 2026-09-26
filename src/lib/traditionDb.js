/**
 * Client-side Tradition DB — sql.js over traditional_culinary_uses_database_v2.db.
 * Panels never touch SQL; call searchDishes / getDishDetail / listCompanions only.
 */
import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import dbUrl from '../data/traditional_culinary_uses_database_v2.db?url'

let dbPromise = null

export async function getDb() {
  if (!dbPromise) {
    dbPromise = loadDb()
  }
  return dbPromise
}

async function loadDb() {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl })
  const res = await fetch(dbUrl)
  if (!res.ok) throw new Error(`Failed to fetch tradition DB: ${res.status}`)
  const buf = await res.arrayBuffer()
  return new SQL.Database(new Uint8Array(buf))
}

/** Reset cached DB (tests only). */
export function _resetDbForTests() {
  dbPromise = null
}

export function cuisineSearchTerms(cuisine) {
  const raw = String(cuisine || '').trim()
  if (!raw) return []
  const lower = raw.toLowerCase()
  const aliases = {
    moroccan: 'Morocco',
    chinese: 'China',
    indian: 'India',
    japanese: 'Japan',
    italian: 'Italy',
    mexican: 'Mexico',
    french: 'France',
    spanish: 'Spain',
    korean: 'Korea',
    thai: 'Thailand',
    nigerian: 'Nigeria',
    brazilian: 'Brazil',
    turkish: 'Turkey',
    persian: 'Iran',
    iranian: 'Iran',
    lebanese: 'Lebanon',
    ethiopian: 'Ethiopia',
    german: 'Germany',
    greek: 'Greece',
    peruvian: 'Peru',
    american: 'United States',
  }
  const extra = aliases[lower]
  return extra ? [raw, extra] : [raw]
}

function rowsFrom(stmt) {
  const cols = stmt.getColumnNames()
  const out = []
  while (stmt.step()) {
    const values = stmt.get()
    const row = {}
    cols.forEach((c, i) => {
      row[c] = values[i]
    })
    out.push(row)
  }
  stmt.free()
  return out
}

function runQuery(db, sql, params = []) {
  const stmt = db.prepare(sql)
  stmt.bind(params)
  return rowsFrom(stmt)
}

/** Hold/excluded stay in the file; the lens only reads the active canon. */
const ACTIVE_SQL = "COALESCE(canon_status, 'active') = 'active'"
const UR_ACTIVE_SQL = "COALESCE(ur.canon_status, 'active') = 'active'"

function isConfidenceAssessed(row) {
  const state = String(row?.lens_confidence_state || '').toLowerCase()
  if (state.startsWith('assessed')) return true
  if (state.includes('pending') || state.includes('unrated')) return false
  const conf = String(row?.confidence || '').trim()
  return Boolean(conf) && conf.toLowerCase() !== 'pending'
}

/**
 * Search use_records. All filters optional; empty query returns a small sample.
 * @param {{ cuisine?: string, source_thread?: string, item_type?: string, keyword?: string, limit?: number }} query
 */
export async function searchDishes(query = {}) {
  const db = await getDb()
  const {
    cuisine = null,
    source_thread = null,
    item_type = null,
    keyword = null,
    limit = 24,
  } = query

  const where = []
  const params = []

  if (cuisine) {
    const terms = cuisineSearchTerms(cuisine)
    const clause = terms
      .map(() => '(LOWER(cuisine) LIKE LOWER(?) OR LOWER(country) LIKE LOWER(?))')
      .join(' OR ')
    where.push(`(${clause})`)
    for (const t of terms) {
      params.push(`%${t}%`, `%${t}%`)
    }
  }
  if (source_thread) {
    where.push('LOWER(source_thread) LIKE LOWER(?)')
    params.push(`%${source_thread}%`)
  }
  if (item_type) {
    where.push('LOWER(item_type) LIKE LOWER(?)')
    params.push(`%${item_type}%`)
  }
  if (keyword) {
    where.push(
      `(LOWER(item) LIKE LOWER(?) OR LOWER(use_or_dish) LIKE LOWER(?) OR LOWER(preparation_or_function) LIKE LOWER(?) OR LOWER(region_or_community) LIKE LOWER(?) OR LOWER(tags) LIKE LOWER(?))`
    )
    const k = `%${keyword}%`
    params.push(k, k, k, k, k)
  }

  where.push(ACTIVE_SQL)
  const whereSql = `WHERE ${where.join(' AND ')}`
  params.push(Math.min(Math.max(Number(limit) || 24, 1), 100))

  return runQuery(
    db,
    `
    SELECT
      record_id, dish_id, cuisine, item, item_type,
      traditionality_class, traditionality_score,
      use_or_dish, use_category, source_thread, country,
      region_or_community, preparation_or_function,
      occasion_or_context, confidence, evidence_basis,
      documentation_status, primary_source_url, wikipedia_url, tags
    FROM use_records
    ${whereSql}
    ORDER BY COALESCE(traditionality_score, -1) DESC, item ASC
    LIMIT ?
    `,
    params
  )
}

export async function listCompanions(dishId) {
  if (!dishId) return []
  const db = await getDb()
  const rows = runQuery(
    db,
    `
    SELECT
      companion_id, dish_id, record_id, cuisine,
      ingredient_name, ingredient_category, role_in_dish,
      is_optional, use_priority, traditional_fit,
      preparation_note, region_or_context,
      spine_id, spine_match_basis
    FROM companion_ingredients
    WHERE dish_id = ?
    ORDER BY use_priority ASC, ingredient_name ASC
    `,
    [dishId]
  )
  // Member-level resolution at read time — never collapse garlic onto culin:leek alone.
  const { resolveIngredient } = await import('./spineResolve.js')
  return rows.map((row) => {
    const r = resolveIngredient(row.ingredient_name)
    return {
      ...row,
      spine_id: row.spine_id || (r.state === 'resolved' ? r.spine_id : null),
      spine_member: r.state === 'resolved' ? r.spine_member : null,
      member_id: r.state === 'resolved' ? r.member_id : null,
      spine_display: r.state === 'resolved' ? r.display : row.ingredient_name,
      spine_state: r.state,
    }
  })
}

/**
 * Full record + companion ingredient names for selection / calculator.
 * @param {{ record_id?: string, dish_id?: string }} id
 */
export async function getDishDetail(id = {}) {
  const db = await getDb()
  const { record_id = null, dish_id = null } = id
  if (!record_id && !dish_id) return null

  const rows = record_id
    ? runQuery(db, 'SELECT * FROM use_records WHERE record_id = ? LIMIT 1', [record_id])
    : runQuery(db, 'SELECT * FROM use_records WHERE dish_id = ? LIMIT 1', [dish_id])

  const record = rows[0] || null
  if (!record) return null

  const companions = await listCompanions(record.dish_id)
  return {
    ...record,
    companions,
    companionIngredients: companions.map((c) => c.spine_display || c.ingredient_name),
  }
}

/** Distinct cuisines in the Tradition DB, ranked by record count. */
export async function listCuisines() {
  const db = await getDb()
  return runQuery(
    db,
    `
    SELECT cuisine, COUNT(*) AS dish_count
    FROM use_records
    WHERE ${ACTIVE_SQL}
      AND cuisine IS NOT NULL AND TRIM(cuisine) != ''
    GROUP BY cuisine
    ORDER BY dish_count DESC, cuisine ASC
    `
  )
}

/**
 * Cuisine scope picks for the mast — from documented Tradition records, not a static list.
 * @returns {Promise<Array<{ key: string, label: string, dish_count: number }>>}
 */
export async function listRegionPicks({ limit = 24 } = {}) {
  const db = await getDb()
  const cap = Math.min(Math.max(Number(limit) || 24, 1), 60)
  const rows = runQuery(
    db,
    `
    SELECT country, cuisine, COUNT(*) AS dish_count
    FROM use_records
    WHERE ${ACTIVE_SQL}
      AND ((country IS NOT NULL AND TRIM(country) != '')
       OR (cuisine IS NOT NULL AND TRIM(cuisine) != ''))
    GROUP BY country, cuisine
    ORDER BY dish_count DESC, country ASC, cuisine ASC
    LIMIT ?
    `,
    [cap]
  )
  const seen = new Set()
  const picks = []
  for (const row of rows) {
    const label = row.country || row.cuisine
    if (!label) continue
    const key = String(label).toLowerCase().replace(/\s+/g, '_')
    if (seen.has(key)) continue
    seen.add(key)
    picks.push({
      key,
      label,
      dish_count: Number(row.dish_count) || 0,
      cuisine: row.cuisine || null,
    })
  }
  return picks
}

/**
 * Match free-text region input against Tradition DB geography fields.
 * @returns {Promise<{ label: string, keys: string[] } | null>}
 */
export async function matchTraditionRegion(raw) {
  const text = String(raw || '').trim()
  if (!text) return null
  const terms = cuisineSearchTerms(text)
  const db = await getDb()
  const clause = terms
    .map(
      () =>
        `(LOWER(country) LIKE LOWER(?) OR LOWER(cuisine) LIKE LOWER(?) OR LOWER(region_or_community) LIKE LOWER(?) OR LOWER(source_thread) LIKE LOWER(?))`
    )
    .join(' OR ')
  const params = terms.flatMap((t) => [`%${t}%`, `%${t}%`, `%${t}%`, `%${t}%`])
  const rows = runQuery(
    db,
    `
    SELECT country, cuisine, region_or_community, COUNT(*) AS dish_count
    FROM use_records
    WHERE ${ACTIVE_SQL} AND (${clause})
    GROUP BY country, cuisine, region_or_community
    ORDER BY dish_count DESC
    LIMIT 1
    `,
    params
  )
  if (!rows.length) return null
  const row = rows[0]
  const label = row.country || row.cuisine || row.region_or_community
  const keys = [row.country, row.cuisine, row.region_or_community]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase().replace(/\s+/g, '_'))
  return { label, keys: [...new Set(keys)] }
}

/**
 * Tradition lens for Associate — companions from documented dishes that share
 * a seed ingredient. Replaces the old static TRADITION_GROUPS chip lists.
 *
 * @param {string} seed — ingredient to anchor on (last on dish, or focus)
 * @param {{ exclude?: string[], limit?: number, cuisineScope?: { label: string, keys: string[] } | null }} opts
 */
export async function getTraditionAssociation(seed, opts = {}) {
  const db = await getDb()
  const { exclude = [], limit = 16, cuisineScope = null } = opts
  const skip = new Set(exclude.map((n) => n.toLowerCase()))
  const cap = Math.min(Math.max(Number(limit) || 16, 1), 32)

  const neighborRows = runQuery(
    db,
    `
    SELECT
      ci2.ingredient_name AS name,
      ur.source_thread,
      ur.cuisine,
      ur.country,
      ur.region_or_community,
      ur.confidence,
      ur.documentation_status,
      (SELECT COUNT(*) FROM sources sx WHERE sx.dish_id = ur.dish_id) AS source_count,
      COUNT(DISTINCT ci2.dish_id) AS dish_count
    FROM companion_ingredients ci1
    JOIN companion_ingredients ci2
      ON ci1.dish_id = ci2.dish_id
      AND LOWER(ci1.ingredient_name) != LOWER(ci2.ingredient_name)
    JOIN use_records ur ON ur.dish_id = ci1.dish_id
    WHERE ${UR_ACTIVE_SQL}
      AND LOWER(ci1.ingredient_name) = LOWER(?)
    GROUP BY ci2.ingredient_name, ur.source_thread, ur.cuisine, ur.country, ur.region_or_community
    ORDER BY dish_count DESC, name ASC
    LIMIT ?
    `,
    [seed, cap * 3]
  )

  const seen = new Set()
  const candidates = []
  for (const row of neighborRows) {
    const key = row.name.toLowerCase()
    if (skip.has(key) || seen.has(key)) continue
    seen.add(key)
    const inScope = cuisineInScope(row, cuisineScope)
    candidates.push({
      name: row.name,
      lens: 'tradition',
      reason: row.source_thread || row.cuisine || 'documented tradition',
      meta: {
        thread: row.source_thread,
        cuisine: row.cuisine,
        inScope,
        engaged: false,
        hits: 0,
        dish_count: row.dish_count,
      },
    })
    if (candidates.length >= cap) break
  }

  const threadRows = runQuery(
    db,
    `
    SELECT
      ur.source_thread,
      ur.cuisine,
      ur.country,
      ur.region_or_community,
      GROUP_CONCAT(DISTINCT ci.ingredient_name) AS ingredients
    FROM use_records ur
    JOIN companion_ingredients ci ON ci.dish_id = ur.dish_id
    WHERE ${UR_ACTIVE_SQL}
      AND ur.dish_id IN (
      SELECT DISTINCT dish_id FROM companion_ingredients WHERE LOWER(ingredient_name) = LOWER(?)
    )
    GROUP BY ur.source_thread, ur.cuisine, ur.country, ur.region_or_community
    ORDER BY COUNT(DISTINCT ur.dish_id) DESC
    LIMIT 12
    `,
    [seed]
  )

  const threads = threadRows.map((row) => ({
    title: row.source_thread || row.cuisine || 'Tradition thread',
    thread: row.source_thread,
    region: regionKeysFromRecord(row),
    regionKeys: regionKeysFromRecord(row).split(',').filter(Boolean),
    inScope: cuisineInScope(row, cuisineScope),
    engaged: false,
    hits: [],
    requires: null,
  }))

  return { seed, candidates, threads }
}

function regionKeysFromRecord(row) {
  const parts = [row.country, row.cuisine, row.region_or_community]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase().replace(/\s+/g, '_'))
  return [...new Set(parts)].join(',')
}

function cuisineInScope(row, cuisineScope) {
  if (!cuisineScope?.keys?.length) return null
  const hay = [row.cuisine, row.country, row.region_or_community]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return cuisineScope.keys.some((k) =>
    k.split(',').some((part) => hay.includes(part.trim().toLowerCase()))
  )
}

const TOKEN_STOP = new Set([
  'the',
  'and',
  'with',
  'family',
  'foods',
  'products',
  'domestic',
  'european',
  'mallard',
  'velvet',
  'type',
  'other',
])

/** Tokens used to rank Tradition records against the focus + plate. */
export function traditionSearchTokens(names = []) {
  const seen = new Set()
  const out = []
  const add = (t) => {
    const s = String(t || '')
      .trim()
      .toLowerCase()
    if (s.length < 3 || TOKEN_STOP.has(s) || seen.has(s)) return
    seen.add(s)
    out.push(s)
  }
  for (const name of names) {
    if (!name) continue
    const lower = String(name).toLowerCase()
    add(lower)
    lower
      .replace(/[()]/g, ' ')
      .split(/[\s,/]+/)
      .forEach(add)
    if (/cattle|beef/.test(lower)) add('beef')
    if (/pig|pork/.test(lower)) add('pork')
    if (/sheep|lamb|mutton/.test(lower)) add('lamb')
  }
  return out.slice(0, 10)
}

function rowToOption(row) {
  const classLabel = row.traditionality_class || 'documented'
  const place = [row.cuisine, row.country].filter(Boolean).join(' · ')
  return {
    id: row.record_id,
    title: row.item,
    subtitle: `${place}${place ? ' — ' : ''}${classLabel}`,
    score: Number(row.traditionality_score) || 0,
    plateHits: Number(row.plate_hits) || 0,
    dish_id: row.dish_id,
    // Pending means unassessed, not low. A lens that renders the two the same
    // way lies about what it knows (§2.6).
    confidence: isConfidenceAssessed(row) ? row.confidence : 'Pending',
    confidenceIsAssessed: isConfidenceAssessed(row),
    sourceCount: Number(row.source_count) || 0,
  }
}

function mergeOptions(primary, extra, cap) {
  const seen = new Set(primary.map((r) => r.id))
  const out = [...primary]
  for (const row of extra) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    out.push(row)
    if (out.length >= cap) break
  }
  return out
}

export function plateTokensFromNames(focusName, plateNames = []) {
  const focusSet = new Set(traditionSearchTokens([focusName]))
  return traditionSearchTokens(plateNames).filter((t) => !focusSet.has(t))
}

/**
 * "olive" must not qualify a dish via "olive oil". Role gating alone is not
 * enough — a few oil rows are tagged `ingredient`. If the chef typed oil/fat
 * as the focus, keep medium names and include the `fat` role so oil-as-medium
 * dishes actually surface.
 */
export function isOilMediumName(name) {
  const s = String(name || '').toLowerCase().trim()
  return s === 'oil' || /\boil\b/.test(s) || s.includes(' oil')
}

/** Multi-word / qualified oil (olive oil), not the bare token "oil". */
export function isSpecificOilPhrase(name) {
  const s = String(name || '').toLowerCase().trim()
  return s !== 'oil' && s !== 'fat' && isOilMediumName(s)
}

/** Focus is itself a cooking fat/oil — not a fruit or protein cooked *in* one. */
export function isFatMediumFocus(name) {
  const s = String(name || '').toLowerCase().trim()
  if (!s) return false
  if (isOilMediumName(s)) return true
  return /\b(butter|ghee|lard|tallow|schmaltz|dripping|shortening)\b/.test(s) || s === 'fat'
}

/**
 * Fruit/aromatic focus → FOCUS_ROLES only.
 * Oil/butter/ghee focus → also allow `fat` so medium rows match.
 */
export function rolesForFocus(focusName, override = null) {
  if (override != null) return override
  if (isFatMediumFocus(focusName)) return [...FOCUS_ROLES, 'fat']
  return FOCUS_ROLES
}

/**
 * For "olive oil", drop the bare "olive" token so fruit dishes do not ride along.
 * Prefer specific oil phrases over a lone "oil" token (avoids sesame/walnut bleed).
 */
export function focusSearchTokens(focusName) {
  const tokens = traditionSearchTokens([focusName])
  if (!isFatMediumFocus(focusName)) return tokens
  const kept = tokens.filter(
    (t) => isOilMediumName(t) || isFatMediumFocus(t) || t === 'oil' || t === 'fat'
  )
  const specificOils = kept.filter((t) => isSpecificOilPhrase(t))
  if (specificOils.length) return specificOils
  return kept.length ? kept : tokens
}

function companionFocusMatchSql(roles) {
  const role = focusRoleClause(roles)
  // Params per token after the three LIKEs: role…, then the token itself for the oil gate.
  return {
    sql:
      `(LOWER(COALESCE(ci.ingredient_name,'')) LIKE ? AND ${role.sql}` +
      ` AND (? LIKE '%oil%' OR (` +
      `LOWER(COALESCE(ci.ingredient_name,'')) NOT LIKE '% oil%'` +
      ` AND LOWER(COALESCE(ci.ingredient_name,'')) NOT LIKE '%oil %'` +
      ` AND LOWER(COALESCE(ci.ingredient_name,'')) NOT LIKE 'oil%'` +
      `)))`,
    roleParams: role.params,
  }
}

function tokenWhereClause(tokens, roles = FOCUS_ROLES) {
  if (!tokens.length) return { sql: '1=0', params: [] }
  // The companion arm is role-gated: matching on ci.ingredient_name alone is
  // what let a dish qualify because it is FRIED IN the queried ingredient.
  const companion = companionFocusMatchSql(roles)
  const whereLikes = tokens
    .map(
      () =>
        `(LOWER(ur.item) LIKE ? OR LOWER(COALESCE(ur.use_or_dish,'')) LIKE ?` +
        ` OR ${companion.sql})`
    )
    .join(' OR ')
  const params = tokens.flatMap((t) => {
    const like = `%${t}%`
    const tokenLower = String(t).toLowerCase()
    return [like, like, like, ...companion.roleParams, tokenLower]
  })
  return { sql: `(${whereLikes})`, params }
}

/**
 * Roles that mean the ingredient is IN the dish, as opposed to something the
 * dish is cooked in (§2.6).
 *
 * A chef asking about olives wants dishes where olives are the main event or a
 * seasoning — not the rows where olive oil is the cooking medium. Without this
 * filter "olive" returns olive oil, which was the original test failure. `fat`
 * and `garnish` are excluded from the focus match for that reason; they remain
 * perfectly valid companion rows once a dish is opened. Oil/butter as *focus*
 * re-opens `fat` via rolesForFocus.
 */
export const FOCUS_ROLES = ['main', 'seasoning', 'aromatic', 'ingredient']

/** Roles a focus match must NOT be carried by alone (unless focus is that medium). */
export const MEDIUM_ROLES = ['fat', 'garnish']

function focusRoleClause(roles = FOCUS_ROLES) {
  if (!roles.length) return { sql: '1=1', params: [] }
  const placeholders = roles.map(() => '?').join(', ')
  return {
    sql: `LOWER(COALESCE(ci.role_in_dish,'')) IN (${placeholders})`,
    params: roles.map((r) => r.toLowerCase()),
  }
}

function companionHitClause(tokens) {
  if (!tokens.length) return { sql: '0', params: [] }
  const hitLikes = tokens.map(() => "LOWER(COALESCE(ci.ingredient_name,'')) LIKE ?").join(' OR ')
  return { sql: `(${hitLikes})`, params: tokens.map((t) => `%${t}%`) }
}

function queryTraditionRows(
  db,
  { focusTokens, plateTokens = [], cuisineTerms = [], limit = 5, excludeIds = new Set(), roles = FOCUS_ROLES }
) {
  if (!focusTokens.length) return []

  const focus = tokenWhereClause(focusTokens, roles)
  const plateHits = companionHitClause(plateTokens)

  let cuisineSql = ''
  const cuisineParams = []
  if (cuisineTerms.length) {
    cuisineSql = `AND (${cuisineTerms
      .map(() => '(LOWER(ur.cuisine) LIKE LOWER(?) OR LOWER(ur.country) LIKE LOWER(?))')
      .join(' OR ')})`
    for (const t of cuisineTerms) cuisineParams.push(`%${t}%`, `%${t}%`)
  }

  const fetchCap = Math.min(limit + excludeIds.size + 8, 32)
  const rows = runQuery(
    db,
    `
    SELECT
      ur.record_id,
      ur.dish_id,
      ur.item,
      ur.cuisine,
      ur.country,
      ur.traditionality_class,
      ur.traditionality_score,
      ur.source_thread,
      ur.region_or_community,
      ur.confidence,
      ur.lens_confidence_state,
      (SELECT COUNT(*) FROM sources sx WHERE sx.dish_id = ur.dish_id AND sx.is_dish_specific = 1) AS source_count,
      COUNT(DISTINCT CASE WHEN ${plateHits.sql} THEN LOWER(ci.ingredient_name) END) AS plate_hits
    FROM use_records ur
    LEFT JOIN companion_ingredients ci ON ci.dish_id = ur.dish_id
    WHERE ${UR_ACTIVE_SQL}
      AND ${focus.sql}
    ${cuisineSql}
    GROUP BY ur.record_id
    ORDER BY plate_hits DESC, COALESCE(ur.traditionality_score, -1) DESC, ur.item ASC
    LIMIT ?
    `,
    [...plateHits.params, ...focus.params, ...cuisineParams, fetchCap]
  )

  return rows.filter((r) => !excludeIds.has(r.record_id)).slice(0, limit)
}

/**
 * Top documented dishes for the focus (core) ingredient.
 * Core match is mandatory; other gathered plate items boost rank via plate_hits.
 * Fills to `limit` (default 5) by relaxing cuisine scope only — never drops the core.
 */
export async function bestTraditionMatches({
  names = [],
  focus = null,
  cuisine = null,
  cuisineScope = null,
  limit = 5,
  roles = null,
} = {}) {
  const db = await getDb()
  const focusName = focus || names[0]
  if (!focusName) return []

  const plateNames = focus != null ? names.filter((n) => n !== focusName) : names.slice(1)
  const focusTokens = focusSearchTokens(focusName)
  const plateTokens = plateTokensFromNames(focusName, plateNames)
  const matchRoles = rolesForFocus(focusName, roles)
  const cap = Math.min(Math.max(Number(limit) || 5, 1), 12)
  if (!focusTokens.length) return []

  const cuisineTerms = cuisine
    ? cuisineSearchTerms(cuisine)
    : cuisineScope?.label
      ? cuisineSearchTerms(cuisineScope.label)
      : []

  const excludeIds = new Set()
  const take = (rows) => {
    const options = rows.map(rowToOption)
    options.forEach((o) => excludeIds.add(o.id))
    return options
  }

  const query = (cuisineFilter, n) =>
    queryTraditionRows(db, {
      focusTokens,
      plateTokens,
      cuisineTerms: cuisineFilter,
      limit: n,
      excludeIds,
      roles: matchRoles,
    })

  let options = take(query(cuisineTerms, cap))

  if (options.length < cap && cuisineTerms.length) {
    options = mergeOptions(options, take(query([], cap - options.length)), cap)
  }

  return options
}

