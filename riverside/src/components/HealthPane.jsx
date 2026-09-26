import { useCallback, useEffect, useState } from 'react'
import { useWorkspace } from '@culin/context/WorkspaceContext.jsx'
import * as api from '@culin/api.js'

/**
 * Riverside Health lens — ICD-10-CM picker + MeSH compound_disease evidence.
 * Drill-through to Compound keeps the Nestlé-style chemistry breakdown available.
 */
export default function HealthPane() {
  const {
    dish,
    focusIngredient,
    addIngredient,
    setActiveLens,
    diagnosticCodes,
    setDiagnosticCodes,
  } = useWorkspace()

  const [query, setQuery] = useState('')
  const [icdHits, setIcdHits] = useState([])
  const [icdLoading, setIcdLoading] = useState(false)
  const [icdError, setIcdError] = useState(null)

  const [plateDiseases, setPlateDiseases] = useState(null)
  const [plateLoading, setPlateLoading] = useState(false)
  const [plateError, setPlateError] = useState(null)

  const [conditionView, setConditionView] = useState(null)
  const [conditionLoading, setConditionLoading] = useState(false)
  const [conditionError, setConditionError] = useState(null)

  const toggleCode = useCallback(
    (code) => {
      setDiagnosticCodes((prev) => {
        const exists = prev.some((c) => c.code === code.code)
        if (exists) return prev.filter((c) => c.code !== code.code)
        return [...prev, code]
      })
    },
    [setDiagnosticCodes]
  )

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setIcdHits([])
      setIcdError(null)
      setIcdLoading(false)
      return undefined
    }
    let cancelled = false
    const t = setTimeout(async () => {
      setIcdLoading(true)
      setIcdError(null)
      try {
        const res = await api.icdSearch(q, 20)
        if (!cancelled) setIcdHits(res.results || [])
      } catch (err) {
        if (!cancelled) {
          setIcdHits([])
          setIcdError(err?.message || String(err))
        }
      } finally {
        if (!cancelled) setIcdLoading(false)
      }
    }, 280)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query])

  const plateNames = dish.map((d) => d.name).filter(Boolean)
  const plateKey = plateNames.join('|')
  const seed = focusIngredient || plateNames[0] || null

  useEffect(() => {
    if (!seed) {
      setPlateDiseases(null)
      setPlateError(null)
      setPlateLoading(false)
      return undefined
    }
    let cancelled = false
    ;(async () => {
      setPlateLoading(true)
      setPlateError(null)
      try {
        const res = await api.healthDiseases(seed, 30)
        if (!cancelled) setPlateDiseases(res)
      } catch (err) {
        if (!cancelled) {
          setPlateDiseases(null)
          setPlateError(err?.message || String(err))
        }
      } finally {
        if (!cancelled) setPlateLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [seed])

  useEffect(() => {
    if (!diagnosticCodes.length) {
      setConditionView(null)
      setConditionError(null)
      setConditionLoading(false)
      return undefined
    }
    const primary = diagnosticCodes[diagnosticCodes.length - 1]
    const exclude = plateKey ? plateKey.split('|') : []
    let cancelled = false
    ;(async () => {
      setConditionLoading(true)
      setConditionError(null)
      try {
        const res = await api.healthByCondition({
          name: primary.name,
          code: primary.code,
          n: 24,
          exclude,
        })
        if (!cancelled) setConditionView({ code: primary, ...res })
      } catch (err) {
        if (!cancelled) {
          setConditionView(null)
          setConditionError(err?.message || String(err))
        }
      } finally {
        if (!cancelled) setConditionLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [diagnosticCodes, plateKey])

  return (
    <section className="pane pane-h on">
      <p className="pane-intro">
        ICD-10-CM conditions in scope, bridged by <em>name</em> onto MeSH disease labels in the
        compound–disease corpus. This is not a curated ICD↔MeSH crosswalk — treat matches as
        leads, then open <strong>Compound</strong> for the Nestlé-style chemistry breakdown.
      </p>

      <div className="health-layout">
        <div className="health-col">
          <h3 className="health-h">ICD-10-CM</h3>
          <input
            type="search"
            className="health-search"
            value={query}
            placeholder="Search codes or condition names…"
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search ICD-10-CM"
          />
          {icdLoading && <div className="notice">Searching NLM…</div>}
          {icdError && <div className="notice err">{icdError}</div>}
          {diagnosticCodes.length > 0 && (
            <div className="health-chips">
              {diagnosticCodes.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  className="health-chip on"
                  aria-label={`Remove ${c.code} ${c.name}`}
                  onClick={() => toggleCode(c)}
                  title="Remove"
                >
                  <span className="mono">{c.code}</span> {c.name}
                </button>
              ))}
            </div>
          )}
          <div className="health-icd-list">
            {icdHits.map((hit) => {
              const on = diagnosticCodes.some((c) => c.code === hit.code)
              return (
                <button
                  key={hit.code}
                  type="button"
                  className={`health-icd-row${on ? ' on' : ''}`}
                  onClick={() => toggleCode(hit)}
                >
                  <span className="mono">{hit.code}</span>
                  <span>{hit.name}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="health-col">
          <h3 className="health-h">
            From condition
            {conditionView?.code?.code ? (
              <span className="health-sub mono"> {conditionView.code.code}</span>
            ) : null}
          </h3>
          {!diagnosticCodes.length && (
            <div className="notice">Select an ICD code to name-match MeSH diseases and related ingredients.</div>
          )}
          {conditionLoading && <div className="notice">Matching MeSH diseases…</div>}
          {conditionError && <div className="notice err">{conditionError}</div>}
          {conditionView && (
            <>
              <p className="health-note">{conditionView.note}</p>
              <div className="health-matched">
                {(conditionView.matched_diseases || []).slice(0, 6).map((d) => (
                  <div key={d.disease_id || d.disease_name} className="health-match-row">
                    <span>{d.disease_name}</span>
                    <span className="mono dim">
                      {d.disease_external_id} · {d.match_score}
                    </span>
                  </div>
                ))}
              </div>
              <h4 className="health-h4">Suggested ingredients</h4>
              <div className="health-ings">
                {(conditionView.results || []).map((r) => (
                  <button
                    key={r.ingredient}
                    type="button"
                    className="health-ing"
                    onClick={() => addIngredient(r.ingredient, 'health')}
                    title={(r.sample_compounds || []).map((c) => c.compound_name).join(', ')}
                  >
                    <span>{r.ingredient}</span>
                    <span className="dim">
                      {r.n_compounds} cmp · {r.n_attestations} att
                    </span>
                  </button>
                ))}
                {!conditionView.results?.length && (
                  <div className="notice">No culinary ingredients ranked for these MeSH hits.</div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="health-col">
          <h3 className="health-h">
            From plate
            {seed ? <span className="health-sub"> · {seed}</span> : null}
          </h3>
          {!seed && (
            <div className="notice">Pick a focus ingredient (or add to the plate) to see MeSH disease links.</div>
          )}
          {plateLoading && <div className="notice">Loading disease associations…</div>}
          {plateError && <div className="notice err">{plateError}</div>}
          {plateDiseases && (
            <>
              <p className="health-note">{plateDiseases.note}</p>
              <div className="health-diseases">
                {(plateDiseases.results || []).map((d) => (
                  <div key={d.disease_id || d.disease_name} className="health-disease">
                    <div className="health-disease-head">
                      <strong>{d.disease_name}</strong>
                      <span className="mono dim">{d.disease_external_id}</span>
                    </div>
                    <div className="health-disease-meta dim">
                      {d.n_compounds} compounds · {d.n_attestations} attestations
                      {d.direction_counts
                        ? ` · ${Object.entries(d.direction_counts)
                            .map(([k, v]) => `${k}:${v}`)
                            .join(' ')}`
                        : ''}
                    </div>
                    <div className="health-compounds">
                      {(d.compounds || []).map((c) => (
                        <span key={c.compound_id} className="health-compound mono">
                          {c.compound_name || c.compound_id}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                {!plateDiseases.results?.length && (
                  <div className="notice">No MeSH disease rows for this profile&apos;s compounds.</div>
                )}
              </div>
            </>
          )}
          <button type="button" className="health-drill" onClick={() => setActiveLens('c')}>
            Open Compound breakdown →
          </button>
        </div>
      </div>
    </section>
  )
}
