import { anchorFor, axesFor } from '../data/domain.js'
import { getFrame } from './frameRegistry.js'

/**
 * Trending detection (E4) — fixed, non-adaptive.
 *
 * ONE share definition, used for every axis and for the bar widths:
 *
 *     share(axis) = axisTotal / n        where n = dish.length + 1
 *
 * `n` counts contributors on the plate: gathered ingredients plus the focus
 * anchor when a focus ingredient is set. No phantom anchor at an empty start.
 * This is the same normalisation `widths` already used, so a bar drawn at 40%
 * and a trend that fires at 0.4 are literally the same number — there is no
 * second scale to reconcile.
 *
 * ONE threshold for every axis. The old per-axis numbers (0.4 acid, 0.45 salt,
 * 0.55 fat) are gone. Nothing here reads Palate Memory or adapts to the chef —
 * adaptive thresholds are G3 and are deliberately not built. See
 * docs/trending-detection.md.
 */
export const TREND_THRESHOLD = 0.4

/** FooDB-normalised score at or above this counts as axis presence for trend flags. */
const AXIS_PRESENCE = 0.2

function axisPresence(value) {
  return (Number(value) || 0) >= AXIS_PRESENCE ? 1 : 0
}

/**
 * The only corrective pairs in the MVP. A trend may suggest nothing else.
 *
 * `counter` is the axis whose total answers "is this already offset?" — a trend
 * fires only when the counterweight is carrying strictly less than the axis
 * that is trending. That generalises the old "acidic with little to offset it"
 * guard to every axis instead of hand-tuning each one.
 */
export const TREND_PAIRS = {
  acid: {
    pair: 'sweet',
    counter: 'sweet',
    suggestion: 'Trending acidic — reach for sweetness to offset it, or a drying, tannic reset.',
    note: 'Sugars suppress perceived tartness and acids suppress perceived sweetness — a documented mutual suppression. Or reach for a drying, tannic reset instead.',
  },
  sweet: {
    pair: 'acid',
    counter: 'acid',
    suggestion: 'Trending sweet — acid is the counterweight that keeps it from reading flat.',
    note: 'The suppression runs both ways: acid pulls perceived sweetness down as reliably as sugar pulls perceived tartness down.',
  },
  salt: {
    pair: 'fat',
    counter: 'fat',
    suggestion: 'Trending salty — fat is the counterweight here.',
    note: 'Fat suppresses perceived saltiness — only free sodium ions reach the receptor, and fat impedes their release from the matrix. Note this runs one way only.',
  },
  fat: {
    pair: 'acid',
    counter: 'acid',
    suggestion: 'Trending rich — acid is the reset.',
    note: 'Sourness brightens; astringency dries — different mechanisms, so which do you want? Salt will not cut this; that pair only runs the other way.',
  },
  /* Heat is measured on the capsaicin total alone, not on the combined heat bar.
     Fat and dairy mute capsaicin because it is lipophilic; they do nothing for
     volatile (isothiocyanate) or trigeminal pungency, so those must never
     produce a fat/dairy suggestion. */
  heat: {
    pair: 'dairy',
    counter: 'fat',
    suggestion: 'Trending hot — fat or dairy is the correction that actually works on capsaicin.',
    note: 'Capsaicin is lipophilic — fat and dairy genuinely mute it. This is the one pungency where that works.',
  },
}

/** Tie-break order when two axes trend at the same share. */
const AXIS_ORDER = ['heat', 'acid', 'salt', 'fat', 'sweet']

/** E5 — the three things a chef can do with a flag. Session vocabulary only. */
export const BALANCE_DECISIONS = ['accept', 'adjust', 'override']

/** Short chef-facing name per axis, for the flag headline. */
export const AXIS_LABELS = {
  acid: 'Acid',
  sweet: 'Sweet',
  salt: 'Salt',
  fat: 'Fat',
  heat: 'Heat',
  umami: 'Umami',
}

/** Pure balance model for the dish sidebar. */
const EMPTY_BALANCE = {
  widths: { umami: 0, salt: 0, fat: 0, acid: 0, sweet: 0, heat: 0 },
  shares: { umami: 0, salt: 0, fat: 0, acid: 0, sweet: 0, heat: 0, capsaicin: 0 },
  synergyOn: false,
  synGhost: null,
  umamiLabel: 'Umami',
  heatLabel: 'Heat',
  heatResolved: false,
  umamiResolved: false,
  trends: [],
  primaryTrend: null,
  notes: [],
  flaggedAxes: [],
  msgClass: 'bal-gate',
  msg: 'Gather ingredients or set a form to start the balance read.',
}

