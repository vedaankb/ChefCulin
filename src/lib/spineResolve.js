/**
 * Resolution layer — ingredient string → spine entry + member.
 *
 * Deterministic and synchronous by design. If granularity were resolved by the
 * model at query time, the shared-compound percentages would move between runs
 * and the reliability anchors would stop being testable. This is a pure lookup
 * over src/data/spine.json (360 entries, 581 members, built by
 * pipeline/scripts/emit_spine_bundle.py).
 *
 * Member-level return is the point, not a detail. culin:leek holds ten members
 * — garlic, onion, shallot, chive, leek, nira, nobiru, allium species. They are
 * not interchangeable, and a chef who typed "garlic" has already disambiguated;
 * handing back the cluster and asking them to choose again is wrong.
 */
import SPINE from '../data/spine.json' with { type: 'json' }

/** Match tiers, in the order they are tried. Exposed for tests and disclosure. */
export const MATCH_ORDER = ['member', 'entry', 'alias', 'loose']

/**
 * Same normalisation the pipeline's compound resolver uses (loose_key): case,
 * surrounding space, and the separators that differ between how a corpus writes
 * a name and how a chef types it. Collapsing these is what resolves the
 * singular/plural and hyphenation cases without a hand-maintained alias per form.
 */
export function looseKey(s) {
  const flat = String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s\-_/.,'()]+/g, '')
  return depluralize(flat)
}

/**
 * Light stemming, not a stemmer. Only the plural forms a chef actually types
 * for an ingredient: berries/berry, tomatoes/tomato, olives/olive. A trailing
 * -s strip alone turns "tomatoes" into "tomatoe" and the match is lost.
 */
function depluralize(w) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y'
  if (w.length > 3 && /(oes|ses|xes|zes|ches|shes)$/.test(w)) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1)
  return w
}

function exactKey(s) {
  return String(s || '').trim().toLowerCase()
}

/* ---------------------------------------------------------------- indexes -- */

const byMember = new Map() // exact member name/display -> [{entry, member}]
const byEntry = new Map() // exact entry display/base -> [entry]
const byAlias = new Map() // exact alias -> [entry]
const looseMember = new Map()
const looseEntry = new Map()

function push(map, key, value) {
  if (!key) return
  const cur = map.get(key)
  if (cur) {
    if (!cur.includes(value)) cur.push(value)
  } else {
    map.set(key, [value])
  }
}

for (const entry of SPINE) {
  for (const member of entry.members) {
    const hit = { entry, member }
    push(byMember, exactKey(member.display), hit)
    push(byMember, exactKey(member.raw_name), hit)
    push(looseMember, looseKey(member.display), hit)
    push(looseMember, looseKey(member.raw_name), hit)
    // "Leek (raw)" should also answer to a bare "leek", and
    // "Beef, Muscle (cooked)" to a bare "beef" — the VCF protein families
    // qualify with a comma where the plant products use a parenthetical.
    const bare = member.display.replace(/\s*\([^)]*\)/g, '').trim()
    push(byMember, exactKey(bare), hit)
    push(looseMember, looseKey(bare), hit)
    const head = bare.split(',')[0].trim()
    if (head && head !== bare) {
      push(byMember, exactKey(head), hit)
      push(looseMember, looseKey(head), hit)
    }
  }
  push(byEntry, exactKey(entry.display_name), entry)
  push(byEntry, exactKey(entry.base_ingredient), entry)
  push(looseEntry, looseKey(entry.display_name), entry)
  push(looseEntry, looseKey(entry.base_ingredient), entry)
  for (const alias of entry.aliases) {
    push(byAlias, exactKey(alias), entry)
    push(looseEntry, looseKey(alias), entry)
  }
}

/* --------------------------------------------------------------- resolving -- */

/** The member a bare entry hit should stand on: default_member, else first culinary. */
function pickDefaultMember(entry) {
  if (entry.default_member != null) {
    const m = entry.members.find((x) => x.id === entry.default_member)
    if (m) return m
  }
  return entry.members.find((m) => m.class === 'culinary') || entry.members[0] || null
}

/**
 * Display for a resolution. Never the entry id.
 *
 * Five entries carry display_name: null — culin:leek, culin:bilberry,
 * culin:kuini, culin:chekur, culin:summer_savory — because no member is more
 * generic than its siblings. There the member name or the chef's own query
 * stands in. A chef asking about garlic must never see "Leek".
 */
function displayFor(entry, member, query) {
  if (member) return member.display
  if (entry.display_name) return entry.display_name
  return String(query || '').trim() || entry.base_ingredient || entry.spine_id
}

function result({ entry, member, query, matchedOn, state }) {
  return {
    query: String(query || ''),
    spine_id: entry ? entry.spine_id : null,
    spine_member: member ? member.raw_name : null,
    member_id: member ? member.id : null,
    display: entry ? displayFor(entry, member, query) : String(query || '').trim(),
    policy: entry ? entry.policy : null,
    state,
    matched_on: matchedOn,
    product_group: entry ? entry.product_group : null,
    resolution_confidence: entry ? entry.resolution_confidence : null,
    entry: entry || null,
    member: member || null,
  }
}

