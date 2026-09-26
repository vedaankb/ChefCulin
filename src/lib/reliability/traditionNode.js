/**
 * Tradition reliability checks via Node-loaded SQLite (no Vite wasm path).
 */
import { openTraditionDb } from '../agentTestHelpers.js'
import {
  FOCUS_ROLES,
  cuisineSearchTerms,
  focusSearchTokens,
  rolesForFocus,
} from '../traditionDb.js'
import { TRADITION_ANCHORS } from './anchors.js'

function runQuery(db, sql, params = []) {
  const stmt = db.prepare(sql)
  stmt.bind(params)
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

async function bestMatches(db, { names, cuisine = null, limit = 5 }) {
  const focusName = names[0]
  const tokens = focusSearchTokens(focusName)
  if (!tokens.length) return []
  const matchRoles = rolesForFocus(focusName)
  const cuisineTerms = cuisine ? cuisineSearchTerms(cuisine) : []
  const rolePlaceholders = matchRoles.map(() => '?').join(', ')
  const roleSql = `LOWER(COALESCE(ci.role_in_dish,'')) IN (${rolePlaceholders})`
  const hitLikes = tokens.map(() => "LOWER(COALESCE(ci.ingredient_name,'')) LIKE ?").join(' OR ')
  const whereLikes = tokens
    .map(
      () =>
        `(LOWER(ur.item) LIKE ? OR LOWER(COALESCE(ur.use_or_dish,'')) LIKE ?` +
        ` OR (LOWER(COALESCE(ci.ingredient_name,'')) LIKE ? AND ${roleSql}` +
        ` AND (? LIKE '%oil%' OR (` +
        `LOWER(COALESCE(ci.ingredient_name,'')) NOT LIKE '% oil%'` +
        ` AND LOWER(COALESCE(ci.ingredient_name,'')) NOT LIKE '%oil %'` +
        ` AND LOWER(COALESCE(ci.ingredient_name,'')) NOT LIKE 'oil%'` +
        `))))`
    )
    .join(' OR ')
  const hitParams = tokens.map((t) => `%${t}%`)
  const whereParams = tokens.flatMap((t) => {
    const like = `%${t}%`
    return [like, like, like, ...matchRoles.map((r) => r.toLowerCase()), String(t).toLowerCase()]
  })
  let cuisineSql = ''
  const cuisineParams = []
  if (cuisineTerms.length) {
    cuisineSql = `AND (${cuisineTerms
      .map(() => '(LOWER(ur.cuisine) LIKE LOWER(?) OR LOWER(ur.country) LIKE LOWER(?))')
      .join(' OR ')})`
    for (const t of cuisineTerms) cuisineParams.push(`%${t}%`, `%${t}%`)
  }
  return runQuery(
    db,
    `
    SELECT ur.record_id, ur.item, ur.cuisine, ur.country,
      COUNT(DISTINCT CASE WHEN (${hitLikes}) THEN LOWER(ci.ingredient_name) END) AS plate_hits
    FROM use_records ur
    LEFT JOIN companion_ingredients ci ON ci.dish_id = ur.dish_id
    WHERE COALESCE(ur.canon_status, 'active') = 'active'
      AND (${whereLikes})
    ${cuisineSql}
    GROUP BY ur.record_id
    ORDER BY plate_hits DESC, ur.traditionality_score DESC, ur.item ASC
    LIMIT ?
    `,
    [...hitParams, ...whereParams, ...cuisineParams, limit]
  )
}

export async function checkTraditionAnchorsNode() {
  const db = await openTraditionDb()
  const results = []
  for (const anchor of TRADITION_ANCHORS) {
    const key = `${anchor.focus}${anchor.cuisine ? `.${anchor.cuisine}` : ''}`
    const rows = await bestMatches(db, {
      names: [anchor.focus],
      cuisine: anchor.cuisine,
      limit: 5,
    })
    const fails = []
    if (rows.length < anchor.minMatches) {
      fails.push(`only ${rows.length} matches (need ${anchor.minMatches})`)
    }
    for (const row of rows) {
      if (!/^R/.test(row.record_id)) fails.push(`bad id ${row.record_id}`)
      const companions = runQuery(
        db,
        `SELECT ingredient_name FROM companion_ingredients ci
         JOIN use_records ur ON ur.dish_id = ci.dish_id
         WHERE ur.record_id = ?`,
        [row.record_id]
      )
      if (!companions.length) fails.push(`${row.record_id} has no companions`)
    }
    results.push({
      id: `tradition.${key}`,
      label: `Tradition matches for ${anchor.focus}${anchor.cuisine ? ` (${anchor.cuisine})` : ''}`,
      ok: fails.length === 0,
      detail: fails.join('; ') || rows.map((r) => r.item).slice(0, 3).join(', '),
    })
  }
  return results
}

export async function checkTraditionAssociationNode() {
  const db = await openTraditionDb()
  const candidates = runQuery(
    db,
    `
    SELECT ci2.ingredient_name AS name, COUNT(DISTINCT ci2.dish_id) AS dish_count
    FROM companion_ingredients ci1
    JOIN companion_ingredients ci2
      ON ci1.dish_id = ci2.dish_id AND LOWER(ci1.ingredient_name) != LOWER(ci2.ingredient_name)
    JOIN use_records ur ON ur.dish_id = ci1.dish_id
    WHERE COALESCE(ur.canon_status, 'active') = 'active'
      AND LOWER(ci1.ingredient_name) = LOWER(?)
    GROUP BY ci2.ingredient_name
    ORDER BY dish_count DESC
    LIMIT 12
    `,
    ['chicken']
  )
  const threads = runQuery(
    db,
    `
    SELECT ur.source_thread, ur.cuisine, COUNT(DISTINCT ur.dish_id) AS dish_count
    FROM use_records ur
    WHERE ur.dish_id IN (
      SELECT DISTINCT dish_id FROM companion_ingredients WHERE LOWER(ingredient_name) = LOWER(?)
    )
      AND COALESCE(ur.canon_status, 'active') = 'active'
    GROUP BY ur.source_thread, ur.cuisine
    ORDER BY dish_count DESC
    LIMIT 8
    `,
    ['chicken']
  )
  const fails = []
  if (!candidates.length) fails.push('no companions for chicken')
  if (!threads.length) fails.push('no threads for chicken')
  if (candidates.some((c) => c.name.toLowerCase() === 'chicken')) fails.push('self-neighbor')
  return {
    id: 'tradition.association.chicken',
    label: 'Tradition association graph for chicken',
    ok: fails.length === 0,
    detail: fails.join('; ') || `${candidates.length} companions, ${threads.length} threads`,
  }
}

export async function checkRegionPicksNode() {
  const db = await openTraditionDb()
  const picks = runQuery(
    db,
    `
    SELECT country, cuisine, COUNT(*) AS dish_count
    FROM use_records
    WHERE COALESCE(canon_status, 'active') = 'active'
      AND country IS NOT NULL AND TRIM(country) != ''
    GROUP BY country, cuisine
    ORDER BY dish_count DESC
    LIMIT 10
    `
  )
  const fails = []
  if (picks.length < 5) fails.push(`only ${picks.length} picks`)
  return {
    id: 'tradition.regions',
    label: 'Cuisine scope picks from Tradition DB',
    ok: fails.length === 0,
    detail: fails.join('; ') || picks.map((p) => p.country).slice(0, 5).join(', '),
  }
}

export async function checkTraditionScaleNode() {
  const db = await openTraditionDb()
  const [{ c }] = runQuery(
    db,
    "SELECT COUNT(*) AS c FROM use_records WHERE COALESCE(canon_status, 'active') = 'active'"
  )
  const fails = []
  if (c < 200) fails.push(`only ${c} use_records`)
  return {
    id: 'tradition.scale',
    label: 'Tradition DB record count',
    ok: fails.length === 0,
    detail: fails.join('; ') || `${c} documented dishes`,
  }
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

let traditionDbPromise = null

async function traditionDb() {
  if (!traditionDbPromise) traditionDbPromise = openTraditionDb()
  return traditionDbPromise
}

/** Node sqlite adapter — same shape as traditionDb.js for injectable tests. */
export function makeTraditionDbNode() {
  return {
    async getTraditionAssociation(seed, opts = {}) {
      const db = await traditionDb()
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
          COUNT(DISTINCT ci2.dish_id) AS dish_count
        FROM companion_ingredients ci1
        JOIN companion_ingredients ci2
          ON ci1.dish_id = ci2.dish_id
          AND LOWER(ci1.ingredient_name) != LOWER(ci2.ingredient_name)
        JOIN use_records ur ON ur.dish_id = ci1.dish_id
        WHERE COALESCE(ur.canon_status, 'active') = 'active'
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
        candidates.push({
          name: row.name,
          lens: 'tradition',
          reason: row.source_thread || row.cuisine || 'documented tradition',
          meta: {
            thread: row.source_thread,
            cuisine: row.cuisine,
            inScope: cuisineInScope(row, cuisineScope),
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
        WHERE ur.dish_id IN (
          SELECT DISTINCT dish_id FROM companion_ingredients WHERE LOWER(ingredient_name) = LOWER(?)
        )
          AND COALESCE(ur.canon_status, 'active') = 'active'
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
    },
  }
}
