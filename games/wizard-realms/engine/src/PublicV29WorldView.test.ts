import { describe, expect, it } from 'vitest'
import { createPublicV23Root } from './domain/publicWorldV23Snapshot'
import { emptyPublicV26TerrainLedger } from './domain/publicWorldV26TerrainLedger'
import { emptyPublicV29MiningTools } from './domain/publicWorldV29MiningTools'
import type { PublicV29Progress } from './domain/publicWorldV29Migration'
import { projectPublicV29WorldView } from './PublicV29WorldView'
import type { WizardViewProjection } from './view/contracts'

const seed = 'greenway-alpha'
function fixture(): { progress: PublicV29Progress; carrier: WizardViewProjection } {
  const { head } = createPublicV23Root(seed)
  const store = head.state.greenway.stores.find((entry) => entry.id === 'store-greenway')!
  const state = { ...head.state, player: { ...head.state.player,
    position: store.position, coins: 34 } }
  const progress: PublicV29Progress = { state, greenwayWorks: head.greenwayWorks,
    regionalWorks: head.regionalWorks, terrain: emptyPublicV26TerrainLedger(),
    nextHomeAtMs: 0, riverBridgeIds: [], miningTools: emptyPublicV29MiningTools() }
  const carrier = { seed, player: { position: [store.position.x, store.position.y,
    store.position.z], yaw: 0, pitch: 0 } } as unknown as WizardViewProjection
  return { progress, carrier }
}

describe('V29-only mining view', () => {
  it('projects virtual canonical offers and exact skill/coin gates without adding old listings', () => {
    const { progress, carrier } = fixture()
    const view = projectPublicV29WorldView(progress, carrier)
    expect(view.v29Mining).toMatchObject({ atOutfitters: true, excavationLevel: 1,
      offers: [{ tier: 'basic', price: 35, owned: false, buyReason: 'Needs 1 more coins.' },
        { tier: 'enchanted', price: 240, owned: false,
          buyReason: 'Requires Excavation level 25.' }],
      bids: { soil: 1, stone: 3, iron_ore: 8, gold_ore: 15, diamond: 60 } })
    expect(view.stores).toBe(carrier.stores)
    expect(view.backpack).toBe(carrier.backpack)
    const ready = projectPublicV29WorldView({ ...progress,
      state: { ...progress.state, player: { ...progress.state.player,
        coins: 240, skillXp: { ...progress.state.player.skillXp, excavation: 720 } } } }, carrier)
    expect(ready.v29Mining?.offers.every((offer) => offer.buyReason === null)).toBe(true)
  })

  it('keeps the virtual offer tied to the checked store and rejects a mismatched carrier', () => {
    const { progress, carrier } = fixture()
    const away = { ...progress, state: { ...progress.state,
      player: { ...progress.state.player, position: { x: 80, y: 0, z: 80 } } } }
    const awayCarrier = { ...carrier, player: { ...carrier.player,
      position: [80, 0, 80] as const } }
    expect(projectPublicV29WorldView(away, awayCarrier).v29Mining?.atOutfitters).toBe(false)
    expect(projectPublicV29WorldView(away, awayCarrier).v29Mining?.offers[0].buyReason)
      .toContain('within 3 m')
    expect(() => projectPublicV29WorldView(progress, awayCarrier)).toThrow(/match/)
  })
})
