import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WorkspaceProvider, useWorkspace } from '../context/WorkspaceContext.jsx'
import DishSidebar from './DishSidebar.jsx'

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

function Harness() {
  const { addIngredient, commitForm, removeAt } = useWorkspace()
  return (
    <>
      <button type="button" onClick={() => addIngredient('Garlic', 'compound')}>
        add garlic
      </button>
      <button type="button" onClick={() => commitForm('Confit', 'fat as medium')}>
        commit confit
      </button>
      <button type="button" onClick={() => removeAt(0)}>
        remove first
      </button>
      <DishSidebar />
    </>
  )
}

afterEach(cleanup)

describe('DishSidebar — demo plate', () => {
  it('starts empty and prompts for a focus ingredient', () => {
    render(
      <WorkspaceProvider>
        <Harness />
      </WorkspaceProvider>
    )
    expect(screen.getByRole('button', { name: /Untitled — pick a focus/ })).toBeTruthy()
    expect(screen.getByText(/Nothing gathered yet/)).toBeTruthy()
    expect(screen.getByText('Nothing to keep yet.')).toBeTruthy()
  })

  it('lets the chef name the dish by clicking the title', () => {
    render(
      <WorkspaceProvider>
        <Harness />
      </WorkspaceProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: /Untitled — pick a focus/ }))
    const input = screen.getByLabelText('Dish name')
    fireEvent.change(input, { target: { value: 'Spring lamb' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('button', { name: /Spring lamb — pick a focus/ })).toBeTruthy()
  })

  it('lists a gathered ingredient and can remove it', () => {
    render(
      <WorkspaceProvider>
        <Harness />
      </WorkspaceProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'add garlic' }))
    expect(document.querySelector('.ing-n').textContent).toBe('Garlic')
    fireEvent.click(screen.getByRole('button', { name: '×' }))
    expect(document.querySelector('.ing')).toBeNull()
  })

  it('shows the committed process frame until cleared', () => {
    render(
      <WorkspaceProvider>
        <Harness />
      </WorkspaceProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'commit confit' }))
    expect(document.querySelector('.fn').textContent).toBe('Confit')
    fireEvent.click(screen.getByRole('button', { name: 'clear' }))
    expect(document.querySelector('.fcard')).toBeNull()
  })
})
