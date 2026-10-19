import { IDBFactory } from 'fake-indexeddb'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PublicV23Controller } from './PublicV23Controller'
import { createAtomicV17Store } from './domain/atomicV17Database'
import { createAtomicV23Store } from './domain/atomicV23Database'
import { createAtomicV24Store } from './domain/atomicV24Database'
import { createAtomicV25Store } from './domain/atomicV25Database'
import { createAtomicV26Store } from './domain/atomicV26Database'
import { createPublicV23Root } from './domain/publicWorldV23Snapshot'
import { createPublicV24Root } from './domain/publicWorldV24Snapshot'
import { createPublicV25Root } from './domain/publicWorldV25Snapshot'
import { createPublicV26Root } from './domain/publicWorldV26Snapshot'
import type { WizardViewIntent } from './view/contracts'

const probe = vi.hoisted(() => ({ runtime: '', writer: null as null | ((...args: unknown[]) => Promise<unknown>),
  returnWrite: null as null | ((...args: unknown[]) => Promise<unknown>),
  returnArgs: [] as unknown[],
  riverActive: null as boolean | undefined | null, mapGuidance: '' as string | undefined,
  rimSegments: -1, onIntent: null as null | ((intent: WizardViewIntent) => void),
  terrainAction: null as unknown, injectBridge: false, committed: '' }))
vi.mock('./PublicV23WorldView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./PublicV23WorldView')>()
  const { publicWorldV15StarterSites } = await import('./domain/publicWorldV15StarterSites')
  return { ...actual, publicWorldV23ViewProjection:
    (...args: Parameters<typeof actual.publicWorldV23ViewProjection>) => {
      const view = actual.publicWorldV23ViewProjection(...args)
      if (!probe.injectBridge) return view
      const [bridge] = publicWorldV15StarterSites(view.seed)
      if (bridge.kind !== 'bridge') throw new Error('Missing bridge fixture')
      return { ...view, savedTerrainWorks: { ...view.savedTerrainWorks!,
        context: 'works4-greenway' as const, builtSites: [bridge] },
        backpack: { ...view.backpack, stacks: [{ id: 'logs', itemId: 'logs', name: 'Logs', quantity: 4 }] } }
    } }
})
vi.mock('./PublicV23ControllerRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./PublicV23ControllerRuntime')>()
  return { ...actual,
    createPublicV24ControllerRuntime: (...args: Parameters<typeof actual.createPublicV24ControllerRuntime>) => {
      probe.runtime = 'v24'; probe.writer = args[1] as typeof probe.writer
      return actual.createPublicV24ControllerRuntime(...args)
    },
    createPublicV25ControllerRuntime: (...args: Parameters<typeof actual.createPublicV25ControllerRuntime>) => {
      probe.runtime = 'v25'; probe.writer = args[1] as typeof probe.writer
      return actual.createPublicV25ControllerRuntime(...args)
    },
  }
})
vi.mock('./domain/publicWorldV24Flow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./domain/publicWorldV24Flow')>()
  return { ...actual, commitPublicV24: async () => {
    probe.committed = 'v24'; return { ok: false, reason: 'probe' }
  } }
})
vi.mock('./domain/publicWorldV25Flow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./domain/publicWorldV25Flow')>()
  return { ...actual, commitPublicV25: async () => {
    probe.committed = 'v25'; return { ok: false, reason: 'probe' }
  } }
})
vi.mock('./PublicV26ControllerRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./PublicV26ControllerRuntime')>()
  return { ...actual,
    createPublicV26ControllerRuntime: (...args: Parameters<typeof actual.createPublicV26ControllerRuntime>) => {
      probe.runtime = 'v26'; probe.writer = args[1] as typeof probe.writer
      probe.returnWrite = args[2] as typeof probe.returnWrite
      return { ...actual.createPublicV26ControllerRuntime(...args),
        action: async (witness: unknown) => { probe.terrainAction = witness
          return { status: 'saved' as const, events: [], resetWalkRequested: false } } }
    } }
})
vi.mock('./domain/publicWorldV26Flow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./domain/publicWorldV26Flow')>()
  return { ...actual, commitPublicV26: async () => {
    probe.committed = 'v26'; return { ok: false, reason: 'probe' }
  }, requestPublicV26ReturnHome: async (...args: unknown[]) => {
    probe.returnArgs = args
    probe.committed = 'v26-return'; return { ok: false, reason: 'probe' }
  } }
})
vi.mock('./view/WizardSurface', () => ({ WizardSurface: (props: {
  onIntent: (intent: WizardViewIntent) => void;
  projection: { v25RiverActive?: boolean; v26ValleyRimSegments?: readonly unknown[];
    map: { guidance?: string } } }) => {
  probe.onIntent = props.onIntent
  probe.riverActive = props.projection.v25RiverActive
  probe.mapGuidance = props.projection.map.guidance
  probe.rimSegments = props.projection.v26ValleyRimSegments?.length ?? -1
  return null
} }))

