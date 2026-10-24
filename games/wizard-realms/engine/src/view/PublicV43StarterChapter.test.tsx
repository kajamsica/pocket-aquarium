import { IDBFactory } from 'fake-indexeddb'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createAtomicV43Store } from '../domain/atomicV43Database'
import { decodePublicV26TerrainLedger } from '../domain/publicWorldV26TerrainLedger'
import { publicV25RiverCellAtGrid } from '../domain/publicWorldV25River'
import { publicV25StratumAt } from '../domain/publicWorldV25Strata'
import { createFreshPublicV42Root, decodePublicV42Progress, decodePublicV42Root,
  PUBLIC_V42_SCHEMA } from '../domain/publicWorldV42Snapshot'
import type { PublicV42Root } from '../domain/publicWorldV42Snapshot'
import { PUBLIC_V42_PROGRESS_KEYS } from '../domain/publicWorldV42RewardAction'
import type { PublicV42RewardProgress } from '../domain/publicWorldV42RewardAction'
import { createFreshPublicV43Root, createPublicV43Root } from '../domain/publicWorldV43Snapshot'
import type { PublicV43Progress } from '../domain/publicWorldV43Snapshot'
import { worldTileAtGrid } from '../domain/worldChunks'
import { PublicV43StarterChapter, projectPublicV43StarterChapter }
  from './PublicV43StarterChapter'

const creekBridgeId = 'works4:bridge:greenway-creek:-14'
const fresh = (): PublicV43Progress => createFreshPublicV43Root('wizard-realms').head
const withLogs = (head: PublicV43Progress, quantity: number): PublicV43Progress => ({
  ...head, state: { ...head.state, player: { ...head.state.player,
    inventory: [...head.state.player.inventory, { itemId: 'logs' as const, quantity }] } } })
const withBridge = (head: PublicV43Progress): PublicV43Progress => ({
  ...head, greenwayWorks: { ...head.greenwayWorks,
    builtBridgeIds: [creekBridgeId] } })
const withBridgeheadClaim = (head: PublicV43Progress): PublicV43Progress => {
  const crossed = withBridge(head)
  return { ...crossed, claimedBridgeheadId: creekBridgeId,
    miningTools: { ...crossed.miningTools, basicPickOwned: true } }
}
const withSpade = (head: PublicV43Progress): PublicV43Progress => ({
  ...head, state: { ...head.state, player: { ...head.state.player,
    inventory: [...head.state.player.inventory, { itemId: 'field_spade' as const, quantity: 1 }],
    equipment: { ...head.state.player.equipment, mainHand: 'field_spade' as const } } } })

const farBankLoam = (() => {
  for (let gz = 4; gz <= 8; gz += 1) for (let gx = -7; gx <= 7; gx += 1) {
    if (worldTileAtGrid('wizard-realms', gx, gz).terrain === 'loam'
      && !publicV25RiverCellAtGrid('wizard-realms', gx, gz)
      && publicV25StratumAt('wizard-realms', gx, gz, 0).material === 'soil')
      return { gx, gz }
  }
  throw new Error('Fresh V43 world has no far-bank soil cell for the starter chapter')
})()

// Terrain fixtures exercise read-only projection, not admission of world actions.
const withDig = (head: PublicV43Progress): PublicV43Progress => ({
  ...head, terrain: { ...head.terrain,
    columns: [{ ...farBankLoam, openDepth: 1, rewardDepth: 1, pitLadder: false }],
    bag: { ...head.terrain.bag, soil: 1 } } })
const withSecondDig = (head: PublicV43Progress): PublicV43Progress => ({
  ...head, terrain: { ...head.terrain,
    columns: [{ ...farBankLoam, openDepth: 2, rewardDepth: 2, pitLadder: false }],
    bag: { ...head.terrain.bag, soil: 2 } } })
const withStoneFind = (head: PublicV43Progress): PublicV43Progress => ({
  ...head, terrain: { ...head.terrain,
    columns: [{ ...farBankLoam, openDepth: 3, rewardDepth: 3, pitLadder: false }],
    bag: { ...head.terrain.bag, soil: 2, stone: 1 } },
  miningTools: { ...head.miningTools, basicPickOwned: true, activePick: 'basic' },
  state: { ...head.state, player: { ...head.state.player,
    equipment: { ...head.state.player.equipment, mainHand: null } } } })

