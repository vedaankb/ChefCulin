import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WorkspaceProvider } from '../context/WorkspaceContext.jsx'
import BrainstormPane from './BrainstormPane.jsx'

const runChat = vi.fn(async () => 'A short plate read.')

vi.mock('../api.js', () => ({
  listPalate: vi.fn(async () => ({ results: [] })),
  savePalate: vi.fn(),
  health: vi.fn(),
  cooccur: vi.fn(),
  techniques: vi.fn(),
}))

vi.mock('../lib/traditionDb.js', () => ({
  listRegionPicks: vi.fn(async () => []),
  matchTraditionRegion: vi.fn(async () => null),
  bestTraditionMatches: vi.fn(async () => []),
}))

vi.mock('../lib/runAgent.js', () => ({
  runChat: (...args) => runChat(...args),
  runAgent: vi.fn(),
  parseAgentResult: vi.fn(),
}))

afterEach(() => {
  cleanup()
  runChat.mockClear()
})

describe('BrainstormPane', () => {
  it('asks the chef to gather first on an empty plate', () => {
    render(
      <WorkspaceProvider>
        <BrainstormPane />
      </WorkspaceProvider>
    )
    expect(screen.getByText(/Gather a few ingredients first/)).toBeTruthy()
  })

  it('sends a quick prompt through the LLM proxy', async () => {
    render(
      <WorkspaceProvider initialFocus="Chicken">
        <BrainstormPane />
      </WorkspaceProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'What do you notice?' }))
    expect(await screen.findByText('A short plate read.')).toBeTruthy()
    expect(runChat).toHaveBeenCalled()
    const payload = runChat.mock.calls[0][0]
    expect(payload.messages.at(-1).content).toMatch(/Chicken/)
  })
})
