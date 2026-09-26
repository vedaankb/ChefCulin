import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import { cuisineSearchTerms, plateTokensFromNames, traditionSearchTokens } from './traditionDb.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const dbPath = join(root, 'src/data/traditional_culinary_uses_database_v2.db')

/**
 * Node smoke test for the Tradition schema + query shapes used by traditionDb.js.
 * Loads the same .db via sql.js without going through the Vite fetch URL path.
 */
describe('traditionDb (sql.js smoke)', () => {
  let db

  beforeAll(async () => {
    const SQL = await initSqlJs()
    const filebuffer = readFileSync(dbPath)
    db = new SQL.Database(filebuffer)
  })

  it('opens active use_records at demo_9 scale', () => {
    const total = db.exec('SELECT COUNT(*) AS c FROM use_records')[0].values[0][0]
    const active = db.exec(
      "SELECT COUNT(*) AS c FROM use_records WHERE COALESCE(canon_status, 'active') = 'active'"
    )[0].values[0][0]
    expect(total).toBe(502)
    expect(active).toBe(486)
  })

  it('searchDishes-shaped query returns Sichuan-ish chicken rows when keyword matches', () => {
    const stmt = db.prepare(`
      SELECT record_id, dish_id, cuisine, item, traditionality_score
      FROM use_records
      WHERE LOWER(cuisine) LIKE LOWER(?)
        AND (LOWER(item) LIKE LOWER(?) OR LOWER(use_or_dish) LIKE LOWER(?))
      ORDER BY traditionality_score DESC, item ASC
      LIMIT ?
    `)
    stmt.bind(['%China%', '%chicken%', '%chicken%', 6])
    const rows = []
    while (stmt.step()) {
      const [record_id, dish_id, cuisine, item, traditionality_score] = stmt.get()
      rows.push({ record_id, dish_id, cuisine, item, traditionality_score })
    }
    stmt.free()
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].record_id).toMatch(/^R/)
  })

  it('getDishDetail companions resolve for a known dish_id', () => {
    const dish = db.exec(
      `SELECT dish_id FROM use_records WHERE cuisine = 'China' LIMIT 1`
    )[0].values[0][0]
    const stmt = db.prepare(
      `SELECT ingredient_name FROM companion_ingredients WHERE dish_id = ?`
    )
    stmt.bind([dish])
    const names = []
    while (stmt.step()) names.push(stmt.get()[0])
    stmt.free()
    expect(names.length).toBeGreaterThan(0)
  })

  it('getTraditionAssociation-shaped query returns tradition neighbors', () => {
    const stmt = db.prepare(`
      SELECT ci2.ingredient_name AS name, COUNT(DISTINCT ci2.dish_id) AS dish_count
      FROM companion_ingredients ci1
      JOIN companion_ingredients ci2
        ON ci1.dish_id = ci2.dish_id AND ci1.ingredient_name != ci2.ingredient_name
      WHERE LOWER(ci1.ingredient_name) = LOWER(?)
      GROUP BY ci2.ingredient_name
      ORDER BY dish_count DESC
      LIMIT 8
    `)
    stmt.bind(['chicken'])
    const rows = []
    while (stmt.step()) {
      const [name, dish_count] = stmt.get()
      rows.push({ name, dish_count })
    }
    stmt.free()
    expect(rows.length).toBeGreaterThan(0)
  })

  it('olive focus hits fruit dishes, not aioli cooked in oil', () => {
    // Mirrors tokenWhereClause companion arm: role gate + oil-medium exclusion.
    const stmt = db.prepare(`
      SELECT DISTINCT ur.item
      FROM use_records ur
      JOIN companion_ingredients ci ON ci.dish_id = ur.dish_id
      WHERE COALESCE(ur.canon_status, 'active') = 'active'
        AND LOWER(ci.ingredient_name) LIKE ?
        AND LOWER(COALESCE(ci.role_in_dish,'')) IN ('main','seasoning','aromatic','ingredient')
        AND (? LIKE '%oil%' OR (
          LOWER(COALESCE(ci.ingredient_name,'')) NOT LIKE '% oil%'
          AND LOWER(COALESCE(ci.ingredient_name,'')) NOT LIKE '%oil %'
          AND LOWER(COALESCE(ci.ingredient_name,'')) NOT LIKE 'oil%'
        ))
      ORDER BY ur.item
    `)
    stmt.bind(['%olive%', 'olive'])
    const items = []
    while (stmt.step()) items.push(stmt.get()[0])
    stmt.free()
    expect(items).toEqual(expect.arrayContaining(["Olive all'ascolana", 'Oliva Ascolana del Piceno']))
    expect(items).not.toContain('Aioli')
    expect(items).not.toContain('Baba ghanoush')
    expect(items).not.toContain('Bouillabaisse')
    expect(items).not.toContain('Caesar salad')
    expect(items).not.toContain('Fava (Santorini split-pea puree)')
  })

  it('olive oil focus hits fat-medium dishes, not olive fruit alone', () => {
    const roles = ['main', 'seasoning', 'aromatic', 'ingredient', 'fat']
    const placeholders = roles.map(() => '?').join(', ')
    const stmt = db.prepare(`
      SELECT DISTINCT ur.item
      FROM use_records ur
      JOIN companion_ingredients ci ON ci.dish_id = ur.dish_id
      WHERE COALESCE(ur.canon_status, 'active') = 'active'
        AND LOWER(ci.ingredient_name) LIKE ?
        AND LOWER(COALESCE(ci.role_in_dish,'')) IN (${placeholders})
        AND (? LIKE '%oil%' OR (
          LOWER(COALESCE(ci.ingredient_name,'')) NOT LIKE '% oil%'
          AND LOWER(COALESCE(ci.ingredient_name,'')) NOT LIKE '%oil %'
          AND LOWER(COALESCE(ci.ingredient_name,'')) NOT LIKE 'oil%'
        ))
      ORDER BY ur.item
    `)
    stmt.bind(['%olive oil%', ...roles, 'olive oil'])
    const items = []
    while (stmt.step()) items.push(stmt.get()[0])
    stmt.free()
    expect(items.length).toBeGreaterThan(5)
    expect(items).toEqual(expect.arrayContaining(['Bouillabaisse', 'Ful medames']))
    // Fruit-only olive dishes (no oil companion) stay out.
    expect(items).not.toContain("Olive all'ascolana")
  })
})

