import { IDBFactory } from 'fake-indexeddb'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PublicV23Controller, publicV23WorkRouteForView,
  publicV28WorkRouteForView } from './PublicV23Controller'
import { createAtomicV17Store } from './domain/atomicV17Database'
import { createAtomicV23Store } from './domain/atomicV23Database'
import { createAtomicV24Store } from './domain/atomicV24Database'
import { createAtomicV25Store } from './domain/atomicV25Database'
import { createAtomicV26Store } from './domain/atomicV26Database'
import { createAtomicV27Store } from './domain/atomicV27Database'
import { createAtomicV28Store } from './domain/atomicV28Database'
import { createPublicV23Root } from './domain/publicWorldV23Snapshot'
import { createPublicV24Root } from './domain/publicWorldV24Snapshot'
import { createPublicV25Root } from './domain/publicWorldV25Snapshot'
import { createPublicV26Root } from './domain/publicWorldV26Snapshot'
import { createPublicV27Root } from './domain/publicWorldV27Snapshot'
import { createPublicV28Root } from './domain/publicWorldV28Snapshot'
import { resolvePublicV28RiverBridge } from './domain/publicWorldV28RiverBridgeSites'
import { displayPublicV28RiverBridge } from './PublicV28WorldView'
import type { WizardViewProjection } from './view/contracts'

vi.mock('./view/WizardSurface', () => ({ WizardSurface: () => null }))

const seed = 'greenway-alpha'
const site = resolvePublicV28RiverBridge(seed, 'works6:river-bridge:-14')!
const locks = { request: async <T,>(_name: string, _options: { mode: 'exclusive' },
  body: () => T | Promise<T>) => body() }

function selectedView(id = site.id, rejection: string | null = null): WizardViewProjection {
  const candidate = { controllerActionsEnabled: true, savedTerrainWorks: { modeActive: true,
    builtSites: [], dugTileIds: [], preview: { guidance: null, nearby: [], selected: {
      site: { ...displayPublicV28RiverBridge(site), id }, rejection,
      distanceMeters: 1, angleRadians: 0, benefit: 'Checked deck', reason: 'Ready' } } } }
  return candidate as unknown as WizardViewProjection
}

describe('V28 controller integration', () => {
  it('routes only a selected checked Ready connected-river bridge to V28', () => {
    expect(publicV28WorkRouteForView(selectedView(), site.id, 'streamed', seed))
      .toBe('river-bridge/v1')
    expect(publicV23WorkRouteForView(selectedView(), site.id, 'streamed', seed)).toBeNull()
    expect(publicV28WorkRouteForView(selectedView(site.id, 'not_owned'), site.id,
      'streamed', seed)).toBeNull()
    expect(publicV28WorkRouteForView(selectedView(), site.id, 'greenway', seed)).toBeNull()
    expect(publicV28WorkRouteForView(selectedView('works6:river-bridge:-014'),
      'works6:river-bridge:-014', 'streamed', seed)).toBeNull()
    expect(publicV28WorkRouteForView({ ...selectedView(),
      controllerActionsEnabled: false }, site.id, 'streamed', seed)).toBeNull()
  })

  it('mounts a V28 checked session without mounting or changing an older version', () => {
    const factory = new IDBFactory(), v23 = createPublicV23Root(seed)
    const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
    const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
    const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
    const v27 = createPublicV27Root({ head: v26.head, lineage: v26.lineage })
    const v28 = createPublicV28Root({ head: v27.head, lineage: v27.lineage })
    const html = renderToStaticMarkup(createElement(PublicV23Controller, {
      version: 'v28', start: { head: v28.head, lineage: v28.lineage }, locks,
      store: createAtomicV28Store(factory), sourceStore: createAtomicV27Store(factory),
      v26Store: createAtomicV26Store(factory), v25Store: createAtomicV25Store(factory),
      v24Store: createAtomicV24Store(factory), v23Store: createAtomicV23Store(factory),
      v17Store: createAtomicV17Store(factory) }))
    expect(html).toContain('data-public-version="v28"')
    expect(html).toContain('First steps: chop trees for logs')
    expect(html).toContain('Safety options')
    expect(v27.head.schemaVersion).toBe('wizard-world/v27')
    expect(v28.head.riverBridgeIds).toEqual([])
  })
})