/**
 * Resolve one ingredient string.
 *
 * state is 'resolved' (one entry, one member), 'ambiguous' (the string names
 * more than one entry — the caller must ask, not guess), or 'unknown'.
 *
 * @param {string} query
 * @returns {{spine_id: string|null, spine_member: string|null, policy: string|null,
 *            state: 'resolved'|'ambiguous'|'unknown', display: string, matched_on: string|null}}
 */
export function resolveIngredient(query) {
  const raw = String(query || '').trim()
  if (!raw) return result({ query: raw, state: 'unknown', matchedOn: null })

  const ex = exactKey(raw)
  const lk = looseKey(raw)

  // 1. Exact on member — the most specific thing a chef can have typed.
  const memberHits = byMember.get(ex)
  if (memberHits?.length === 1) {
    const { entry, member } = memberHits[0]
    return result({ entry, member, query: raw, matchedOn: 'member', state: 'resolved' })
  }
  if (memberHits?.length > 1) {
    return ambiguous(memberHits.map((h) => h.entry), raw, 'member', memberHits)
  }

  // 2. Exact on entry.
  const entryHits = byEntry.get(ex)
  if (entryHits?.length === 1) {
    const entry = entryHits[0]
    return result({ entry, member: pickDefaultMember(entry), query: raw, matchedOn: 'entry', state: 'resolved' })
  }
  if (entryHits?.length > 1) return ambiguous(entryHits, raw, 'entry')

  // 3. Alias.
  const aliasHits = byAlias.get(ex)
  if (aliasHits?.length === 1) {
    const entry = aliasHits[0]
    return result({ entry, member: pickDefaultMember(entry), query: raw, matchedOn: 'alias', state: 'resolved' })
  }
  if (aliasHits?.length > 1) return ambiguous(aliasHits, raw, 'alias')

  // 4. Loose — singular/plural, hyphenation, spacing.
  const looseM = looseMember.get(lk)
  if (looseM?.length === 1) {
    const { entry, member } = looseM[0]
    return result({ entry, member, query: raw, matchedOn: 'loose', state: 'resolved' })
  }
  if (looseM?.length > 1) return ambiguous(looseM.map((h) => h.entry), raw, 'loose', looseM)

  const looseE = looseEntry.get(lk)
  if (looseE?.length === 1) {
    const entry = looseE[0]
    return result({ entry, member: pickDefaultMember(entry), query: raw, matchedOn: 'loose', state: 'resolved' })
  }
  if (looseE?.length > 1) return ambiguous(looseE, raw, 'loose')

  return result({ query: raw, state: 'unknown', matchedOn: null })
}

/**
 * Pick between members of ONE entry that a query reached equally.
 *
 * "potato" hits five POTATO members (raw, baked, boiled, French fried, plain)
 * and "onion" hits two. These are preparation states of one ingredient, not
 * competing ingredients — the Form lens is what distinguishes them, so making
 * the chef choose here would be asking a Form question at resolution time.
 * Prefer the unqualified member, then the entry's declared default.
 */
function pickAmongMembers(entry, hits) {
  const plain = hits.filter((h) => !h.member.preparation.length && !h.member.cure_state && !h.member.form)
  if (plain.length === 1) return plain[0].member
  const source = plain.length ? plain : hits
  if (entry.default_member != null) {
    const d = source.find((h) => h.member.id === entry.default_member)
    if (d) return d.member
  }
  // Stable, not arbitrary: lowest product id, so repeated calls agree.
  return [...source].sort((a, b) => a.member.id - b.member.id)[0].member
}

function ambiguous(entries, query, matchedOn, memberHits = null) {
  const uniq = [...new Set(entries)]
  if (uniq.length === 1) {
    const entry = uniq[0]
    const member = memberHits?.length
      ? pickAmongMembers(entry, memberHits)
      : pickDefaultMember(entry)
    return result({ entry, member, query, matchedOn, state: 'resolved' })
  }
  const out = result({ entry: null, member: null, query, matchedOn, state: 'ambiguous' })
  out.candidates = uniq.map((entry) => ({
    spine_id: entry.spine_id,
    display: displayFor(entry, pickDefaultMember(entry), query),
    policy: entry.policy,
  }))
  return out
}

/** Resolve a list, preserving order. */
export function resolveAll(names) {
  return (names || []).map((n) => resolveIngredient(n))
}

/* ------------------------------------------------------------------ picker -- */

/** Every name a chef may pick, at chef granularity — culinary members only. */
export const SPINE_PICKER_LIST = (() => {
  const seen = new Set()
  const out = []
  for (const entry of SPINE) {
    for (const member of entry.members) {
      if (member.class !== 'culinary') continue
      const label = member.display
      const key = exactKey(label)
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        label,
        spine_id: entry.spine_id,
        member_id: member.id,
        product_group: entry.product_group,
        policy: entry.policy,
      })
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label))
})()

/** Substring search over the picker list, plus aliases. */
export function searchSpine(query, { limit = 40 } = {}) {
  const q = exactKey(query)
  if (!q) return SPINE_PICKER_LIST.slice(0, limit)
  const starts = []
  const contains = []
  for (const row of SPINE_PICKER_LIST) {
    const l = row.label.toLowerCase()
    if (l.startsWith(q)) starts.push(row)
    else if (l.includes(q)) contains.push(row)
    if (starts.length >= limit) break
  }
  return [...starts, ...contains].slice(0, limit)
}

export { SPINE }