describe('fat / oil medium focus helpers', () => {
  it('flags oil carriers without inventing ingredient rows', async () => {
    const { isOilMediumName, isFatMediumFocus, rolesForFocus, focusSearchTokens } = await import(
      './traditionDb.js'
    )
    expect(isOilMediumName('olive oil')).toBe(true)
    expect(isOilMediumName('extra virgin olive oil')).toBe(true)
    expect(isOilMediumName('black olives')).toBe(false)
    expect(isOilMediumName('olives')).toBe(false)

    expect(isFatMediumFocus('olive oil')).toBe(true)
    expect(isFatMediumFocus('butter')).toBe(true)
    expect(isFatMediumFocus('ghee')).toBe(true)
    expect(isFatMediumFocus('olive')).toBe(false)
    expect(isFatMediumFocus('garlic')).toBe(false)

    expect(rolesForFocus('olive')).not.toContain('fat')
    expect(rolesForFocus('olive oil')).toContain('fat')
    expect(rolesForFocus('butter')).toContain('fat')

    expect(focusSearchTokens('olive oil')).toEqual(['olive oil'])
    expect(focusSearchTokens('olive oil')).not.toContain('olive')
    expect(focusSearchTokens('olive oil')).not.toContain('oil')
    expect(focusSearchTokens('olive')).toContain('olive')
    expect(focusSearchTokens('butter')).toEqual(expect.arrayContaining(['butter']))
  })
})

describe('cuisineSearchTerms', () => {
  it('maps adjective cuisines to the country stored in the DB', () => {
    expect(cuisineSearchTerms('Moroccan')).toEqual(['Moroccan', 'Morocco'])
    expect(cuisineSearchTerms('Chinese')).toEqual(['Chinese', 'China'])
    expect(cuisineSearchTerms('China')).toEqual(['China'])
  })
})

describe('traditionSearchTokens', () => {
  it('splits Foodb names into searchable tokens', () => {
    expect(traditionSearchTokens(['Chicken', 'Garlic'])).toEqual(
      expect.arrayContaining(['chicken', 'garlic'])
    )
    expect(traditionSearchTokens(['Cattle (Beef, Veal)'])).toEqual(
      expect.arrayContaining(['beef'])
    )
  })
})

describe('plateTokensFromNames', () => {
  it('excludes focus tokens from plate ranking', () => {
    expect(plateTokensFromNames('Chicken', ['Chicken', 'Garlic'])).toEqual(['garlic'])
    expect(plateTokensFromNames('Chicken', ['Garlic', 'Rice'])).toEqual(
      expect.arrayContaining(['garlic', 'rice'])
    )
  })
})
