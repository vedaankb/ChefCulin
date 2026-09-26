/**
 * Shared helpers for Tradition agent option-card tests.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from 'vitest'
import initSqlJs from 'sql.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const TRADITION_DB_PATH = join(root, 'src/data/traditional_culinary_uses_database_v2.db')

export function assertOptionShape(option, { requireScore = false } = {}) {
  expect(option).toEqual(
    expect.objectContaining({
      id: expect.any(String),
      title: expect.any(String),
      subtitle: expect.any(String),
      score: expect.any(Number),
    })
  )
  expect(option.id.length).toBeGreaterThan(0)
  expect(option.title.length).toBeGreaterThan(0)
  if (requireScore) expect(option.score).toBeGreaterThan(0)
}

export function assertAgentResult(result, { min = 0, max = 8, allowEmpty = false } = {}) {
  expect(result).toHaveProperty('options')
  expect(result).toHaveProperty('rationale')
  expect(Array.isArray(result.options)).toBe(true)
  expect(typeof result.rationale).toBe('string')
  if (!allowEmpty) expect(result.options.length).toBeGreaterThanOrEqual(min)
  expect(result.options.length).toBeLessThanOrEqual(max)
  result.options.forEach((o) => assertOptionShape(o))
  const ids = result.options.map((o) => o.id)
  expect(new Set(ids).size).toBe(ids.length)
}

/** Load the Tradition SQLite file in Node (no Vite fetch). */
export async function openTraditionDb() {
  const SQL = await initSqlJs()
  return new SQL.Database(readFileSync(TRADITION_DB_PATH))
}

function cuisineSearchTerms(cuisine) {
  const raw = String(cuisine || '').trim()
  if (!raw) return []
  const lower = raw.toLowerCase()
  const aliases = {
    moroccan: 'Morocco',
    chinese: 'China',
    indian: 'India',
    japanese: 'Japan',
    italian: 'Italy',
    mexican: 'Mexico',
    french: 'France',
    spanish: 'Spain',
    korean: 'Korea',
    thai: 'Thailand',
    nigerian: 'Nigeria',
    brazilian: 'Brazil',
    turkish: 'Turkey',
    persian: 'Iran',
    iranian: 'Iran',
    lebanese: 'Lebanon',
    ethiopian: 'Ethiopia',
    german: 'Germany',
    greek: 'Greece',
    peruvian: 'Peru',
    american: 'United States',
  }
  const extra = aliases[lower]
  return extra ? [raw, extra] : [raw]
}

function rowsFrom(stmt) {
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

function runQuery(db, sql, params = []) {
  const stmt = db.prepare(sql)
  stmt.bind(params)
  return rowsFrom(stmt)
}

/** Tool handlers backed by a Node-loaded Tradition DB (mirrors agentTools/tradition.js). */
export function makeTraditionToolHandler(db) {
  return async function handleTraditionTool(name, args = {}) {
    if (name === 'searchDishes') {
      const where = []
      const params = []
      if (args.cuisine) {
        const terms = cuisineSearchTerms(args.cuisine)
        const clause = terms
          .map(() => '(LOWER(cuisine) LIKE LOWER(?) OR LOWER(country) LIKE LOWER(?))')
          .join(' OR ')
        where.push(`(${clause})`)
        for (const t of terms) {
          params.push(`%${t}%`, `%${t}%`)
        }
      }
      if (args.source_thread) {
        where.push('LOWER(source_thread) LIKE LOWER(?)')
        params.push(`%${args.source_thread}%`)
      }
      if (args.item_type) {
        where.push('LOWER(item_type) LIKE LOWER(?)')
        params.push(`%${args.item_type}%`)
      }
      if (args.keyword) {
        where.push(
          `(LOWER(item) LIKE LOWER(?) OR LOWER(use_or_dish) LIKE LOWER(?) OR LOWER(preparation_or_function) LIKE LOWER(?) OR LOWER(region_or_community) LIKE LOWER(?) OR LOWER(tags) LIKE LOWER(?))`
        )
        const k = `%${args.keyword}%`
        params.push(k, k, k, k, k)
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const limit = Math.min(Math.max(Number(args.limit) || 12, 1), 24)
      params.push(limit)
      return runQuery(
        db,
        `
        SELECT record_id, dish_id, cuisine, item, country,
               traditionality_class, traditionality_score, source_thread,
               region_or_community, preparation_or_function, confidence
        FROM use_records
        ${whereSql}
        ORDER BY COALESCE(traditionality_score, -1) DESC, item ASC
        LIMIT ?
        `,
        params
      )
    }
    if (name === 'getDishDetail') {
      const rows = args.record_id
        ? runQuery(db, 'SELECT * FROM use_records WHERE record_id = ? LIMIT 1', [args.record_id])
        : runQuery(db, 'SELECT * FROM use_records WHERE dish_id = ? LIMIT 1', [args.dish_id])
      const record = rows[0]
      if (!record) return { error: 'not_found' }
      const companions = runQuery(
        db,
        `SELECT ingredient_name FROM companion_ingredients WHERE dish_id = ?`,
        [record.dish_id]
      )
      return {
        ...record,
        companionIngredients: companions.map((c) => c.ingredient_name),
      }
    }
    throw new Error(`Unknown tradition tool: ${name}`)
  }
}

/**
 * Scripted OpenAI-shaped responses for runAgent unit tests.
 * Each entry is either a tool-call turn or a final content turn.
 */
export function scriptedLlmChat(script) {
  let i = 0
  return async function llmChat() {
    if (i >= script.length) throw new Error('LLM script exhausted')
    const turn = script[i]
    i += 1
    if (turn.tool_calls) {
      return {
        choices: [
          {
            message: {
              role: 'assistant',
              content: turn.content ?? null,
              tool_calls: turn.tool_calls.map((c, idx) => ({
                id: c.id || `call_${idx}`,
                type: 'function',
                function: {
                  name: c.name,
                  arguments:
                    typeof c.arguments === 'string'
                      ? c.arguments
                      : JSON.stringify(c.arguments || {}),
                },
              })),
            },
          },
        ],
      }
    }
    return {
      choices: [{ message: { role: 'assistant', content: turn.content } }],
    }
  }
}

/** Direct OpenAI chat completions for live tests (key from env). */
export async function openAiChat(body) {
  const { llmChat } = await import('./openai.js')
  return llmChat(body)
}

export function optionsMentionIngredient(options, ingredient) {
  const needle = String(ingredient).toLowerCase()
  return options.some(
    (o) =>
      o.title.toLowerCase().includes(needle) ||
      o.subtitle.toLowerCase().includes(needle) ||
      o.id.toLowerCase().includes(needle)
  )
}

export function optionsMatchCuisine(options, cuisineFragment) {
  const needle = String(cuisineFragment).toLowerCase()
  return options.filter((o) => o.subtitle.toLowerCase().includes(needle))
}