describe('V43 starter chapter', () => {
  it('starts at an actionable eight-log objective and renders a semantic, read-only panel', () => {
    const head = fresh(), before = structuredClone(head)
    expect(projectPublicV43StarterChapter(head)).toMatchObject({
      stage: 'gather', complete: false, progressLabel: 'Chapter step 1 of 6' })
    const html = renderToStaticMarkup(createElement(PublicV43StarterChapter, { head }))
    expect(html).toContain('aria-label="Starter chapter"')
    expect(html).toContain('data-starter-chapter="gather"')
    expect(html).toContain('0/8 logs')
    expect(html).toContain('Equip your woodcutter axe')
    expect(html).toContain('Approach the Outfitters keeper and choose Talk')
    expect(head).toEqual(before)
  })

  it('requires the saved creek crossing and bridgehead claim after eight logs', () => {
    const gathered = withLogs(fresh(), 8)
    expect(projectPublicV43StarterChapter(gathered).stage).toBe('crossing')
    const built = withBridge(fresh())
    expect(projectPublicV43StarterChapter(built).stage).toBe('crossing')
    expect(projectPublicV43StarterChapter(built).objective).toContain('Claim')
    const claimed = withBridgeheadClaim(fresh())
    expect(projectPublicV43StarterChapter(claimed).stage).toBe('spade')
  })

  it('projects staged digs and stone evidence without a mandatory soil placement', () => {
    const crossed = withBridgeheadClaim(fresh())
    expect(projectPublicV43StarterChapter(crossed).objective).toContain('Buy a field spade')
    const equipped = withSpade(crossed)
    expect(projectPublicV43StarterChapter(equipped)).toMatchObject({
      stage: 'dig', progressLabel: 'Chapter step 4 of 6' })
    expect(projectPublicV43StarterChapter(equipped).objective).toContain('first of two soil layers')
    const dug = withDig(equipped)
    expect(projectPublicV43StarterChapter(dug)).toMatchObject({
      stage: 'stone-find', progressLabel: 'Chapter step 5 of 6' })
    expect(projectPublicV43StarterChapter(dug).objective).toContain('same safe')
    expect(projectPublicV43StarterChapter(dug).reward).toContain('Placing soil is optional')
    const filled = { ...dug, terrain: { ...dug.terrain,
      columns: [{ ...farBankLoam, openDepth: 0, rewardDepth: 1, pitLadder: false }],
      bag: { ...dug.terrain.bag, soil: 0 } } }
    expect(projectPublicV43StarterChapter(filled)).toMatchObject({ stage: 'stone-find' })
    expect(projectPublicV43StarterChapter(filled).objective).toContain('reopen those layers first')
    expect(projectPublicV43StarterChapter(filled).objective).not.toContain('once more')
    const exposed = withSecondDig(dug)
    expect(projectPublicV43StarterChapter(exposed).objective).toContain('Terrain Mine')
    expect(projectPublicV43StarterChapter(exposed).objective).toContain('equip your basic pick')
    expect(projectPublicV43StarterChapter(withStoneFind(exposed)).stage)
      .toBe('carpenter-order')
    expect(projectPublicV43StarterChapter({ ...dug,
      raisedSoilCells: [{ gx: farBankLoam.gx, gz: farBankLoam.gz }] }).stage)
      .toBe('stone-find')
  })

  it('completes only after the existing carpenter order claim', () => {
    const step = withStoneFind(withSecondDig(withDig(withSpade(withBridgeheadClaim(fresh())))))
    expect(projectPublicV43StarterChapter(step).objective).toContain('4 surplus logs')
    const ordered: PublicV43Progress = { ...step,
      greenwayOrder: { claimedAtSequence: 1 },
      state: { ...step.state, eventSequence: 1 } }
    expect(projectPublicV43StarterChapter(ordered)).toMatchObject({
      stage: 'complete', complete: true,
      progressLabel: 'Chapter complete, 6 of 6 steps' })
  })

  it('retains a shaped stone ledger across atomic reload without a Place Soil gate', async () => {
    const found = withStoneFind(withSecondDig(withDig(withSpade(fresh()))))
    // Structural persistence fixture, not proof that a Mine action was admitted.
    expect(decodePublicV26TerrainLedger(found.terrain)).not.toBeNull()
    const genesis = Object.fromEntries(PUBLIC_V42_PROGRESS_KEYS.map((key) =>
      [key, found[key]])) as PublicV42RewardProgress
    expect(decodePublicV42Progress(genesis)).not.toBeNull()
    const source = createFreshPublicV42Root('wizard-realms')
    const migratedSource: PublicV42Root = { lineage: { origin: 'v41-migration',
      rulesProfile: source.lineage.rulesProfile, seed: source.lineage.seed,
      sourceRevision: 0, genesis }, previous: null,
    head: { ...structuredClone(genesis), schemaVersion: PUBLIC_V42_SCHEMA,
      saveRevision: 0, witness: null } }
    expect(decodePublicV42Root(migratedSource)).not.toBeNull()
    const factory = new IDBFactory(), store = createAtomicV43Store(factory)
    const empty = await store.readChecked()
    if (empty.status !== 'missing') throw Error('Expected empty V43 store')
    expect(await store.commit(empty.proof, createPublicV43Root(migratedSource))).toBe('committed')
    const reopened = await createAtomicV43Store(factory).readChecked()
    if (reopened.status !== 'valid') throw Error('Expected checked V43 save')
    expect(reopened.root.head.raisedSoilCells).toEqual([])
    expect(reopened.root.head.terrain.columns[0].rewardDepth).toBe(3)
    const continued = withBridgeheadClaim(reopened.root.head)
    expect(projectPublicV43StarterChapter(continued).stage).toBe('carpenter-order')
    const soldStone: PublicV43Progress = { ...continued,
      terrain: { ...continued.terrain, bag: { ...continued.terrain.bag, stone: 0 } } }
    expect(projectPublicV43StarterChapter(soldStone).stage).toBe('carpenter-order')
  })
})
