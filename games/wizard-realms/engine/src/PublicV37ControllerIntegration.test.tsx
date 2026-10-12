import { IDBFactory } from 'fake-indexeddb'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PublicV23Controller } from './PublicV23Controller'
import { createAtomicV36Store } from './domain/atomicV36Database'
import { createAtomicV37Store } from './domain/atomicV37Database'
import { createFreshPublicV37Root } from './domain/publicWorldV37Snapshot'
import type { WizardViewProjection } from './view/contracts'
import { WizardHud } from './view/WizardHud'

const rendered = vi.hoisted(() => ({ projection: null as WizardViewProjection | null }))
vi.mock('./view/WizardSurface', () => ({ WizardSurface: ({ projection }: {
  projection: WizardViewProjection }) => { rendered.projection = projection; return null } }))
const locks = { request: async <T,>(_name: string, _options: { mode: 'exclusive' },
  body: () => T | Promise<T>) => body() }
describe('V37 normal controller wiring', () => {
  it('projects checked Windward state through the normal controller and keeps inherited chapters', () => {
    const root = createFreshPublicV37Root('wizard-realms'), before = structuredClone(root)
    const factory = new IDBFactory()
    const html = renderToStaticMarkup(createElement(PublicV23Controller, { version: 'v37',
      start: root, locks, store: createAtomicV37Store(factory), v36Store: createAtomicV36Store(factory) }))
    expect(html).toContain('data-public-version="v37"')
    expect(rendered.projection?.windwardStep).toMatchObject({ checkedActions: true,
      learned: false, canCast: false, activeSeconds: 0, cooldownSeconds: 0 })
    expect(rendered.projection?.windwardStep?.unavailableReason).toBeUndefined()
    expect(rendered.projection?.v35LedgerQuest).toBeDefined()
    expect(rendered.projection?.v36MarkerQuest).toBeDefined()
    expect(root).toEqual(before)
    const projection: WizardViewProjection = { ...rendered.projection!, starterCliff: undefined,
      unavailableActions: true, windwardStep: { checkedActions: true, learned: true,
        canCast: true, activeSeconds: 0, cooldownSeconds: 0, glyph: null } }
    const checked = renderToStaticMarkup(createElement(WizardHud, { projection, onIntent: vi.fn() }))
    expect(checked).toContain('aria-label="Cast Windward Step"')
    expect(checked).not.toMatch(/disabled="" aria-label="Cast Windward Step"/)
    const inherited = renderToStaticMarkup(createElement(WizardHud, { projection: { ...projection,
      windwardStep: { ...projection.windwardStep!, checkedActions: undefined } }, onIntent: vi.fn() }))
    expect(inherited).toMatch(/disabled="" aria-label="Cast Windward Step"/)
  })
})
