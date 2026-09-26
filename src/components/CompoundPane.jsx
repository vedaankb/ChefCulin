import { useEffect, useState } from 'react'
import { useWorkspace } from '../context/WorkspaceContext.jsx'
import * as api from '../api.js'
import { plateSeed } from '../lib/plateSeed.js'
import { resolveIngredient } from '../lib/spineResolve.js'
import { groupsFor, sharedCompoundSentence, topCompounds } from '../lib/compoundLanguage.js'
import Chip from './Chip.jsx'

/** Strip the VCF binomial so a chef reads "Pork", not "PORK (Sus scrofa L.)". */
function neighborLabel(raw) {
  return String(raw || '')
    .replace(/\s*\([A-Z][a-z]+ (?:[a-z]+|species)[^)]*\)/g, '')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function culinaryMembers(resolution) {
  const members = resolution?.entry?.members || []
  return members.filter((m) => m.class === 'culinary')
}

/**
 * Fetch strategy from resolution policy (§2.1 / §2.3).
 * Member-level match always uses that product — even on a category entry —
 * because the chef already disambiguated.
 */
async function fetchPairRows(resolution) {
  const policy = resolution.policy || 'single'
  const memberMatched = resolution.matched_on === 'member'

  if (memberMatched || policy === 'single' || !policy) {
    const res = await api.vcfPairs({
      productId: resolution.member_id,
      spineId: resolution.spine_id,
      n: 24,
    })
    return {
      mode: 'member',
      rows: res.results || [],
      mixed: res.mixed_profile_source_count || 0,
      range: null,
      members: null,
    }
  }

  if (policy === 'category' && !memberMatched) {
    return {
      mode: 'choose',
      rows: [],
      mixed: 0,
      range: null,
      members: culinaryMembers(resolution),
    }
  }

  // expand — per culinary member, report the shared_count range, merge unique neighbours.
  const members = culinaryMembers(resolution)
  const responses = await Promise.all(
    members.map((m) =>
      api.vcfPairs({ productId: m.id, spineId: resolution.spine_id, n: 16 }).catch(() => null)
    )
  )
  const byMatch = new Map()
  const counts = []
  let mixed = 0
  responses.forEach((res, i) => {
    if (!res?.results?.length) return
    counts.push({
      member: members[i].display || members[i].raw_name,
      topShared: res.results[0]?.shared_count || 0,
      n: res.results.length,
    })
    mixed += res.mixed_profile_source_count || 0
    for (const row of res.results) {
      const key = row.match_vcf_product_id
      const prev = byMatch.get(key)
      if (!prev || (row.shared_count || 0) > (prev.shared_count || 0)) {
        byMatch.set(key, {
          ...row,
          expand_from: members[i].display || members[i].raw_name,
        })
      }
    }
  })
  const rows = [...byMatch.values()].sort((a, b) => (b.shared_count || 0) - (a.shared_count || 0))
  const sharedVals = counts.map((c) => c.topShared).filter((n) => n > 0)
  const range =
    sharedVals.length > 1
      ? { min: Math.min(...sharedVals), max: Math.max(...sharedVals), members: counts }
      : null
  return { mode: 'expand', rows: rows.slice(0, 24), mixed, range, members }
}

