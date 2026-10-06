import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { pocketSaveKey } from './integration/pocketAquariumBridge'

type TestElement = ReactElement<Record<string, unknown>>
type BoundaryInstance = {
  state: { failed: boolean; eraseFailed: boolean }
  render(): ReactNode
  setState(next: Partial<BoundaryInstance['state']>): void
}

const rootHarness = vi.hoisted(() => ({ rendered: null as ReactNode }))
const reload = vi.hoisted(() => vi.fn())
const replace = vi.hoisted(() => vi.fn())
const confirmErase = vi.hoisted(() => vi.fn())
const cells = vi.hoisted(() => new Map<string, string>())

vi.mock('react-dom/client', () => ({
  createRoot: () => ({ render: (node: ReactNode) => { rootHarness.rendered = node } }),
}))
vi.mock('./App', () => ({ default: () => createElement('div') }))

function descendants(node: ReactNode): TestElement[] {
  if (!isValidElement(node)) return []
  const element = node as TestElement
  const children = Children.toArray((element.props as { children?: ReactNode }).children)
  return [element, ...children.flatMap(descendants)]
}

function storage() {
  return {
    get length() { return cells.size },
    key: (index: number) => [...cells.keys()][index] ?? null,
    removeItem: (key: string) => { cells.delete(key) },
  }
}

function failedBoundary() {
  const strictMode = rootHarness.rendered as TestElement
  const boundary = strictMode.props.children as TestElement
  const Boundary = boundary.type as unknown as {
    new(props: { children: ReactNode }): BoundaryInstance
    getDerivedStateFromError(): BoundaryInstance['state']
  }
  const instance = new Boundary(boundary.props as { children: ReactNode })
  instance.state = Boundary.getDerivedStateFromError()
  instance.setState = (next) => { instance.state = { ...instance.state, ...next } }
  return instance
}

beforeAll(async () => {
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    getElementById: () => ({}),
  } })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    confirm: confirmErase,
    localStorage: storage(),
    location: {
      href: 'https://aquarium.test/?dev=1#stale',
      protocol: 'https:',
      reload,
      replace,
    },
  } })
  await import('./main')
})

beforeEach(() => {
  reload.mockReset()
  replace.mockReset()
  confirmErase.mockReset()
  cells.clear()
  cells.set(pocketSaveKey, 'legacy')
  cells.set(`${pocketSaveKey}:tank-index-v1`, 'index')
  cells.set('unrelated-origin-key', 'keep')
})

describe('root recovery UI contract', () => {
  it('renders branded retry and keeps destructive recovery behind confirmation', () => {
    const boundary = failedBoundary()
    const rendered = boundary.render()
    const markup = renderToStaticMarkup(rendered)
    const buttons = descendants(rendered).filter(({ type }) => type === 'button')

    expect(markup).toContain('Pocket Aquarium recovery')
    expect(markup).toContain('The aquarium hit rough water.')
    ;(buttons.find(({ props }) => props.children === 'Try again')!.props.onClick as () => void)()
    expect(reload).toHaveBeenCalledOnce()

    confirmErase.mockReturnValue(false)
    ;(buttons.find(({ props }) => props.children === 'Erase all data and restart')!.props.onClick as () => void)()
    expect(cells.has(pocketSaveKey)).toBe(true)
    expect(replace).not.toHaveBeenCalled()
  })

  it('uses selective erasure and returns confirmed recovery to a clean URL', () => {
    const boundary = failedBoundary()
    const erase = descendants(boundary.render()).find(({ props }) =>
      props.children === 'Erase all data and restart')!.props.onClick as () => void

    confirmErase.mockReturnValue(true)
    erase()

    expect([...cells.entries()]).toEqual([['unrelated-origin-key', 'keep']])
    expect(replace).toHaveBeenCalledWith('https://aquarium.test/')
  })
})
