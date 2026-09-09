import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { createPocketReefShowcase, projectPocketState } from '../integration/pocketAquariumBridge'
import { AquariumLibraryPanel, type AquariumLibraryModel } from './AquariumLibraryPanel'
import { PocketGameHUD } from './PocketGameHUD'

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
  it('renders active, switch, bounded rename, and new-tank controls wired to the model', () => {
    const onCreate = vi.fn()
    const onActivate = vi.fn()
    const onRename = vi.fn()
    const model: AquariumLibraryModel = {
      tanks: [
        { id: 'reef', name: 'Reef Display', habitat: 'reef', active: true },
        { id: 'amazon', name: 'Amazon Margin', habitat: 'amazon', active: false },
      ],
      onCreate,
      onActivate,
      onRename,
    }
    const panel = AquariumLibraryPanel({ model })
    const elements = descendants(panel)
    const buttons = elements.filter(({ type }) => type === 'button')
    const markup = renderToStaticMarkup(panel)

    expect(markup).toContain('2 tanks')
    expect(markup).toMatch(/data-active="true"[\s\S]*Reef Display[\s\S]*Active[\s\S]*disabled=""[\s\S]*Current/)
    expect(markup).toMatch(/data-active="false"[\s\S]*Amazon Margin[\s\S]*Freshwater[\s\S]*Switch/)
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
      const renameForms = elements.filter(({ type }) => type === 'form')
      const renameTank = renameForms[1].props.onSubmit as (event: unknown) => void
      renameTank({
        preventDefault: vi.fn(),
        currentTarget: { elements: { namedItem: () => new TestInput('  Amazon Home  ') } },
      })
    } finally {
      if (previousInput) Object.defineProperty(globalThis, 'HTMLInputElement', previousInput)
      else Reflect.deleteProperty(globalThis, 'HTMLInputElement')
    }
    expect(onRename).toHaveBeenCalledWith('amazon', 'Amazon Home')
  })

  it('keeps the optional library absent when legacy or showcase callers omit it', () => {
    const markup = withServerWindow(() => renderToStaticMarkup(createElement(PocketGameHUD, {
      view: projectPocketState(createPocketReefShowcase()),
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
