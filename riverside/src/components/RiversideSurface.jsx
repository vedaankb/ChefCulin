import { useWorkspace } from '@culin/context/WorkspaceContext.jsx'
import CompoundPane from '@culin/components/CompoundPane.jsx'
import TraditionPane from '@culin/components/TraditionPane.jsx'
import CooccurPane from '@culin/components/CooccurPane.jsx'
import AssociationPanel from '@culin/components/AssociationPanel.jsx'
import FormPane from '@culin/components/FormPane.jsx'
import BrainstormPane from '@culin/components/BrainstormPane.jsx'
import HealthPane from './HealthPane.jsx'

/* Brainstorm-first; Health is a full lens; Nestlé chemistry panes remain available. */
const TABS = [
  { k: 'b', label: 'Brainstorm', className: 'tab-b' },
  { k: 'h', label: 'Health', className: 'tab-h' },
  { k: 'a', label: 'Associate', className: 'tab-a' },
  { k: 'c', label: 'Compound', className: 'tab-c' },
  { k: 't', label: 'Tradition', className: 'tab-t' },
  { k: 'o', label: 'Co-occurrence', className: 'tab-o' },
  { k: 'f', label: 'Form', className: 'tab-f' },
]

export default function RiversideSurface() {
  const { activeLens, setActiveLens, chat, focusIngredient, diagnosticCodes } = useWorkspace()

  const chefline = (() => {
    const focus = focusIngredient
      ? `Brainstorming around ${focusIngredient}`
      : 'Choose a focus ingredient to start brainstorming'
    if (!diagnosticCodes.length) return `${focus}.`
    const labels = diagnosticCodes
      .slice(0, 2)
      .map((c) => c.code || c.name)
      .join(', ')
    const more = diagnosticCodes.length > 2 ? ` +${diagnosticCodes.length - 2}` : ''
    return `${focus} · ICD ${labels}${more}.`
  })()

  return (
    <main className="surface riverside-surface">
      <div className="chefline">{chefline}</div>
      <div className="lens-tabs">
        {TABS.map((t) => (
          <button
            key={t.k}
            type="button"
            className={`tab ${t.className}${activeLens === t.k ? ' on' : ''}`}
            onClick={() => setActiveLens(t.k)}
          >
            <span className="dot" />
            {t.label}
            {t.k === 'b' && chat.length > 0 && (
              <span className="tab-badge">{chat.length}</span>
            )}
            {t.k === 'h' && diagnosticCodes.length > 0 && (
              <span className="tab-badge">{diagnosticCodes.length}</span>
            )}
          </button>
        ))}
      </div>
      {activeLens === 'b' && <BrainstormPane />}
      {activeLens === 'h' && <HealthPane />}
      {activeLens === 'a' && <AssociationPanel />}
      {activeLens === 'c' && <CompoundPane />}
      {activeLens === 't' && <TraditionPane />}
      {activeLens === 'o' && <CooccurPane />}
      {activeLens === 'f' && <FormPane />}
    </main>
  )
}
