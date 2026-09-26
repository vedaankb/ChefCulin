import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { COLORS, FRAMES, PROP_LABELS, modesFor, INGREDIENT_LIST, anchorFor } from '../data/domain.js'
import { getFrame, getOverlayNote } from '../lib/frameRegistry.js'
import { fetchFormCards } from '../lib/formSuggestions.js'
import { listRegionPicks, matchTraditionRegion } from '../lib/traditionDb.js'
import { BALANCE_DECISIONS, computeBalance, phaseOf } from '../lib/balance.js'
import { localUserId } from '../lib/user.js'
import * as api from '../api.js'
import {
  buildWriteUp,
  directions,
  matchFrame,
  observations,
} from '../lib/chat.js'
import { runChat } from '../lib/runAgent.js'

const BRAINSTORM_SYSTEM = `You are CulinAI, a working culinary collaborator in a chef's dish workspace.
You help arrange and think about ingredients the chef has already gathered. You never invent a shopping list or choose ingredients for them unless they explicitly ask you to brainstorm possibilities — and even then, frame them as options, not decisions.
Be concise, concrete, and honest. Prefer short paragraphs. If the dish is empty, say so and invite them to gather from the lenses first.
Current plate context is provided in the latest user turn when available.`

const RIVERSIDE_BRAINSTORM_SYSTEM = `You are CulinAI for a clinical nutrition brainstorm workspace (Riverside Health).
You help clinicians and care teams explore food ideas in light of ICD-coded conditions and chemistry evidence. You never prescribe treatment or claim medical outcomes. Frame chemistry↔disease links as corpus evidence (MeSH / FoodAtlas), not clinical proof.
Be concise and concrete. Prefer options and questions over directives. When ICD conditions are listed in context, keep them in view while talking about the plate.
Current plate and condition context is provided in the latest user turn when available.`

const WorkspaceContext = createContext(null)

