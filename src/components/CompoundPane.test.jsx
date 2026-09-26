import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { WorkspaceProvider } from '../context/WorkspaceContext.jsx'
import CompoundPane from './CompoundPane.jsx'

const vcfPairs = vi.fn(async (opts = {}) => ({
  spine_id: opts.spineId || 'culin:coffee',
  product_id: opts.productId || 157,
  scope: opts.productId != null ? 'product' : 'spine',
  source: 'pairs',
  count: 1,
  mixed_profile_source_count: 0,
  results: [
    {
      match_vcf_product_id: 400,
      match_raw_name: 'PORK (Sus scrofa L.)',
      rank: 1,
      score: 0.187,
      shared_count: 255,
      top_shared_compounds: [
        { compound_id: 'x', raw_compound: '2-methylpyrazine', compound_group: 'Bases', df_culinary: 40, idf: 2.6 },
        { compound_id: 'y', raw_compound: 'furfural', compound_group: 'Furans', df_culinary: 12, idf: 3.8, descriptors: ['bready'] },
      ],
    },
  ],
}))

vi.mock('../lib/traditionDb.js', async () => {
  const { traditionDbTestStub } = await import('../lib/traditionDb.testStub.js')
  return traditionDbTestStub
})

vi.mock('../api.js', () => ({
  vcfPairs: (...a) => vcfPairs(...a),
  listPalate: vi.fn(async () => ({ results: [] })),
  savePalate: vi.fn(),
  health: vi.fn(),
  cooccur: vi.fn(),
  techniques: vi.fn(),
  compound: vi.fn(),
}))

function renderPane(focus) {
  return render(
    <WorkspaceProvider initialFocus={focus}>
      <CompoundPane />
    </WorkspaceProvider>
  )
}

afterEach(() => {
  cleanup()
  vcfPairs.mockClear()
})

describe('CompoundPane — reads the VCF compound layer', () => {
  it('resolves the seed to a product id before fetching', async () => {
    renderPane('Coffee')
    await waitFor(() => expect(vcfPairs).toHaveBeenCalled())
    const arg = vcfPairs.mock.calls[0][0]
    expect(arg.spineId).toMatch(/^culin:/)
    expect(arg.productId).toEqual(expect.any(Number))
  })

  it('names the compound families rather than the score', async () => {
    renderPane('Coffee')
    expect(await screen.findByText(/pyrazines and pyridines/)).toBeTruthy()
    expect(screen.queryByText(/0\.187/)).toBeNull()
  })

  it('shows the individual compounds on request, rarest first', async () => {
    renderPane('Coffee')
    fireEvent.click(await screen.findByRole('button', { name: 'Show compounds' }))
    const items = [...document.querySelectorAll('.cr-compounds li')].map((li) =>
      li.textContent.split('Bases')[0].split('Furans')[0]
    )
    expect(items[0]).toContain('furfural')
  })

  it('discloses the source', async () => {
    renderPane('Coffee')
    expect(await screen.findByText(/Volatile Compounds in Food/)).toBeTruthy()
  })

  it('fetches garlic at member scope, not the allium cluster', async () => {
    renderPane('Garlic')
    await waitFor(() => expect(vcfPairs).toHaveBeenCalled())
    const arg = vcfPairs.mock.calls[0][0]
    expect(arg.spineId).toBe('culin:leek')
    expect(arg.productId).toBe(209)
  })

  it('says so plainly when the seed is not in the corpus', async () => {
    renderPane('Xyzzy Not A Food')
    expect(await screen.findByText(/No VCF compound data/)).toBeTruthy()
    expect(vcfPairs).not.toHaveBeenCalled()
  })
})
