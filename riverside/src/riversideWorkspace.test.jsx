/**
 * Riverside workspace — the walk a clinician actually takes.
 * API, tradition DB and the LLM are mocked. Assertions are about behavior:
 * default lens, ICD selection, MeSH transparency, plate updates, brainstorm
 * context, and drill-through into the Nestlé Compound pane.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App.jsx'

const runChat = vi.hoisted(() => vi.fn(async () => 'Consider tomato with the diabetes evidence in view.'))

const api = vi.hoisted(() => ({
  listPalate: vi.fn(async () => ({ results: [] })),
  savePalate: vi.fn(),
  health: vi.fn(async () => ({ ok: true })),
  cooccur: vi.fn(async () => ({ results: [] })),
  techniques: vi.fn(async () => ({ results: [] })),
  compound: vi.fn(async () => ({ results: [] })),
  vcfPairs: vi.fn(async () => ({ count: 0, results: [], scope: 'none' })),
  vcfForms: vi.fn(async () => ({ coverage: 'not_in_corpus', count: 0, results: [] })),
  vcfPhase: vi.fn(async () => ({ count: 0, results: [] })),
  vcfPhaseDish: vi.fn(async () => ({ count: 0, results: [], components: [] })),
  vcfMeta: vi.fn(async () => ({ counts: {}, meta: {} })),
  icdSearch: vi.fn(async (q) => ({
    query: q,
    count: 2,
    results: [
      { code: 'E11.9', name: 'Type 2 diabetes mellitus without complications' },
      { code: 'I50.9', name: 'Heart failure, unspecified' },
    ],
  })),
  healthDiseases: vi.fn(async (ingredient) => ({
    ingredient,
    bridge: 'mesh_compound_disease',
    note: 'Disease IDs are MeSH (FoodAtlas/CTD), not ICD.',
    matched_profiles: [{ base_ingredient: ingredient, raw_name: ingredient }],
    count: 1,
    results: [
      {
        disease_id: 'e-dm2',
        disease_name: 'diabetes mellitus, type 2',
        disease_external_id: 'MESH:D003924',
        n_compounds: 1,
        n_attestations: 4,
        direction_counts: { negative: 1 },
        compounds: [{ compound_id: 'c-dm', compound_name: 'umbelliferone', n_attestations: 4 }],
      },
    ],
  })),
  healthByCondition: vi.fn(async () => ({
    bridge: 'icd_name_to_mesh',
    note: 'ICD codes are resolved by name-match onto MeSH disease labels — not a curated ICD↔MeSH crosswalk.',
    matched_diseases: [
      {
        disease_id: 'e-dm2',
        disease_name: 'diabetes mellitus, type 2',
        disease_external_id: 'MESH:D003924',
        match_score: 0.91,
      },
    ],
    count: 1,
    results: [
      {
        ingredient: 'tomato',
        n_compounds: 2,
        n_attestations: 4,
        sample_compounds: [{ compound_id: 'c-dm', compound_name: 'umbelliferone' }],
      },
    ],
  })),
}))

vi.mock('@culin/api.js', () => api)
vi.mock('@culin/lib/runAgent.js', () => ({
  runChat: (...args) => runChat(...args),
  runAgent: vi.fn(),
  parseAgentResult: vi.fn(),
}))
vi.mock('@culin/lib/traditionDb.js', () => ({
  listRegionPicks: vi.fn(async () => [{ key: 'india', label: 'India' }]),
  matchTraditionRegion: vi.fn(async () => null),
  bestTraditionMatches: vi.fn(async () => []),
  getDishDetail: vi.fn(async () => null),
  getTraditionAssociation: vi.fn(async () => ({ companions: [] })),
}))
vi.mock('@culin/lib/formSuggestions.js', () => ({
  fetchFormCards: vi.fn(async () => ({ forms: [], source: 'test' })),
}))

afterEach(() => {
  cleanup()
  runChat.mockClear()
  api.icdSearch.mockClear()
  api.healthByCondition.mockClear()
  api.healthDiseases.mockClear()
})

function tab(name) {
  return screen.getByRole('button', { name: new RegExp(`^${name}\\b`) })
}

describe('Riverside workspace', () => {
  it('opens on Brainstorm with condition-aware framing, not the chef Compound default', () => {
    render(<App />)
    expect(screen.getByText(/Riverside/)).toBeTruthy()
    expect(tab('Brainstorm').className).toMatch(/\bon\b/)
    expect(tab('Compound').className).not.toMatch(/\bon\b/)
    expect(screen.getByText(/Choose a focus ingredient to start brainstorming/)).toBeTruthy()
    expect(screen.getByText(/clinical nutrition brainstorming/i)).toBeTruthy()
    expect(screen.queryByText(/Designing a dish/)).toBeNull()
  })

  it('keeps Nestlé lenses one click away, in the promised order', () => {
    render(<App />)
    const labels = [...document.querySelectorAll('.lens-tabs .tab')].map((el) =>
      el.textContent.replace(/\d+/g, '').trim()
    )
    expect(labels).toEqual([
      'Brainstorm',
      'Health',
      'Associate',
      'Compound',
      'Tradition',
      'Co-occurrence',
      'Form',
    ])
  })

  it('walks ICD search → MeSH match → plate → brainstorm context → Compound', async () => {
    render(<App initialFocus="garlic" />)

    fireEvent.click(tab('Health'))
    expect(await screen.findByText(/not a curated ICD/i)).toBeTruthy()

    // Focus ingredient drives the plate column without an extra click.
    await waitFor(() => expect(api.healthDiseases).toHaveBeenCalledWith('garlic', 30))
    expect(await screen.findByText('diabetes mellitus, type 2')).toBeTruthy()
    expect(screen.getByText('MESH:D003924')).toBeTruthy()
    expect(screen.getByText(/not ICD/)).toBeTruthy()

    const search = screen.getByRole('searchbox', { name: /ICD-10-CM/i })
    fireEvent.change(search, { target: { value: 'd' } })
    await new Promise((r) => setTimeout(r, 400))
    expect(api.icdSearch).not.toHaveBeenCalled()

    fireEvent.change(search, { target: { value: 'diabetes' } })
    const hit = await screen.findByRole('button', { name: /E11\.9/ })
    fireEvent.click(hit)

    await waitFor(() => expect(api.healthByCondition).toHaveBeenCalled())
    const call = api.healthByCondition.mock.calls.at(-1)[0]
    expect(call).toMatchObject({
      name: 'Type 2 diabetes mellitus without complications',
      code: 'E11.9',
    })

    expect(screen.getByText(/ICD E11\.9/)).toBeTruthy()
    expect(screen.getByText(/name-match onto MeSH/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^tomato/i }))
    expect(await screen.findAllByText(/tomato/i)).not.toHaveLength(0)

    fireEvent.click(tab('Brainstorm'))
    fireEvent.click(screen.getByRole('button', { name: 'What do you notice?' }))
    await screen.findByText(/Consider tomato/)
    const payload = runChat.mock.calls[0][0]
    expect(payload.system).toMatch(/Riverside Health/)
    expect(payload.system).toMatch(/never prescribe/i)
    const last = payload.messages.at(-1).content
    expect(last).toMatch(/E11\.9/)
    expect(last).toMatch(/garlic/i)
    expect(last).toMatch(/tomato/i)
    expect(last).not.toMatch(/^Chef:/m)

    fireEvent.click(tab('Health'))
    fireEvent.click(screen.getByRole('button', { name: /Open Compound breakdown/ }))
    expect(tab('Compound').className).toMatch(/\bon\b/)
    expect(document.querySelector('.pane-c')).toBeTruthy()
    expect(document.querySelector('.pane-h')).toBeFalsy()
  })

  it('removes an ICD chip and drops it from the chefline', async () => {
    render(<App />)
    fireEvent.click(tab('Health'))
    fireEvent.change(screen.getByRole('searchbox', { name: /ICD-10-CM/i }), {
      target: { value: 'heart' },
    })
    const hit = await screen.findByRole('button', { name: /I50\.9/ })
    fireEvent.click(hit)
    expect(await screen.findByText(/ICD I50\.9/)).toBeTruthy()

    const chip = screen.getByRole('button', { name: /Remove I50\.9/ })
    fireEvent.click(chip)
    await waitFor(() => expect(screen.queryByText(/ICD I50\.9/)).toBeNull())
  })

  it('clears the ICD spinner when the query is shortened mid-search', async () => {
    let release
    api.icdSearch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    render(<App />)
    fireEvent.click(tab('Health'))
    const search = screen.getByRole('searchbox', { name: /ICD-10-CM/i })
    fireEvent.change(search, { target: { value: 'diabetes' } })
    expect(await screen.findByText(/Searching NLM/)).toBeTruthy()
    fireEvent.change(search, { target: { value: 'd' } })
    await waitFor(() => expect(screen.queryByText(/Searching NLM/)).toBeNull())
    release({ query: 'diabetes', count: 0, results: [] })
    expect(screen.queryByText(/E11\.9/)).toBeNull()
  })

  it('surfaces an ICD search failure instead of an empty silent list', async () => {
    api.icdSearch.mockRejectedValueOnce(new Error('502 NLM ICD search failed'))
    render(<App />)
    fireEvent.click(tab('Health'))
    fireEvent.change(screen.getByRole('searchbox', { name: /ICD-10-CM/i }), {
      target: { value: 'diabetes' },
    })
    expect(await screen.findByText(/502 NLM ICD search failed/)).toBeTruthy()
  })
})
