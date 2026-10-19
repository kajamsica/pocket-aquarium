import { IDBFactory } from 'fake-indexeddb'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PublicV23Controller } from './PublicV23Controller'
import { createAtomicV34Store } from './domain/atomicV34Database'
import { createAtomicV35Store } from './domain/atomicV35Database'
import { createAtomicV36Store } from './domain/atomicV36Database'
import { createPublicV23Root } from './domain/publicWorldV23Snapshot'
import { emptyPublicV26TerrainLedger } from './domain/publicWorldV26TerrainLedger'
import { emptyPublicV29MiningTools } from './domain/publicWorldV29MiningTools'
import { PUBLIC_V34_SCHEMA } from './domain/publicWorldV34Snapshot'
import type { PublicV34Head } from './domain/publicWorldV34Snapshot'
import { createPublicV35Root } from './domain/publicWorldV35Snapshot'
import { createPublicV36Root } from './domain/publicWorldV36Snapshot'
import type { WizardViewProjection } from './view/contracts'

const rendered = vi.hoisted(() => ({ projection: null as WizardViewProjection | null }))
vi.mock('./view/WizardSurface', () => ({ WizardSurface: ({ projection }: {
  projection: WizardViewProjection }) => { rendered.projection = projection; return null } }))

const locks = { request: async <T,>(_name: string,
  _options: { mode: 'exclusive' }, body: () => T | Promise<T>) => body() }

function checkedV35Source() {
  const { head } = createPublicV23Root('wizard-realms')
  const old: PublicV34Head = { schemaVersion: PUBLIC_V34_SCHEMA, saveRevision: 0,
    witness: null, state: head.state, greenwayWorks: head.greenwayWorks,
    regionalWorks: head.regionalWorks, terrain: emptyPublicV26TerrainLedger(),
    nextHomeAtMs: 0, riverBridgeIds: [], miningTools: emptyPublicV29MiningTools(),
    claimedBridgeheadId: null, raisedSoilCells: [] }
  return createPublicV35Root(old)
}

describe('V36 controller integration', () => {
  it('projects the marker chapter from an explicit V35 copy without changing V35', () => {
    const source = checkedV35Source(), old = structuredClone(source)
    const v36 = createPublicV36Root(source), factory = new IDBFactory()
    const html = renderToStaticMarkup(createElement(PublicV23Controller, {
      version: 'v36', start: { head: v36.head, lineage: v36.lineage }, locks,
      store: createAtomicV36Store(factory), v35Store: createAtomicV35Store(factory) }))
    expect(html).toContain('data-public-version="v36"')
    expect(rendered.projection?.v36MarkerQuest).toMatchObject({
      id: 'beneath-old-marker/v1', stage: 'ledger', active: false })
    expect(rendered.projection?.v35LedgerQuest).toBeDefined()
    expect(source).toEqual(old)

    renderToStaticMarkup(createElement(PublicV23Controller, {
      version: 'v35', start: { head: source.head, lineage: source.lineage }, locks,
      store: createAtomicV35Store(factory), v34Store: createAtomicV34Store(factory) }))
    expect(rendered.projection?.v36MarkerQuest).toBeUndefined()
  })
})
