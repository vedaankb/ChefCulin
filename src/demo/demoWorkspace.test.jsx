/**
 * Demo workspace — render every surface a chef hits in a walkthrough.
 * API, Tradition DB and agent are mocked so `npm test` is self-contained.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../App.jsx'

const api = vi.hoisted(() => ({
  listPalate: vi.fn(async () => ({ results: [] })),
  savePalate: vi.fn(),
  health: vi.fn(async () => ({
    ok: true,
    cooccur_edges: 69477,
    technique_edges: 10439,
    palate_db: false,
  })),
  cooccur: vi.fn(async (seed) => ({
    canonical: seed,
    results: [
      { ingredient: 'onion', confidence: 0.4, freq: 900 },
      { ingredient: 'thyme', confidence: 0.72, freq: 400 },
      { ingredient: 'orange', confidence: 0.55, freq: 220 },
      { ingredient: 'salt', confidence: 0.9, freq: 2000 },
    ],
  })),
  vcfPairs: vi.fn(async (opts = {}) => ({
    spine_id: opts.spineId || 'culin:coffee',
    product_id: opts.productId || 157,
    scope: opts.productId != null ? 'product' : 'spine',
    source: 'pairs',
    count: 2,
    mixed_profile_source_count: 0,
    results: [
      {
        match_vcf_product_id: 400,
        match_raw_name: 'PORK (Sus scrofa L.)',
        rank: 1,
        score: 0.187,
        shared_count: 255,
        top_shared_compounds: [
          { compound_id: 'p1', raw_compound: '2-methylpyrazine', compound_group: 'Bases', df_culinary: 40, idf: 2.6 },
        ],
      },
      {
        match_vcf_product_id: 401,
        match_raw_name: 'MALT',
        rank: 2,
        score: 0.158,
        shared_count: 187,
        top_shared_compounds: [
          { compound_id: 'm1', raw_compound: 'furfural', compound_group: 'Furans', df_culinary: 12, idf: 3.8 },
        ],
      },
    ],
  })),
  vcfForms: vi.fn(async () => ({ spine_id: 'culin:coffee', coverage: 'single_form', count: 0, results: [] })),
  vcfPhase: vi.fn(async () => ({ product_id: 0, count: 0, n_framed: 0, results: [] })),
  vcfPhaseDish: vi.fn(async () => ({ product_ids: [], count: 0, results: [] })),
  compound: vi.fn(async (seed) => ({
    canonical: 'chicken',
    results: [
      { ingredient: 'roasted_beef', display: 'Roasted Beef', weight: 100, confidence: 0.44 },
      { ingredient: 'pork_sausage', display: 'Pork Sausage', weight: 84, confidence: 0.37 },
      { ingredient: 'white_wine', display: 'White Wine', weight: 53, confidence: 0.23 },
    ],
  })),
  techniques: vi.fn(async () => ({
    results: [{ technique: 'roast', confidence: 0.6, freq: 80 }],
  })),
}))

const openai = vi.hoisted(() => ({
  llmChat: vi.fn(),
  openaiConfigured: vi.fn(() => true),
}))

vi.mock('../api.js', () => api)

vi.mock('../lib/openai.js', () => openai)

vi.mock('../lib/matchRecipeNlg.js', () => ({
  matchRecipeNlg: vi.fn(async (name) => ({
    canonical: String(name || 'chicken')
      .toLowerCase()
      .replace(/cattle \(beef, veal\)/i, 'beef')
      .replace(/sweet orange/i, 'orange')
      .trim(),
    source: 'test',
  })),
  heuristicRecipeNlg: (name) => String(name || 'chicken').toLowerCase(),
}))

vi.mock('../lib/runAgent.js', () => ({
  runAgent: vi.fn(async () => ({
    options: [
      {
        id: 'R0001',
        title: 'Kung Pao Chicken',
        subtitle: 'China — Core / emblematic',
        score: 4,
      },
      {
        id: 'R0002',
        title: 'Beggar\'s Chicken',
        subtitle: 'China — Established',
        score: 3,
      },
      {
        id: 'R0003',
        title: 'Dapanji',
        subtitle: 'China — Established',
        score: 3,
      },
    ],
    rationale: 'Documented Chinese chicken dishes from the Tradition DB.',
  })),
  runChat: vi.fn(async () => 'Keep the chicken as the plate; let acid reset between bites.'),
  parseAgentResult: vi.fn(),
}))

vi.mock('../lib/traditionDb.js', () => ({
  getDishDetail: vi.fn(async ({ record_id }) => ({
    record_id,
    dish_id: 'CHN_demo',
    item: 'Kung Pao Chicken',
    cuisine: 'China',
    traditionality_class: 'Core / emblematic',
    companionIngredients: ['peanut', 'chili', 'scallion'],
    preparation_or_function: 'Stir-fried chicken with chili and peanut.',
    historical_or_cultural_note: null,
    primary_source_url: 'https://example.test',
    wikipedia_url: null,
    source_thread: 'Sichuan',
    country: 'China',
    region_or_community: 'Sichuan',
  })),
  getTraditionAssociation: vi.fn(async (seed) => ({
    seed,
    candidates: [
      {
        name: 'peanut',
        lens: 'tradition',
        reason: 'Sichuan',
        meta: { inScope: null, engaged: false, hits: 0 },
      },
      {
        name: 'scallion',
        lens: 'tradition',
        reason: 'Sichuan',
        meta: { inScope: null, engaged: false, hits: 0 },
      },
    ],
    threads: [{ title: 'Sichuan', thread: 'Sichuan', inScope: null, engaged: false, hits: [] }],
  })),
  searchDishes: vi.fn(async () => []),
  bestTraditionMatches: vi.fn(async () => [
    {
      id: 'R0001',
      title: 'Kung Pao Chicken',
      subtitle: 'China — Core / emblematic',
      score: 4,
      plateHits: 2,
    },
    {
      id: 'R0002',
      title: "Beggar's Chicken",
      subtitle: 'China — Established',
      score: 3,
      plateHits: 1,
    },
    {
      id: 'R0003',
      title: 'Dapanji',
      subtitle: 'China — Established',
      score: 3,
      plateHits: 1,
    },
  ]),
  listRegionPicks: vi.fn(async () => [
    { key: 'china', label: 'China', dish_count: 120 },
    { key: 'mexico', label: 'Mexico', dish_count: 80 },
  ]),
  matchTraditionRegion: vi.fn(async (text) =>
    /china/i.test(text) ? { label: 'China', keys: ['china'] } : null
  ),
}))

const demoFormPayload = {
  rationale: 'Chicken centrepiece frames.',
  forms: [
    {
      name: 'Seared',
      title: 'Seared — surface browning, intact piece',
      desc: 'High heat, surface browning.',
      craft: [
        { k: 'Texture', v: 'browned exterior' },
        { k: 'Temp', v: 'hot, rested' },
        { k: 'Sauce', v: 'pan jus' },
      ],
      balance: { produces: ['crisp-skin'], absent: ['long-cook'], overlay: 'sear', fat: 0.75 },
    },
    {
      name: 'Confit',
      title: 'Confit — fat as cooking medium',
      desc: 'Slow cook in fat.',
      craft: [
        { k: 'Texture', v: 'spoon-tender' },
        { k: 'Temp', v: 'reheated or crisped' },
        { k: 'Sauce', v: 'fat is the medium' },
      ],
      balance: { produces: ['tender'], absent: ['crisp-skin'], overlay: 'confit', fat: 0.95 },
    },
  ],
}

import { runChat } from '../lib/runAgent.js'
import { bestTraditionMatches, getDishDetail } from '../lib/traditionDb.js'

beforeEach(() => {
  vi.clearAllMocks()
  api.listPalate.mockResolvedValue({ results: [] })
  openai.llmChat.mockImplementation(async (body) => {
    const sys = body?.messages?.[0]?.content || ''
    if (String(sys).includes('preparation frames')) {
      return { choices: [{ message: { content: JSON.stringify(demoFormPayload) } }] }
    }
    return { choices: [{ message: { content: 'ok' } }] }
  })
})

afterEach(cleanup)

function renderApp(focus = 'Chicken') {
  return render(<App initialFocus={focus} />)
}

describe('demo shell', () => {
  it('renders masthead, focus picker, cuisine scope, sidebar and Compound first', () => {
    renderApp()
    expect(screen.getByText(/Culin/)).toBeTruthy()
    expect(screen.getByText('Focus ingredient')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Chicken' })).toBeTruthy()
    expect(screen.getByText('Cuisine scope')).toBeTruthy()
    expect(screen.getByText(/Designing a dish around Chicken/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Untitled — Chicken/ })).toBeTruthy()
    expect(document.querySelector('.pane-c')).toBeTruthy()
    ;['Compound', 'Tradition', 'Co-occurrence', 'Associate', 'Form', 'Brainstorm'].forEach(
      (label) => {
        expect(screen.getByRole('button', { name: new RegExp(label) })).toBeTruthy()
      }
    )
  })

  it('focus picker searches the Foodb list and can switch the workspace', async () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Chicken' }))
    const search = screen.getByLabelText('Search focus ingredient')
    fireEvent.change(search, { target: { value: 'Garlic' } })
    const hit = await screen.findByRole('button', { name: 'Garlic' })
    fireEvent.click(hit)
    expect(await screen.findByText(/Designing a dish around Garlic/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Untitled — Garlic/ })).toBeTruthy()
  })

  it('locks a documented cuisine scope from the menu', async () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: /Cuisine scope/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'China' }))
    expect(screen.getAllByText('China').length).toBeGreaterThan(0)
  })
})

describe('demo Compound lens', () => {
  it('loads shared-compound neighbours from the VCF pairs table', async () => {
    renderApp('Coffee')
    expect(screen.getAllByText(/shared volatile compounds/i).length).toBeGreaterThan(0)
    expect(await screen.findByText('Pork')).toBeTruthy()
    expect(api.vcfPairs).toHaveBeenCalled()
    // Resolution happens before the fetch — member-scoped product id, not the cluster alone.
    expect(api.vcfPairs.mock.calls[0][0].spineId).toMatch(/^culin:/)
    expect(api.vcfPairs.mock.calls[0][0].productId).toEqual(expect.any(Number))
  })

  it('names compound families instead of the similarity score', async () => {
    renderApp('Coffee')
    expect(await screen.findByText(/pyrazines and pyridines/)).toBeTruthy()
    expect(screen.queryByText(/0\.187/)).toBeNull()
  })

  it('gathers a neighbour onto the plate', async () => {
    renderApp('Coffee')
    const chip = await screen.findByText('Pork')
    fireEvent.click(chip.closest('.chip'))
    expect(document.querySelectorAll('.ing').length).toBe(1)
    expect(document.querySelector('.ing-n').textContent).toBe('Pork')
  })

  it('says plainly that chicken has no compound data rather than showing nothing', async () => {
    // Avian is staged, not ingested — the corpus genuinely has no chicken.
    renderApp('Chicken')
    expect(await screen.findByText(/No VCF compound data/)).toBeTruthy()
    expect(api.vcfPairs).not.toHaveBeenCalled()
  })
})

describe('demo Form lens', () => {
  it('commits a process frame to the sidebar', async () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: /^Form$/ }))
    expect(await screen.findByText(/Preparation states for Chicken/)).toBeTruthy()
    expect(await screen.findByText(/Seared — surface browning/)).toBeTruthy()
    expect(screen.getByText(/Confit — fat as cooking medium/)).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Commit this form' })[0])
    expect(screen.getAllByText('Committed').length).toBeGreaterThan(0)
    expect(document.querySelector('.fcard')).toBeTruthy()
    expect(document.querySelector('.fn').textContent).toBe('Seared')
  })
})

describe('demo Tradition lens', () => {
  it('auto-loads the five best tradition matches for the focus', async () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: /^Tradition$/ }))
    expect(await screen.findByText('Kung Pao Chicken')).toBeTruthy()
    expect(screen.getByText("Beggar's Chicken")).toBeTruthy()
    expect(screen.getByText('Dapanji')).toBeTruthy()
    expect(bestTraditionMatches).toHaveBeenCalled()
    const arg = bestTraditionMatches.mock.calls[0][0]
    expect(arg.focus).toBe('Chicken')
    expect(arg.limit).toBe(5)
  })

  it('selecting a card reads the dish without touching the plate', async () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: /^Tradition$/ }))
    fireEvent.click(await screen.findByText('Kung Pao Chicken'))

    await waitFor(() => expect(getDishDetail).toHaveBeenCalledWith({ record_id: 'R0001' }))
    expect(await screen.findByText('Companions on the dish')).toBeTruthy()
    expect(document.querySelectorAll('.ing').length).toBe(0)
  })

  it('adds companion ingredients only on the explicit add-all action', async () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: /^Tradition$/ }))
    fireEvent.click(await screen.findByText('Kung Pao Chicken'))

    await waitFor(() => expect(getDishDetail).toHaveBeenCalledWith({ record_id: 'R0001' }))
    fireEvent.click(await screen.findByRole('button', { name: /Add all \d+ to the dish/ }))
    await waitFor(() =>
      expect(document.querySelectorAll('.ing').length).toBeGreaterThanOrEqual(3)
    )
    expect([...document.querySelectorAll('.ing-n')].map((n) => n.textContent)).toEqual(
      expect.arrayContaining(['peanut', 'chili', 'scallion'])
    )
  })
})

describe('demo Co-occurrence lens', () => {
  it('loads corpus neighbors for the focus seed and filters hubs', async () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: /^Co-occurrence$/ }))
    expect(await screen.findByText(/Live corpus/)).toBeTruthy()
    expect(api.cooccur).toHaveBeenCalled()
    expect(screen.getByText('thyme')).toBeTruthy()
    expect(screen.getByText('orange')).toBeTruthy()
    expect(screen.queryByText('salt')).toBeNull()
    expect(screen.getByText('roast')).toBeTruthy()
  })
})

describe('demo Associate lens', () => {
  it('merges lenses around the current focus', async () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: /^Associate$/ }))
    expect(await screen.findByText(/Three lenses answering/)).toBeTruthy()
    expect(screen.getAllByText(/Where the lenses converge/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Chemistry alone|Tradition alone|Corpus alone/).length).toBeGreaterThan(0)
  })
})

describe('demo Brainstorm', () => {
  it('sends a plate-aware chat turn through the LLM', async () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: /^Brainstorm$/ }))
    const input = screen.getByPlaceholderText(/Ask, think out loud/)
    fireEvent.change(input, { target: { value: 'What do you notice?' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText(/Keep the chicken as the plate/)).toBeTruthy()
    expect(runChat).toHaveBeenCalled()
  })
})

describe('demo sidebar', () => {
  it('Save is idle with an empty plate', () => {
    renderApp()
    expect(screen.getByText('Nothing to keep yet.')).toBeTruthy()
    expect(screen.getByText(/Nothing gathered yet/)).toBeTruthy()
  })

  it('keeps gathered ingredients when switching lenses', async () => {
    renderApp('Coffee')
    const chip = await screen.findByText('Pork')
    fireEvent.click(chip.closest('.chip'))
    fireEvent.click(screen.getByRole('button', { name: /^Form$/ }))
    expect(document.querySelectorAll('.ing').length).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: /^Compound$/ }))
    expect(document.querySelector('.ing-n').textContent).toBe('Pork')
  })
})

describe('demo Co-occurrence errors', () => {
  it('explains how to start the corpus API when it is down', async () => {
    api.cooccur.mockRejectedValueOnce(new Error('Failed to fetch'))
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: /^Co-occurrence$/ }))
    expect(await screen.findByText(/Corpus API unreachable/)).toBeTruthy()
    expect(screen.getByText(/npm run api/)).toBeTruthy()
  })
})