export function WorkspaceProvider({
  children,
  initialFocus = null,
  initialLens = 'c',
  variant = 'nestle',
}) {
  const [dish, setDish] = useState([])
  const [dishName, setDishName] = useState('')
  const [form, setForm] = useState(null)
  const [focusIngredient, setFocusIngredient] = useState(initialFocus)
  const [cuisineScope, setCuisineScope] = useState(null)
  const [activeLens, setActiveLens] = useState(initialLens)
  const [openIdx, setOpenIdx] = useState(null)
  const [openWhy, setOpenWhy] = useState(() => new Set())
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false)
  const [chat, setChat] = useState([])
  const [diagnosticCodes, setDiagnosticCodes] = useState([])
  const [regionPicks, setRegionPicks] = useState([])
  const [formCatalog, setFormCatalog] = useState({
    loading: false,
    forms: [],
    source: null,
    error: null,
    rationale: null,
  })
  /* E5 — working balance decisions. Session only: this never leaves memory.
     Palate Memory (POST /palate) is written by F6 Save and nothing else. */
  const [balanceDecisions, setBalanceDecisions] = useState([])
  /* F6 — the one place this app writes to Postgres. */
  const [saveState, setSaveState] = useState({ status: 'idle', signature: null, error: null })
  const [kept, setKept] = useState({ loading: true, rows: [], error: null })

  const anchor = useMemo(() => anchorFor(focusIngredient), [focusIngredient])
  const balance = useMemo(() => computeBalance(dish, form, anchor), [dish, form, anchor])
  const phase = useMemo(() => phaseOf(dish), [dish])

  const push = useCallback((who, content) => {
    setChat((c) => [...c, { who, content }])
  }, [])

  const addIngredient = useCallback((name, lens) => {
    setDish((d) => {
      if (d.find((x) => x.name === name)) return d
      return [...d, { name, lens, mode: null, modeNote: null, axAdd: null }]
    })
  }, [])

  const removeIngredient = useCallback((name) => {
    setDish((d) => d.filter((x) => x.name !== name))
    setOpenIdx(null)
  }, [])

  const removeAt = useCallback((i) => {
    setDish((d) => {
      const next = d.slice()
      next.splice(i, 1)
      return next
    })
    setOpenIdx(null)
  }, [])

  const openModes = useCallback((i) => {
    setOpenIdx((cur) => (cur === i ? null : i))
  }, [])

  const setMode = useCallback((i, mi) => {
    setDish((d) => {
      const next = d.slice()
      const item = { ...next[i] }
      const modes = modesFor(item.name)
      if (!modes) return d
      const m = modes[mi]
      item.mode = m.mode
      item.modeNote = m.note
      item.axAdd = m.axAdd
      next[i] = item
      return next
    })
    setOpenIdx(null)
  }, [])

  const duplicateInFixed = useCallback((i) => {
    setDish((d) => {
      const src = d[i]
      const next = [
        ...d,
        { name: src.name, lens: src.lens, mode: null, modeNote: null, axAdd: null },
      ]
      setOpenIdx(next.length - 1)
      return next
    })
  }, [])

  /**
   * E5 — record what the chef did with the active balance flag.
   *
   * Appends to session state and returns the entry. It deliberately calls no
   * API: acknowledging a trend is a working note, not a kept dish. Anything
   * that should survive the session goes through F6 Save → POST /palate.
   */
  const recordBalanceDecision = useCallback(
    (decision, trend = balance.primaryTrend) => {
      if (!trend || !BALANCE_DECISIONS.includes(decision)) return null
      const entry = {
        axis: trend.axis,
        pair: trend.pair,
        decision,
        share: trend.share,
        at: new Date().toISOString(),
        dishSnapshot: dish.map((d) => d.name),
      }
      setBalanceDecisions((log) => [...log, entry])
      return entry
    },
    [balance, dish]
  )

  /* The latest decision covering this trend on the dish as it stands now.
     Change the dish and the flag comes back — the chef is answering about a
     different plate. */
  const balanceDecisionFor = useCallback(
    (trend) => {
      if (!trend) return null
      const key = dish.map((d) => d.name).join('|')
      for (let i = balanceDecisions.length - 1; i >= 0; i -= 1) {
        const e = balanceDecisions[i]
        if (e.axis === trend.axis && e.dishSnapshot.join('|') === key) return e
      }
      return null
    },
    [balanceDecisions, dish]
  )

  /* F6 — identity of the exact plate in front of the chef. Save is answered
     against this, so editing anything re-arms the button rather than leaving a
     stale "saved" badge over a dish that has since changed. */
  const dishSignature = useMemo(
    () =>
      JSON.stringify({
        d: dish.map((x) => `${x.name}:${x.mode || ''}`),
        f: form?.name || null,
        s: cuisineScope?.keys?.join(',') || null,
        focus: focusIngredient,
        name: dishName?.trim() || null,
      }),
    [cuisineScope, dish, dishName, form, focusIngredient]
  )
  const savedNow = saveState.status === 'saved' && saveState.signature === dishSignature
  const discardedNow = saveState.status === 'discarded' && saveState.signature === dishSignature

  const refreshKept = useCallback(async () => {
    try {
      const res = await api.listPalate(localUserId(), 50)
      setKept({ loading: false, rows: res.results || [], error: null })
    } catch (err) {
      setKept({ loading: false, rows: [], error: err?.message || String(err) })
    }
  }, [])

  useEffect(() => {
    refreshKept()
  }, [refreshKept])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const picks = await listRegionPicks({ limit: 24 })
        if (!cancelled) setRegionPicks(picks)
      } catch {
        if (!cancelled) setRegionPicks([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!focusIngredient) {
      setFormCatalog({ loading: false, forms: [], source: null, error: null, rationale: null })
      return
    }
    let cancelled = false
    setFormCatalog((c) => ({ ...c, loading: true, error: null }))
    ;(async () => {
      const res = await fetchFormCards(focusIngredient)
      if (cancelled) return
      setFormCatalog({
        loading: false,
        forms: res.forms || [],
        source: res.source,
        error: res.error || null,
        rationale: res.rationale || null,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [focusIngredient])

  /**
   * F6 Save — the only thing in this app that writes to Postgres.
   *
   * Commits a snapshot of the plate: ingredients, their forms, the frame and the
   * cuisine scope. Balance decisions (E5) are deliberately NOT sent — they are
   * working notes, and persisting them is out of scope for that board.
   */
  const saveDish = useCallback(async () => {
    if (!dish.length) return null
    setSaveState({ status: 'saving', signature: dishSignature, error: null })
    try {
      const row = await api.savePalate({
        user_id: localUserId(),
        dish: dish.map((d) => ({ name: d.name, lens: d.lens, mode: d.mode })),
        form: form ? { name: form.name, desc: form.desc } : null,
        cuisine_scope: cuisineScope
          ? { label: cuisineScope.label, keys: cuisineScope.keys }
          : null,
        source: 'f6',
      })
      setSaveState({ status: 'saved', signature: dishSignature, error: null, id: row?.id })
      refreshKept()
      return row
    } catch (err) {
      setSaveState({
        status: 'error',
        signature: dishSignature,
        error: err?.message || String(err),
      })
      return null
    }
  }, [cuisineScope, dish, dishSignature, form, refreshKept])

  /** F6 Discard — deliberately no write, mirroring `PalateStore.discard()`. */
  const discardDish = useCallback(() => {
    setSaveState({ status: 'discarded', signature: dishSignature, error: null })
  }, [dishSignature])

  const commitForm = useCallback((name, desc) => {
    setForm((f) => (f && f.name === name ? null : { name, desc }))
  }, [])

  const clearForm = useCallback(() => setForm(null), [])

  useEffect(() => {
    if (!form || !formCatalog.forms.length) return
    const allowed = formCatalog.forms.some((c) => c.name === form.name)
    if (!allowed) setForm(null)
  }, [focusIngredient, form, formCatalog.forms])

  const lockCuisine = useCallback((key, label) => {
    const keys = key.split(',')
    setCuisineScope((cur) => {
      if (cur && cur.keys.join(',') === keys.join(',')) return null
      return { label, keys }
    })
    setScopeMenuOpen(false)
  }, [])

  const clearCuisine = useCallback(() => {
    setCuisineScope(null)
    setScopeMenuOpen(false)
  }, [])

  const lockCuisineFromInput = useCallback(
    async (raw) => {
      const text = raw.trim()
      if (!text) return
      setScopeMenuOpen(false)
      const match = await matchTraditionRegion(text)
      if (match) lockCuisine(match.keys.join(','), match.label)
      else {
        setActiveLens('b')
        push('me', { type: 'text', text: `Cuisine scope: ${text}` })
        const known = regionPicks.map((p) => p.label).join(', ')
        push('sys', {
          type: 'blocks',
          blocks: [
            {
              type: 'p',
              html: false,
              text: `No documented thread exists yet for ${text} — locking it would show you an empty result, or worse, a guessed one, and neither is honest.`,
            },
            {
              type: 'p',
              text: known
                ? `What's actually documented right now: ${known}. If ${text} is close to one of these, say which — otherwise this stays open until a real thread is authored.`
                : `No cuisine regions loaded from the Tradition database yet.`,
            },
            {
              type: 'ask',
              text: 'Lock one of the documented regions instead, or keep browsing without a scope?',
            },
          ],
        })
      }
    },
    [lockCuisine, push, regionPicks]
  )

  const toggleWhy = useCallback((id) => {
    setOpenWhy((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const respond = useCallback(
    (qRaw) => {
      const q = qRaw.toLowerCase()
      const scopeCmd = q.match(/^(?:lock|cuisine scope|scope)\s*(?:to|:)?\s+(.+)/)
      if (scopeCmd) {
        const raw = scopeCmd[1].trim()
        void (async () => {
          const match = await matchTraditionRegion(raw)
          if (match) {
            lockCuisine(match.keys.join(','), match.label)
            push('sys', {
              type: 'blocks',
              blocks: [
                {
                  type: 'p',
                  text: `Locked to ${match.label}. Tradition threads are flagged accordingly — nothing is hidden, and compound and co-occurrence stay fully unfiltered.`,
                },
              ],
            })
          } else {
            lockCuisineFromInput(raw)
          }
        })()
        return
      }

      const frameMatch = matchFrame(q)
      if (frameMatch && dish.length === 0) {
        const desc = FRAMES[frameMatch]
          ? Object.entries(PROP_LABELS)
              .filter(([k]) => FRAMES[frameMatch].produces.includes(k))
              .map(([, v]) => v)
              .slice(0, 2)
              .join('; ')
          : ''
        commitForm(frameMatch, desc || frameMatch)
        push('sys', {
          type: 'blocks',
          blocks: [
            {
              type: 'p',
              text: `Set the form to ${frameMatch} — you can see it under the Form tab, and change your mind any time by clicking it again. Ingredients still gather however you like; this just answers what state ${focusIngredient} is in, not what's in the dish.`,
            },
          ],
        })
        return
      }

      if (dish.length === 0) {
        push('sys', {
          type: 'blocks',
          blocks: [
            {
              type: 'p',
              text: "Nothing gathered yet — and I won't pick for you. Choosing the ingredients is the creative act, and it's yours. Work through the lenses, pull what interests you, and then we can talk about what to do with it.",
            },
          ],
        })
        return
      }

      if (/suggest|direction|idea|what could|options|not sure|help me/.test(q)) {
        const D = directions(dish, anchor)
        if (!D) {
          push('sys', {
            type: 'blocks',
            blocks: [
              {
                type: 'p',
                text: `You have ${dish.length} ingredient${dish.length > 1 ? 's' : ''}. That's not really a set yet — anything I suggested would be me designing the dish, not arranging yours.`,
              },
              { type: 'p', text: 'Pull a few more and the arrangement question gets real.' },
            ],
          })
          return
        }
        push('sys', {
          type: 'blocks',
          blocks: [
            {
              type: 'p',
              text: `Here are ${D.length} directions. They are genuinely different dishes, not variations — and I'm not ranking them.`,
            },
            ...D.map((d) => ({ type: 'dir', ...d })),
            { type: 'ask', text: "Which of these is closest to what you're seeing?" },
          ],
        })
        return
      }

      if (/missing|lacking|need|gap|absent/.test(q)) {
        const o = observations(dish, anchor).filter((x) =>
          /Nothing here catches|There is no reset|No textural/.test(x)
        )
        if (!o.length) {
          push('sys', {
            type: 'blocks',
            blocks: [
              {
                type: 'p',
                text: "Nothing structural is missing — you have savoury depth, a reset, and a carrier. What's left is arrangement, not addition.",
              },
            ],
          })
          return
        }
        push('sys', {
          type: 'blocks',
          blocks: [
            ...o.map((t) => ({ type: 'p', text: t })),
            { type: 'ask', text: 'None of these is a problem unless you think it is.' },
          ],
        })
        return
      }

      if (/write|recipe|outline|summar|describe|done|finish/.test(q)) {
        push('sys', { type: 'writeup', ...buildWriteUp(dish, form, anchor) })
        return
      }

      const o = observations(dish, anchor)
      if (!o.length) {
        push('sys', {
          type: 'blocks',
          blocks: [
            {
              type: 'p',
              text: "Nothing is jumping out. Tell me what you're trying to make it feel like and I'll tell you what's in the way.",
            },
          ],
        })
        return
      }
      push('sys', {
        type: 'blocks',
        blocks: [
          ...o.slice(0, 3).map((t) => ({ type: 'p', text: t })),
          {
            type: 'ask',
            text: 'Any of that useful, or are you working toward something specific?',
          },
        ],
      })
    },
    [commitForm, dish, form, focusIngredient, anchor, lockCuisine, lockCuisineFromInput, push, regionPicks]
  )

  const sendChat = useCallback(
    (txt) => {
      const text = (txt || '').trim()
      if (!text) return
      push('me', { type: 'text', text })

      /* Local command path (scope lock / empty-frame shortcuts) — sync. */
      const q = text.toLowerCase()
      const scopeCmd = q.match(/^(?:lock|cuisine scope|scope)\s*(?:to|:)?\s+(.+)/)
      const frameMatch = matchFrame(q)
      if (scopeCmd || (frameMatch && dish.length === 0)) {
        setTimeout(() => respond(text), 200)
        return
      }

      /* Default: OpenAI via backend proxy. Falls back to local respond on failure. */
      const history = []
      /* Include prior turns; current user message is appended separately below. */
      for (const m of chat) {
        const role = m.who === 'me' ? 'user' : 'assistant'
        const content =
          m.content?.type === 'text'
            ? m.content.text
            : m.content?.type === 'blocks'
              ? (m.content.blocks || []).map((b) => b.text).filter(Boolean).join('\n')
              : null
        if (content) history.push({ role, content })
      }

      const plate = dish.length
        ? `Designing around ${focusIngredient}. Plate right now: ${dish
            .map((d) => (d.mode ? `${d.name} (${d.mode})` : d.name))
            .join(', ')}${form ? `. Form: ${form.name}` : ''}${
            cuisineScope ? `. Cuisine scope: ${cuisineScope.label}` : ''
          }.`
        : `Designing around ${focusIngredient}. Plate is empty — nothing gathered yet.`

      const conditions =
        diagnosticCodes.length > 0
          ? ` ICD conditions in scope: ${diagnosticCodes
              .map((c) => `${c.name}${c.code ? ` (${c.code})` : ''}`)
              .join('; ')}.`
          : ''

      const system =
        variant === 'riverside' ? RIVERSIDE_BRAINSTORM_SYSTEM : BRAINSTORM_SYSTEM

      ;(async () => {
        try {
          const reply = await runChat({
            system,
            messages: [
              ...history,
              {
                role: 'user',
                content: `${plate}${conditions}\n\n${
                  variant === 'riverside' ? 'User' : 'Chef'
                }: ${text}`,
              },
            ],
          })
          push('sys', { type: 'text', text: reply })
        } catch (err) {
          push('sys', {
            type: 'blocks',
            blocks: [
              {
                type: 'p',
                text: `LLM unavailable (${err?.message || err}). Set VITE_OPENAI_API_KEY in .env and restart npm run dev.`,
              },
            ],
          })
        }
      })()
    },
    [chat, cuisineScope, diagnosticCodes, dish, focusIngredient, form, push, respond, variant]
  )

  const tensionFor = useCallback(
    (requires) => {
      const frame = form ? getFrame(form.name) : null
      if (!frame || !requires?.length) return null
      const absent = new Set(frame.absent || [])
      const hits = requires.filter((r) => absent.has(r))
      if (!hits.length) return null
      return {
        form: form.name,
        missing: hits.map((h) => PROP_LABELS[h] || h),
      }
    },
    [form]
  )

  const overlayNote = useMemo(() => {
    if (!form) return null
    return getOverlayNote(form.name)
  }, [form])

  const value = {
    dish,
    dishName,
    setDishName,
    form,
    focusIngredient,
    setFocusIngredient,
    ingredientList: INGREDIENT_LIST,
    anchor,
    cuisineScope,
    activeLens,
    setActiveLens,
    openIdx,
    openWhy,
    scopeMenuOpen,
    setScopeMenuOpen,
    chat,
    diagnosticCodes,
    setDiagnosticCodes,
    variant,
    balance,
    balanceDecisions,
    recordBalanceDecision,
    balanceDecisionFor,
    saveDish,
    discardDish,
    saveState,
    savedNow,
    discardedNow,
    kept,
    refreshKept,
    phase,
    colors: COLORS,
    regionPicks,
    formCatalog,
    addIngredient,
    removeIngredient,
    removeAt,
    openModes,
    setMode,
    duplicateIn: duplicateInFixed,
    commitForm,
    clearForm,
    lockCuisine,
    clearCuisine,
    lockCuisineFromInput,
    toggleWhy,
    sendChat,
    tensionFor,
    overlayNote,
    modesFor,
  }

  return (
    <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
  )
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace outside provider')
  return ctx
}
