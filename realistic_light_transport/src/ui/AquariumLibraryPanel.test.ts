import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  createPocketNewGame,
  dispatchPocketAction,
  pocketActions,
  pocketSaveKey,
  projectPocketState,
} from '../integration/pocketAquariumBridge'
import { eraseAllPocketAquariumData } from '../integration/pocketTankRepository'
import { AquariumLibraryPanel, type AquariumLibraryModel } from './AquariumLibraryPanel'
import { PocketGameHUD } from './PocketGameHUD'

const hookHarness = vi.hoisted(() => ({ enabled: false, value: false as unknown }))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual, useState: <T,>(initial: T | (() => T)) => {
    if (!hookHarness.enabled) return actual.useState(initial)
    const value = hookHarness.value as T
    return [value, (next: T | ((previous: T) => T)) => {
      hookHarness.value = typeof next === 'function'
        ? (next as (previous: T) => T)(value) : next
    }] as const
  } }
})

type TestElement = ReactElement<Record<string, unknown>>

function descendants(node: ReactNode): TestElement[] {
  if (!isValidElement(node)) return []
  const element = node as TestElement
  const children = Children.toArray((element.props as { children?: ReactNode }).children)
  return [element, ...children.flatMap(descendants)]
}

function withServerWindow<T>(render: () => T): T {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    innerWidth: 1280,
    innerHeight: 800,
    matchMedia: () => ({ matches: true }),
    localStorage: { getItem: () => null, setItem: () => undefined },
  } })
  try { return render() } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else Reflect.deleteProperty(globalThis, 'window')
  }
}