export function computeBalance(dish, form, anchor = anchorFor(null)) {
  if (!dish.length && !form) {
    return { ...EMPTY_BALANCE }
  }

  const hasFocus = Boolean(anchor?.name)
  const frame = form ? getFrame(form.name) : null
  const base = frame ? frame.fat : hasFocus ? (anchor.fat ?? 0) : 0
  const t = {
    glut: hasFocus ? (anchor.glut ?? 0) : 0,
    nucl: hasFocus ? (anchor.nucl ?? 0) : 0,
    salt: 0,
    fat: base,
    acid: 0,
    sweet: 0,
    capsaicin: 0,
    pungent: 0,
    trigeminal: 0,
  }
  const presence = {
    glut: axisPresence(t.glut),
    nucl: axisPresence(t.nucl),
    salt: 0,
    fat: axisPresence(base),
    acid: 0,
    sweet: 0,
    capsaicin: 0,
    pungent: 0,
    trigeminal: 0,
  }
  if (frame?.produces?.includes('salt-cured')) {
    t.salt += 1
    presence.salt += 1
  }

  if (hasFocus) {
    const focusAx = axesFor(anchor.name)
    for (const k of ['salt', 'acid', 'sweet', 'capsaicin', 'pungent', 'trigeminal']) {
      if (focusAx[k]) {
        t[k] += focusAx[k]
        presence[k] += axisPresence(focusAx[k])
      }
    }
  }

  dish.forEach((d) => {
    const baseAx = axesFor(d.name)
    for (const k in baseAx) {
      if (k in t) {
        t[k] += baseAx[k]
        presence[k] += axisPresence(baseAx[k])
      }
    }
    const add = d.axAdd || {}
    for (const k in add) {
      if (k in t) {
        t[k] += add[k]
        presence[k] += axisPresence(add[k])
      }
    }
  })

  const n = dish.length + (hasFocus ? 1 : 0)
  if (n === 0) {
    return { ...EMPTY_BALANCE }
  }
  const umamiHave = t.glut > 0 ? t.glut / n : 0
  const synergyOn = presence.glut > 0 && presence.nucl > 0

  const mechs = [
    { k: 'capsaicin', label: 'Capsaicin', v: t.capsaicin },
    { k: 'pungent', label: 'Volatile', v: t.pungent },
    { k: 'trigeminal', label: 'Tingling', v: t.trigeminal },
  ].filter((m) => m.v > 0)

  let heatTotal = 0
  let heatLabel = 'Heat'
  let heatResolved = false
  let heatNote = null
  if (mechs.length === 1) {
    heatTotal = mechs[0].v
    heatLabel = mechs[0].label
    heatResolved = true
    if (mechs[0].k === 'capsaicin')
      heatNote = {
        ax: 'heat',
        note: TREND_PAIRS.heat.note,
      }
    if (mechs[0].k === 'pungent')
      heatNote = {
        ax: 'heat',
        note: 'Volatile pungency — isothiocyanates, from wasabi, horseradish or mustard. Nasal rather than oral, and it dissipates. Fat does essentially nothing here; it simply leaves.',
      }
    if (mechs[0].k === 'trigeminal')
      heatNote = {
        ax: 'heat',
        note: 'This is trigeminal, not heat. Sanshool tingles and numbs; ginger warms. It is not burning, and balancing it with fat would do nothing — there is nothing to cut.',
      }
  } else if (mechs.length > 1) {
    heatTotal = mechs.reduce((a, m) => a + m.v, 0)
    heatLabel = mechs.map((m) => m.label).join(' + ')
    heatResolved = true
    heatNote = {
      ax: 'heat',
      note:
        'Two different pungency mechanisms are in play — ' +
        mechs.map((m) => m.label.toLowerCase()).join(' and ') +
        '. They do not compound with each other and they do not respond to the same correction. Fat mutes capsaicin only.',
    }
  }

  /* Axis totals the trend rule reads. `heat` is the capsaicin total only — see
     TREND_PAIRS.heat. The heat *bar* still shows every mechanism combined. */
  const totals = {
    salt: presence.salt,
    fat: presence.fat,
    acid: presence.acid,
    sweet: presence.sweet,
    heat: presence.capsaicin,
  }
  const shares = {
    umami: umamiHave,
    salt: totals.salt / n,
    fat: totals.fat / n,
    acid: totals.acid / n,
    sweet: totals.sweet / n,
    heat: heatTotal / n,
    capsaicin: totals.heat / n,
  }

  const widths = {
    umami: Math.min(100, umamiHave * 100 * (synergyOn ? 2.2 : 1)),
    salt: Math.min(100, shares.salt * 100),
    fat: Math.min(100, shares.fat * 100),
    acid: Math.min(100, shares.acid * 100),
    sweet: Math.min(100, shares.sweet * 100),
    heat: Math.min(100, shares.heat * 100),
  }

  const synGhost =
    !synergyOn && t.glut > 0
      ? {
          left: Math.min(100, umamiHave * 100),
          width: Math.min(100 - umamiHave * 100, umamiHave * 100 * 1.2),
        }
      : null

  const shape = {
    widths,
    shares,
    synergyOn,
    synGhost,
    umamiLabel: synergyOn ? 'Umami ×' : 'Umami',
    heatLabel,
    heatResolved,
    umamiResolved: synergyOn,
  }

  /* Balance check begins at 3 ingredients: below that a single acidic pickle is
     half the plate by share, and the flag would be an artefact of the divisor. */
  if (dish.length < 3) {
    return {
      ...shape,
      trends: [],
      primaryTrend: null,
      notes: [],
      flaggedAxes: [],
      msgClass: 'bal-gate',
      msg: `Balance check begins at 3 ingredients. (${dish.length}/3)`,
    }
  }

  /* Mechanism notes — context, not corrections. These carry no pair and are
     never actionable, so they are kept out of `trends`. */
  const notes = []
  const plateGlutPresent = dish.some((d) => {
    const ax = axesFor(d.name)
    return axisPresence(ax.glut) || axisPresence((d.axAdd || {}).glut)
  })
  const anchorLabel = anchor.name || 'the focus ingredient'
  if (plateGlutPresent && axisPresence(anchor.nucl ?? 0)) {
    notes.push({
      ax: 'umami',
      note: `${anchorLabel} already brings a nucleotide baseline — a glutamate ingredient added here is not accumulating umami, it is amplifying it: glutamate plus nucleotide is roughly an order of magnitude, not a sum. This is the dashi principle.`,
    })
  } else if (hasFocus && axisPresence(anchor.nucl ?? 0) && !plateGlutPresent) {
    notes.push({
      ax: 'umami',
      note: `${anchorLabel} carries inosinate but little free glutamate. The hatched bar is the amplification sitting unclaimed — a glutamate source (miso, soy, aged cheese, tomato, kombu) multiplies savoury depth far beyond what another meaty ingredient would.`,
    })
  }
  if (heatNote) notes.push(heatNote)

  /* One rule, every axis: share >= 0.4 and the paired counterweight is carrying
     strictly less than the axis that is trending. */
  const trends = AXIS_ORDER.map((axis) => {
    const spec = TREND_PAIRS[axis]
    const total = totals[axis]
    const share = total / n
    if (share < TREND_THRESHOLD) return null
    if (totals[spec.counter] >= total) return null
    return {
      axis,
      trend: 'high',
      share,
      pair: spec.pair,
      suggestion: spec.suggestion,
      note: spec.note,
    }
  })
    .filter(Boolean)
    .sort((a, b) => b.share - a.share || AXIS_ORDER.indexOf(a.axis) - AXIS_ORDER.indexOf(b.axis))

  const primaryTrend = trends[0] || null

  /* The trend card already renders the primary trend's own mechanism text, so
     the prose slot shows the first note that is about a *different* axis. */
  const msgNote = notes.find((x) => x.ax !== primaryTrend?.axis) || null

  if (!primaryTrend && !msgNote) {
    return {
      ...shape,
      trends,
      primaryTrend,
      notes,
      flaggedAxes: [],
      msgClass: 'bal-gate',
      msg: 'Nothing trending. Keep building.',
    }
  }

  const flaggedAxes = [primaryTrend?.axis, msgNote?.ax].filter(Boolean)
  return {
    ...shape,
    trends,
    primaryTrend,
    notes,
    flaggedAxes,
    msgClass: msgNote ? 'bal-note' : 'bal-gate',
    msg: msgNote ? msgNote.note : null,
  }
}

export function phaseOf(dish) {
  const formed = dish.filter((d) => d.mode).length
  const total = dish.length
  if (!total) {
    return {
      className: 'phase search',
      label: 'Gathering',
      text: 'Pull ingredients from the lenses. Give them forms whenever you are ready — or not at all.',
    }
  }
  if (formed < total) {
    return {
      className: 'phase compose',
      label: 'Composing',
      text: `${formed} of ${total} have a form. An ingredient can appear more than once — charred beneath, raw on top.`,
    }
  }
  return {
    className: 'phase done',
    label: 'Every element has a form',
    text: 'Nothing here says the dish is finished. That is your call.',
  }
}
