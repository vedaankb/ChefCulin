import { useEffect, useRef, useState } from 'react'
import { useWorkspace } from '@culin/context/WorkspaceContext.jsx'
import { searchSpine, SPINE_PICKER_LIST } from '@culin/lib/spineResolve.js'

export default function RiversideMast() {
  const {
    focusIngredient,
    setFocusIngredient,
    cuisineScope,
    scopeMenuOpen,
    setScopeMenuOpen,
    regionPicks,
    lockCuisine,
    clearCuisine,
    lockCuisineFromInput,
    diagnosticCodes,
  } = useWorkspace()
  const [input, setInput] = useState('')
  const [focusQuery, setFocusQuery] = useState('')
  const [focusOpen, setFocusOpen] = useState(false)
  const ctrl = useRef(null)
  const focusCtrl = useRef(null)

  useEffect(() => {
    const onDoc = (e) => {
      if (ctrl.current && !ctrl.current.contains(e.target)) setScopeMenuOpen(false)
      if (focusCtrl.current && !focusCtrl.current.contains(e.target)) setFocusOpen(false)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [setScopeMenuOpen])

  const focusHits = searchSpine(focusQuery, { limit: 30 })

  return (
    <div className="mast riverside-mast">
      <div className="brand">
        Culin<span>AI</span>
        <span className="riverside-badge">Riverside</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <div className="focus-control">
          <span className="scope-lbl">Focus ingredient</span>
          <div className="mast-dropdown" ref={focusCtrl}>
            <button
              type="button"
              className="focus-btn"
              onClick={() => setFocusOpen((o) => !o)}
              aria-expanded={focusOpen}
            >
              {focusIngredient || 'Choose ingredient…'}
            </button>
            {focusOpen && (
              <div className="focus-menu">
                <input
                  type="search"
                  value={focusQuery}
                  autoFocus
                  placeholder={`Search ingredients (${SPINE_PICKER_LIST.length})…`}
                  onChange={(e) => setFocusQuery(e.target.value)}
                  aria-label="Search focus ingredient"
                />
                <div className="focus-hits">
                  {focusHits.map((hit) => (
                    <button
                      key={`${hit.spine_id}:${hit.member_id}`}
                      type="button"
                      className={`focus-hit${hit.label === focusIngredient ? ' on' : ''}`}
                      title={hit.product_group || ''}
                      onClick={() => {
                        setFocusIngredient(hit.label)
                        setFocusOpen(false)
                        setFocusQuery('')
                      }}
                    >
                      {hit.label}
                    </button>
                  ))}
                  {!focusHits.length && <div className="focus-empty">No matches</div>}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="scope-control mast-dropdown" ref={ctrl}>
          <button
            type="button"
            className={`scope-btn${cuisineScope ? ' locked' : ''}`}
            onClick={() => setScopeMenuOpen((o) => !o)}
          >
            <span className="scope-lbl">Cuisine scope</span>
            <span>{cuisineScope ? cuisineScope.label : 'None'}</span>
            {cuisineScope && (
              <span
                className="scope-x"
                onClick={(e) => {
                  e.stopPropagation()
                  clearCuisine()
                }}
              >
                ✕
              </span>
            )}
          </button>
          <div className={`scope-menu${scopeMenuOpen ? ' open' : ''}`}>
            <div className="scope-menu-lbl">Lock to a documented region</div>
            <div className="scope-picks">
              {regionPicks.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className="scope-pick"
                  onClick={() => lockCuisine(p.key, p.label)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="scope-input-row">
              <input
                type="text"
                value={input}
                placeholder="e.g. India, Malabar…"
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    lockCuisineFromInput(input)
                    setInput('')
                  }
                }}
              />
              <button
                type="button"
                onClick={() => {
                  lockCuisineFromInput(input)
                  setInput('')
                }}
              >
                Lock
              </button>
            </div>
          </div>
        </div>
        {diagnosticCodes.length > 0 && (
          <div
            className="riverside-icd-summary"
            title={diagnosticCodes.map((c) => `${c.code} ${c.name}`).join('\n')}
          >
            {diagnosticCodes.length} ICD
          </div>
        )}
      </div>
    </div>
  )
}