describe('aquarium library UI contract', () => {
  it('requires confirmation, preserves data on cancel, and delegates confirmed erase', () => {
    const onCreate = vi.fn()
    const onActivate = vi.fn()
    const onRename = vi.fn()
    const cells = new Map([[pocketSaveKey, 'tank'], ['unrelated', 'keep']])
    const storage = {
      get length() { return cells.size },
      key: (index: number) => [...cells.keys()][index] ?? null,
      removeItem: (key: string) => { cells.delete(key) },
      getItem: (key: string) => cells.get(key) ?? null,
      setItem: (key: string, value: string) => { cells.set(key, value) },
    }
    const onEraseAll = vi.fn(() => {
      eraseAllPocketAquariumData(storage, pocketSaveKey)
      return true
    })
    const model: AquariumLibraryModel = {
      tanks: [
        { id: 'reef', name: 'Reef Display', habitat: 'reef', active: true },
        { id: 'amazon', name: 'Amazon Margin', habitat: 'amazon', active: false },
      ],
      onCreate,
      onActivate,
      onRename,
      onEraseAll,
    }
    hookHarness.enabled = true
    hookHarness.value = false
    try {
      let panel = AquariumLibraryPanel({ model })
      let elements = descendants(panel)
      let buttons = elements.filter(({ type }) => type === 'button')
      const markup = renderToStaticMarkup(panel)

      expect(markup).toContain('2 tanks')
      expect(markup).toMatch(/data-active="true"[\s\S]*Reef Display[\s\S]*Active[\s\S]*disabled=""[\s\S]*Current/)
      expect(markup).toMatch(/data-active="false"[\s\S]*Amazon Margin[\s\S]*Freshwater[\s\S]*Switch/)
      expect(markup).toContain('Erase all aquarium data')
      expect(markup).not.toContain('Erase everything')
      expect(elements.filter(({ type }) => type === 'input').map(({ props }) => props.maxLength)).toEqual([24, 24])

      const createTank = buttons.find(({ props }) => props.children === 'New tank')!.props.onClick as () => void
      const activateTank = buttons.find(({ props }) => props.children === 'Switch')!.props.onClick as () => void
      createTank()
      activateTank()
      expect(onCreate).toHaveBeenCalledOnce()
      expect(onActivate).toHaveBeenCalledWith('amazon')

      class TestInput { constructor(readonly value: string) {} }
      const previousInput = Object.getOwnPropertyDescriptor(globalThis, 'HTMLInputElement')
      Object.defineProperty(globalThis, 'HTMLInputElement', { configurable: true, value: TestInput })
      try {
        const renameTank = elements.filter(({ type }) => type === 'form')[1].props.onSubmit as
          (event: unknown) => void
        renameTank({
          preventDefault: vi.fn(),
          currentTarget: { elements: { namedItem: () => new TestInput('  Amazon Home  ') } },
        })
      } finally {
        if (previousInput) Object.defineProperty(globalThis, 'HTMLInputElement', previousInput)
        else Reflect.deleteProperty(globalThis, 'HTMLInputElement')
      }
      expect(onRename).toHaveBeenCalledWith('amazon', 'Amazon Home')

      ;(buttons.find(({ props }) => props.children === 'Erase all aquarium data')!.props.onClick as () => void)()
      panel = AquariumLibraryPanel({ model })
      elements = descendants(panel)
      buttons = elements.filter(({ type }) => type === 'button')
      expect(elements.some(({ props }) => props.role === 'alertdialog')).toBe(true)
      ;(buttons.find(({ props }) => props.children === 'Cancel')!.props.onClick as () => void)()
      expect(onEraseAll).not.toHaveBeenCalled()
      expect([...cells.entries()]).toEqual([[pocketSaveKey, 'tank'], ['unrelated', 'keep']])

      hookHarness.value = 'confirming'
      panel = AquariumLibraryPanel({ model })
      buttons = descendants(panel).filter(({ type }) => type === 'button')
      ;(buttons.find(({ props }) => props.children === 'Erase everything')!.props.onClick as () => void)()
      expect(onEraseAll).toHaveBeenCalledOnce()
      expect([...cells.keys()].sort()).toEqual([`${pocketSaveKey}:tank-index-v1`, 'unrelated'].sort())
    } finally {
      hookHarness.enabled = false
    }
  })

  it('shows an accessible retry when confirmed erasure fails', () => {
    const onEraseAll = vi.fn(() => false)
    const model: AquariumLibraryModel = {
      tanks: [],
      onCreate: vi.fn(),
      onActivate: vi.fn(),
      onRename: vi.fn(),
      onEraseAll,
    }
    hookHarness.enabled = true
    hookHarness.value = 'confirming'
    try {
      let panel = AquariumLibraryPanel({ model })
      let erase = descendants(panel).find(({ props }) => props.children === 'Erase everything')!
      ;(erase.props.onClick as () => void)()

      panel = AquariumLibraryPanel({ model })
      const markup = renderToStaticMarkup(panel)
      expect(markup).toContain('role="alert"')
      expect(markup).toContain('Aquarium data could not be erased')
      erase = descendants(panel).find(({ props }) => props.children === 'Try erase again')!
      ;(erase.props.onClick as () => void)()
      expect(onEraseAll).toHaveBeenCalledTimes(2)
    } finally {
      hookHarness.enabled = false
    }
  })

  it('keeps the optional library absent when legacy or showcase callers omit it', () => {
    const reef = dispatchPocketAction(createPocketNewGame(), {
      type: pocketActions.CHOOSE_HABITAT, habitat: 'reef',
    })
    const markup = withServerWindow(() => renderToStaticMarkup(createElement(PocketGameHUD, {
      view: projectPocketState(reef),
      dispatch: vi.fn(),
      renderSettings: { quality: 'balanced', diagnosticView: 'beauty', brightness: 1 },
      onRenderSettingsChange: vi.fn(),
      onStartOver: vi.fn(),
    })))

    expect(markup).toContain('data-has-library="false"')
    expect(markup).not.toContain('pocket-library-entry')
    expect(markup).not.toContain('pocket-library-panel')
    expect(markup).not.toContain('Open aquarium library')
  })
})
