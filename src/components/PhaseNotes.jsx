import { useEffect, useState } from 'react'
import { useWorkspace } from '../context/WorkspaceContext.jsx'
import * as api from '../api.js'
import { resolveIngredient } from '../lib/spineResolve.js'
import { dataOnlyLine, rankPhaseRows } from '../lib/phaseRender.js'

/**
 * Phase behaviour between things already on the plate (§2.5).
 *
 * Pair rows: competition.jsonl through /vcf/phase. Framed sentences verbatim;
 * data_only rows render shares and percentiles and stop.
 *
 * Dish-level: /vcf/phase/dish evaluates water_phase_dispersion_timing from
 * dominant_bucket across the plate. fat_phase_long_infusion stays dormant while
 * volatility claims are suppressed.
 */
export default function PhaseNotes() {
  const { dish } = useWorkspace()
  const [rows, setRows] = useState([])
  const [dishFrames, setDishFrames] = useState([])
  const [state, setState] = useState('idle')

  const dishKey = dish.map((d) => d.name).join('|')

  useEffect(() => {
    const resolved = dish
      .map((d) => resolveIngredient(d.name))
      .filter((r) => r.state === 'resolved' && r.member_id != null)

    if (!resolved.length) {
      setRows([])
      setDishFrames([])
      setState(dish.length ? 'need_more' : 'idle')
      return
    }

    let cancelled = false
    setState('loading')
    ;(async () => {
      try {
        const productIds = resolved.map((r) => r.member_id)
        const dishRes = await api.vcfPhaseDish(productIds).catch(() => null)
        if (cancelled) return
        setDishFrames(dishRes?.results || [])

        if (resolved.length < 2) {
          setRows([])
          setState(dishFramesOrOk(dishRes))
          return
        }

        const anchor = resolved[0]
        const others = resolved.slice(1)
        const results = await Promise.all(
          others.map((o) =>
            api.vcfPhase(anchor.member_id, { against: o.member_id, n: 8 }).catch(() => null)
          )
        )
        if (cancelled) return
        const merged = results.flatMap((r) => r?.results || [])
        setRows(rankPhaseRows(merged))
        setState('ok')
      } catch {
        if (!cancelled) {
          setRows([])
          setDishFrames([])
          setState('err')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [dishKey, dish])

  if (state === 'idle' || state === 'err') return null

  const hasPair = rows.length > 0
  const hasDish = dishFrames.length > 0

  return (
    <div className="phase-notes">
      <div className="g-label">Phase behaviour</div>

      <div className="lens-source">
        <span className="ls-lbl">Source</span>
        VCF phase-behaviour frames. Sentences are authored against a trigger; rows without one show
        measured shares only. Dish-level frames key on dominant phase across the plate.
      </div>

      {state === 'need_more' && !hasDish && (
        <div className="no-modes">Gather a second ingredient to compare phase behaviour.</div>
      )}
      {state === 'loading' && <div className="no-modes">Loading phase behaviour…</div>}
      {state === 'ok' && !hasPair && !hasDish && (
        <div className="no-modes">No phase-behaviour rows for this combination.</div>
      )}

      {dishFrames.map((r) => (
        <div className="phase-row" key={`dish-${r.frame_id}`}>
          <span className="pr-mode">Dish</span>
          <span className="pr-framed">{r.sentence}</span>
        </div>
      ))}

      {rows.slice(0, 6).map((r, i) => (
        <div className="phase-row" key={`${r.frame_id || 'data'}-${i}`}>
          <span className="pr-mode">{r.mode === 'framed' ? 'Framed' : 'Measured'}</span>
          {r.mode === 'framed' ? (
            <span className="pr-framed">{r.sentence}</span>
          ) : (
            <span>{dataOnlyLine(r) || 'Shares recorded, no comparable numbers.'}</span>
          )}
        </div>
      ))}
    </div>
  )
}

function dishFramesOrOk(dishRes) {
  return dishRes?.results?.length ? 'ok' : 'need_more'
}