export default function CompoundPane() {
  const { dish, cuisineScope, overlayNote, form, focusIngredient } = useWorkspace()
  const [status, setStatus] = useState({ kind: 'loading', text: 'Loading compound layer…' })
  const [resolution, setResolution] = useState(null)
  const [rows, setRows] = useState([])
  const [openRow, setOpenRow] = useState(null)
  const [range, setRange] = useState(null)
  const [chooseMembers, setChooseMembers] = useState(null)
  const [mixedCount, setMixedCount] = useState(0)
  const [memberOverride, setMemberOverride] = useState(null)

  useEffect(() => {
    setMemberOverride(null)
  }, [focusIngredient, dish])

  useEffect(() => {
    const display = plateSeed(dish, focusIngredient)
    if (!display) {
      setStatus({
        kind: 'empty',
        text: 'Choose a focus ingredient or gather one on the plate to seed the compound layer.',
      })
      setRows([])
      setResolution(null)
      setRange(null)
      setChooseMembers(null)
      return
    }

    const r = resolveIngredient(display)
    const active =
      memberOverride && r.state === 'resolved'
        ? {
            ...r,
            member_id: memberOverride.id,
            spine_member: memberOverride.raw_name,
            display: memberOverride.display || memberOverride.raw_name,
            matched_on: 'member',
            policy: r.policy,
          }
        : r
    setResolution(active)

    if (active.state !== 'resolved') {
      setRows([])
      setRange(null)
      setChooseMembers(null)
      setStatus({
        kind: 'empty',
        text:
          active.state === 'ambiguous'
            ? `“${display}” names more than one ingredient in the compound corpus — pick one.`
            : `No VCF compound data for “${display}”.`,
      })
      return
    }

    let cancelled = false
    setStatus({ kind: 'loading', text: `Loading shared compounds for ${active.display}…` })
    ;(async () => {
      try {
        const fetched = await fetchPairRows(active)
        if (cancelled) return
        if (fetched.mode === 'choose') {
          setRows([])
          setRange(null)
          setChooseMembers(fetched.members || [])
          setMixedCount(0)
          setStatus({
            kind: 'empty',
            text: `“${active.display}” is a category — pick which member to read compounds for.`,
          })
          return
        }
        const inDish = new Set(dish.map((d) => d.name.toLowerCase()))
        const kept = (fetched.rows || [])
          .map((row) => ({ ...row, label: neighborLabel(row.match_raw_name) }))
          .filter((row) => !inDish.has(row.label.toLowerCase()))
        setRows(kept)
        setRange(fetched.range)
        setChooseMembers(null)
        setMixedCount(fetched.mixed || 0)
        setStatus({
          kind: kept.length ? 'ok' : 'empty',
          text: kept.length
            ? `${kept.length} ingredient${kept.length === 1 ? '' : 's'} share volatile compounds with ${active.display}`
            : `No shared-compound neighbours for ${active.display}`,
        })
      } catch (err) {
        if (cancelled) return
        setRows([])
        setRange(null)
        setChooseMembers(null)
        setStatus({
          kind: 'err',
          text: `Compound API unreachable. Start: npm run api — ${err.message || err}`,
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [dish, focusIngredient, memberOverride])

  return (
    <section className="pane pane-c on">
      <div className={`notice ${status.kind === 'ok' ? 'ok' : status.kind === 'err' ? 'err' : ''}`}>
        {status.kind === 'ok' ? (
          <>
            <strong>Compound layer.</strong> {status.text}
          </>
        ) : status.kind === 'err' ? (
          <>
            <strong>Compound lens unavailable.</strong> {status.text}
          </>
        ) : (
          status.text
        )}
      </div>

      <p className="pane-intro">
        Ingredients that share <em>volatile aroma compounds</em> with{' '}
        {resolution?.display || focusIngredient}. Each one names the compound families behind the
        match — the evidence, not a similarity number.
      </p>

      <div className="lens-source">
        <span className="ls-lbl">Source</span>
        Volatile Compounds in Food (VCF), licensed. Shared-compound counts weighted by how rare
        each compound is across the corpus.
        {resolution?.state === 'resolved' && (
          <>
            {' '}
            Resolved “{resolution.query}” → {resolution.spine_member}
            {resolution.member_id != null ? ` (#${resolution.member_id})` : ''} via{' '}
            {resolution.matched_on} match
            {resolution.policy ? ` · policy ${resolution.policy}` : ''}.
          </>
        )}
        {mixedCount > 0 && (
          <>
            {' '}
            {mixedCount} neighbour{mixedCount === 1 ? '' : 's'} compare profiles from different
            sources — treat those ranks as provisional.
          </>
        )}
      </div>

      {range && (
        <div className="scope-lens-note">
          <span className="sn-lbl">Expand policy · range</span>
          Across {range.members.length} culinary members, top shared-compound counts run{' '}
          {range.min}–{range.max}. Showing the union of neighbours, strongest first.
        </div>
      )}

      {chooseMembers?.length > 0 && (
        <div className="group">
          <div className="g-label">Pick a member</div>
          <div className="chips">
            {chooseMembers.map((m) => (
              <button
                key={m.id}
                type="button"
                className="mini"
                onClick={() => setMemberOverride(m)}
              >
                {m.display || m.raw_name}
              </button>
            ))}
          </div>
        </div>
      )}

      {cuisineScope && (
        <div className="scope-lens-note">
          <span className="sn-lbl">Cuisine scope locked · {cuisineScope.label}</span>
          Compound chemistry isn&apos;t regional — scope does not filter this lens.
        </div>
      )}
      {form && overlayNote && (
        <div className="overlay-note">
          <span className="on-lbl">Form overlay · {form.name}</span>
          {overlayNote}
        </div>
      )}

      <div className="group">
        <div className="g-label">
          Shared volatile compounds{' '}
          <span className="posture p-doc">{resolution?.display || focusIngredient}</span>
        </div>

        <div className="compound-rows">
          {rows.map((row) => {
            const shared = row.top_shared_compounds || []
            const sentence = sharedCompoundSentence(shared)
            const open = openRow === row.match_vcf_product_id
            return (
              <div className="compound-row" key={row.match_vcf_product_id}>
                <div className="cr-head">
                  <Chip name={row.label} lens="compound" />
                  <span className="cr-shared">{row.shared_count} shared compounds</span>
                  {row.mixed_profile_source && (
                    <span className="chip-meta">mixed profile source</span>
                  )}
                </div>
                {sentence && <div className="cr-why">{sentence}.</div>}
                <button
                  type="button"
                  className="mini"
                  onClick={() => setOpenRow(open ? null : row.match_vcf_product_id)}
                >
                  {open ? 'Hide compounds' : 'Show compounds'}
                </button>
                {open && (
                  <div className="cr-detail">
                    <div className="g-label">Groups</div>
                    <div className="cr-groups">
                      {groupsFor(shared).map((g) => (
                        <span className="cr-group" key={g.group}>
                          {g.phrase} <span className="chip-meta">{g.count}</span>
                        </span>
                      ))}
                    </div>
                    <div className="g-label">Most distinctive compounds</div>
                    <ul className="cr-compounds">
                      {topCompounds(shared, { limit: 6 }).map((c) => (
                        <li key={c.compound_id || c.raw_compound}>
                          {c.raw_compound}
                          <span className="chip-meta">
                            {c.compound_group} · in {c.df_culinary} corpus ingredients
                            {c.descriptors?.length ? ` · ${c.descriptors[0]}` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )
          })}
          {status.kind === 'ok' && !rows.length && (
            <div className="no-modes">No shared-compound neighbours for this seed.</div>
          )}
        </div>
      </div>

      <div className="closer">
        Seeded from{' '}
        {dish.length ? 'the last ingredient on your plate' : `your focus — ${focusIngredient}`}.
        Rarer shared compounds count for more, so a long list of common ones ranks below a short
        list of distinctive ones.
      </div>
    </section>
  )
}
