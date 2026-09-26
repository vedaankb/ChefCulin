/**
 * Live reliability — API artifacts + optional OpenAI.
 *
 *   npm run demo          # in another terminal
 *   npm run test:reliability:live
 *
 * Skips when API is down. LLM checks skip without VITE_OPENAI_API_KEY.
 *
 * Step 10: those skips used to be quiet — describe.skipIf just omits the
 * block, vitest's own exit code stays 0 as long as nothing FAILED, so a
 * fully-skipped run (API down AND no LLM key) looked identical to a clean
 * pass to anything checking $?. The unconditional "no live checks were
 * silently skipped" test below turns that into a real, unmissable
 * assertion failure instead of a quietly-empty run — it always executes
 * (never behind skipIf), and fails loudly, naming exactly which group(s)
 * didn't run and why, whenever apiLive or llmLive is false.
 */
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as api from '../api.js'
import { openaiConfigured } from './openai.js'
import {
  assertAgentResult,
  makeTraditionToolHandler,
  openTraditionDb,
  optionsMatchCuisine,
} from './agentTestHelpers.js'
import { TRADITION_SYSTEM, traditionTools } from './agentTools/tradition.js'
import { runAgent } from './runAgent.js'
import {
  checkAssociateIntegrity,
  checkCooccurAnchors,
  checkCompoundAnchors,
  checkFormSchemaLive,
  checkHealth,
  checkVcfCompoundAnchors,
  formatReport,
} from './reliability/checks.js'
import { makeTraditionDbNode } from './reliability/traditionNode.js'

const BASE = process.env.CULIN_API || import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8001'

async function probe() {
  try {
    const url = BASE.startsWith('http') ? `${BASE}/health` : `http://127.0.0.1:8001/health`
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

const health = await probe()
const apiLive = Boolean(health)
const llmLive = openaiConfigured()

const SKIPPED_GROUPS = []
if (!apiLive) {
  SKIPPED_GROUPS.push(`live artifact API checks (API not reachable at ${BASE})`)
  console.log(`[reliability:live] API not reachable at ${BASE} — skipping live dataset checks.`)
}
if (!llmLive) {
  SKIPPED_GROUPS.push('live LLM/agent checks (VITE_OPENAI_API_KEY not set)')
  console.log('[reliability:live] VITE_OPENAI_API_KEY not set — skipping LLM/agent checks.')
}

const results = []
function record(r) {
  results.push(r)
  expect(r.ok, `${r.label}: ${r.detail}`).toBe(true)
}

// Always runs — this is what makes a partially- or fully-skipped run
// impossible to mistake for a clean one. If nothing is skipped, this is a
// one-line no-op pass; if something is, it fails with the exact list.
it('no live reliability check group was silently skipped', () => {
  const detail = SKIPPED_GROUPS.length
    ? `${SKIPPED_GROUPS.length} check group(s) did not run:\n` +
      SKIPPED_GROUPS.map((g) => `  - ${g}`).join('\n') +
      `\nRun 'npm run demo' for the API groups; set VITE_OPENAI_API_KEY ` +
      `for the LLM groups. This failure is the point: a skip must be ` +
      `loud, not a quiet green run.`
    : 'no groups skipped'
  expect(SKIPPED_GROUPS.length === 0, detail).toBe(true)
})

describe.skipIf(!apiLive)('reliability — live artifact API', () => {
  it('health and artifact scale', async () => {
    record(await checkHealth(api))
  })

  it('compound neighbors match flavor-network anchors', async () => {
    for (const r of await checkCompoundAnchors(api)) record(r)
  })

  it('VCF compound pairs match roasted / member-scoped anchors', async () => {
    for (const r of await checkVcfCompoundAnchors(api)) record(r)
  })

  it('corpus NPMI neighbors match RecipeNLG anchors', async () => {
    for (const r of await checkCooccurAnchors(api)) record(r)
  })

  it('associate merges three lenses without invented provenance', async () => {
    record(await checkAssociateIntegrity(api, { traditionDb: makeTraditionDbNode() }))
  })
})

describe.skipIf(!llmLive)('reliability — live LLM outputs', () => {
  it('form cards for Chicken are valid LLM JSON', async () => {
    record(await checkFormSchemaLive())
  }, 60_000)
})

describe.skipIf(!llmLive)('reliability — live agent + Tradition DB', () => {
  let handleTool

  beforeAll(async () => {
    const db = await openTraditionDb()
    handleTool = makeTraditionToolHandler(db)
  }, 60_000)

  it('agent option ids resolve in Tradition DB', async () => {
    const result = await runAgent({
      system: TRADITION_SYSTEM,
      user: 'documented chicken dishes from China',
      tools: traditionTools,
      handleTool,
    })
    assertAgentResult(result, { min: 2, max: 6 })
    const fails = []
    for (const o of result.options) {
      const detail = await handleTool('getDishDetail', { record_id: o.id })
      if (detail.error) fails.push(`${o.id}: ${detail.error}`)
    }
    if (!optionsMatchCuisine(result.options, 'China').length && !/china/i.test(result.rationale)) {
      fails.push('no China signal in options or rationale')
    }
    record({
      id: 'agent.tradition.china',
      label: 'Agent cards reference real Tradition records',
      ok: fails.length === 0,
      detail: fails.join('; ') || result.options.map((o) => o.title).join(', '),
    })
  }, 90_000)
})

afterAll(() => {
  if (results.length) console.log(formatReport(results))
  if (SKIPPED_GROUPS.length) {
    console.log(
      [
        '',
        '='.repeat(70),
        `RELIABILITY LIVE SUITE: ${SKIPPED_GROUPS.length} GROUP(S) SKIPPED — NOT A CLEAN GREEN RUN`,
        '='.repeat(70),
        ...SKIPPED_GROUPS.map((g) => `  SKIPPED: ${g}`),
        '='.repeat(70),
      ].join('\n')
    )
  }
})