const locks = { request: async <T,>(_name: string,
  _options: { mode: 'exclusive' }, body: () => T | Promise<T>) => body() }
describe('V25 shared controller selection', () => {
  it('selects the V25 runtime, writer, and projection without changing V24', async () => {
    const factory = new IDBFactory(), v23 = createPublicV23Root('greenway-alpha')
    const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
    const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
    const v17Store = createAtomicV17Store(factory), v23Store = createAtomicV23Store(factory)
    const v24Store = createAtomicV24Store(factory), v25Store = createAtomicV25Store(factory)
    probe.injectBridge = true
    const html25 = renderToStaticMarkup(createElement(PublicV23Controller, {
      version: 'v25', start: { head: v25.head, lineage: v25.lineage }, locks,
      store: v25Store, sourceStore: v24Store, v23Store, v17Store }))
    expect(html25).toContain('data-public-version="v25"')
    expect(probe.runtime).toBe('v25')
    expect(probe.riverActive).toBe(true)
    expect(probe.mapGuidance).toContain('North cliff Ladder to upper ledge: costs 4 logs; 4 in your bag')
    await probe.writer!(0, v25.lineage, { kind: 'checkpoint' })
    expect(probe.committed).toBe('v25')

    probe.runtime = probe.committed = ''; probe.riverActive = null; probe.injectBridge = false
    const html24 = renderToStaticMarkup(createElement(PublicV23Controller, {
      version: 'v24', start: { head: v24.head, lineage: v24.lineage }, locks,
      store: v24Store, sourceStore: v23Store, ancestorStore: v17Store }))
    expect(html24).toContain('data-public-version="v24"')
    expect(probe.runtime).toBe('v24')
    expect(probe.riverActive).toBeUndefined()
    expect(probe.mapGuidance ?? '').not.toContain('North cliff Ladder to upper ledge: costs 4 logs')
    await probe.writer!(0, v24.lineage, { kind: 'checkpoint' })
    expect(probe.committed).toBe('v24')
  })

  it('selects checked V26 runtime, view overlay, writer, and exact terrain witness only for V26', async () => {
    const factory = new IDBFactory(), v23 = createPublicV23Root('greenway-alpha')
    const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
    const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
    const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
    const v17Store = createAtomicV17Store(factory), v23Store = createAtomicV23Store(factory)
    const v24Store = createAtomicV24Store(factory), v25Store = createAtomicV25Store(factory)
    const v26Store = createAtomicV26Store(factory)
    probe.runtime = probe.committed = ''; probe.terrainAction = null
    const html26 = renderToStaticMarkup(createElement(PublicV23Controller, {
      version: 'v26', start: { head: v26.head, lineage: v26.lineage }, locks,
      store: v26Store, sourceStore: v25Store, v24Store, v23Store, v17Store }))
    expect(html26).toContain('data-public-version="v26"')
    expect(html26).toContain('First steps: chop trees for logs')
    expect(probe.runtime).toBe('v26')
    expect(probe.riverActive).toBe(true)
    expect(probe.rimSegments).toBeGreaterThan(0)
    probe.onIntent!({ type: 'v26.terrain', kind: 'dig', gx: 3, gz: 1 })
    await Promise.resolve()
    expect(probe.terrainAction).toEqual({ kind: 'terrain-action/v1',
      action: { kind: 'dig', gx: 3, gz: 1 } })
    await probe.writer!(0, v26.lineage, { kind: 'checkpoint' })
    expect(probe.committed).toBe('v26')
    await probe.returnWrite!(0, v26.lineage)
    expect(probe.committed).toBe('v26-return')
    expect(probe.returnArgs).toHaveLength(8)
    expect(probe.returnArgs.slice(6)).toEqual([0, v26.lineage])

    probe.terrainAction = null
    renderToStaticMarkup(createElement(PublicV23Controller, {
      version: 'v25', start: { head: v25.head, lineage: v25.lineage }, locks,
      store: v25Store, sourceStore: v24Store, v23Store, v17Store }))
    probe.onIntent!({ type: 'v26.terrain', kind: 'dig', gx: 3, gz: 1 })
    await Promise.resolve()
    expect(probe.terrainAction).toBeNull()
  })
})
