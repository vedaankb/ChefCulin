/**
 * Per-ingredient balance axes from FooDB Content (mg/100g) + volatile compounds.
 * Built by: npm run fetch:foodb && npm run build:balance
 */
import raw from './balance_axes.json'

const { meta, rows } = raw

const byNameLower = new Map()
for (const row of rows) {
  byNameLower.set(row.name.toLowerCase(), row)
}

export const BALANCE_META = meta

function balanceProfileFor(name) {
  if (!name) return null
  return byNameLower.get(String(name).toLowerCase()) || null
}

/** Normalised 0–1 axis scores for balance.js. */
export function axesForDb(name) {
  const row = balanceProfileFor(name)
  return row?.axes ? { ...row.axes } : {}
}

export function anchorProfileFor(name) {
  const axes = axesForDb(name)
  return {
    name: name || '',
    glut: axes.glut ?? 0,
    nucl: axes.nucl ?? 0,
    fat: axes.fat ?? 0,
  }
}
