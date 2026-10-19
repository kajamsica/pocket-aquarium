import { describe, expect, it } from 'vitest'
import type { PublicV14Frame } from './publicWorldV14Snapshot'
import { createPublicV23Root, decodePublicV23Progress } from './publicWorldV23Snapshot'
import { advancePublicV23Frames, previewPublicV23Frames } from './publicWorldV23Transitions'
import { createPublicV24Root } from './publicWorldV24Snapshot'
import type { PublicV24Progress } from './publicWorldV24Snapshot'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import { emptyPublicV25ExcavationLedger } from './publicWorldV25Excavation'
import { createPublicV25Migration, PUBLIC_V25_SCHEMA } from './publicWorldV25Migration'
import { createPublicV25Root, decodePublicV25Head, decodePublicV25Root } from './publicWorldV25Snapshot'

const source = () => {
  const { head, lineage } = createPublicV24Root(createPublicV23Root('wizard-realms'))
  return { head, lineage }
}
const genesis = () => createPublicV25Root(source())
const progress = (head: PublicV24Progress) => ({ state: head.state,
  greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks })
const move = (z: number): PublicV14Frame => ({ intents: [{ type: 'move', delta: { x: 0, z } }], walkRequested: false })
const framed = (root: ReturnType<typeof genesis>, frames: PublicV14Frame[]) => {
  const next = advancePublicV23Frames(progress(root.head), frames)
  if (!next) throw new Error(JSON.stringify(previewPublicV23Frames(progress(root.head), frames)))
  return { lineage: root.lineage, previous: root.head, head: { ...root.head, ...next,
    saveRevision: root.head.saveRevision + 1, witness: { kind: 'frame-batch/v1' as const, frames } } }
}
const atGreenway = (point: { x: number; z: number }, builtBridgeId?: string) => {
  const old = source(), base = old.head, greenwayWorks = builtBridgeId
    ? { ...base.greenwayWorks, builtBridgeIds: [builtBridgeId] } : base.greenwayWorks
  const support = publicV17StarterSupportAt({ seed: 'wizard-realms', profile: base.state.generationProfile,
    route: base.state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
    built: false, greenwayWorks }, point)
  if (!support) throw new Error('Missing old support')
  const owned = decodePublicV23Progress({ ...progress(base), greenwayWorks,
    state: { ...base.state, player: { ...base.state.player, xp: builtBridgeId ? 80 : 0,
      skillXp: { ...base.state.player.skillXp, construction: builtBridgeId ? 80 : 0 },
      position: { ...point, y: support.floorY } } } }, 'wizard-realms')
  if (!owned) throw new Error('Invalid old source fixture')
  return createPublicV25Root({ lineage: old.lineage,
    head: { ...base, ...owned, saveRevision: 1, witness: { kind: 'checkpoint' } } })
}

describe('V25 pinned head and genesis', () => {
  it('promotes a V24 receipt into exact independent revision zero without changing its source', () => {
    const old = source(), before = structuredClone(old)
    const root = createPublicV25Root(old), migration = createPublicV25Migration(old)
    expect(Object.keys(root).sort()).toEqual(['head', 'lineage', 'previous'])
    expect(Object.keys(root.head).sort()).toEqual(['excavation', 'greenwayWorks', 'regionalWorks',
      'saveRevision', 'schemaVersion', 'state', 'witness'])
    expect(root).toEqual({ lineage: migration.lineage, previous: null,
      head: { ...migration.progress, schemaVersion: PUBLIC_V25_SCHEMA,
        saveRevision: 0, excavation: emptyPublicV25ExcavationLedger(), witness: null } })
    expect(decodePublicV25Head(root.head, root.lineage)).toEqual(root.head)
    expect(root.lineage.sourceReceipt).toEqual(old)
    expect(root.lineage.sourceReceipt.head).not.toBe(old.head)
    expect(root.head.state).not.toBe(old.head.state)
    expect(old).toEqual(before)
  })

  it('accepts only inherited V24 witness shapes on later heads', () => {
    const root = genesis()
    const next = { ...root.head, saveRevision: 1, witness: { kind: 'checkpoint' as const } }
    expect(decodePublicV25Head(next, root.lineage)).toEqual(next)
    expect(decodePublicV25Head({ ...next, witness: { kind: 'dig', gx: 1 } }, root.lineage)).toBeNull()
    expect(decodePublicV25Head({ ...next, witness: null }, root.lineage)).toBeNull()
    expect(decodePublicV25Head({ ...next, witness: { kind: 'checkpoint', extra: true } },
      root.lineage)).toBeNull()
  })

  it('rejects altered genesis, invalid excavation, and exact-key violations', () => {
    const root = genesis(), head = root.head
    expect(decodePublicV25Head({ ...head, extra: true }, root.lineage)).toBeNull()
    expect(decodePublicV25Head({ ...head, schemaVersion: 'wizard-world/v24' }, root.lineage)).toBeNull()
    expect(decodePublicV25Head({ ...head, saveRevision: -1 }, root.lineage)).toBeNull()
    expect(decodePublicV25Head({ ...head, saveRevision: 1 }, root.lineage)).toBeNull()
    expect(decodePublicV25Head({ ...head, state: { ...head.state, seed: 'other' } },
      root.lineage)).toBeNull()
    expect(decodePublicV25Head({ ...head, state: { ...head.state,
      player: { ...head.state.player, coins: head.state.player.coins + 1 } } },
      root.lineage)).toBeNull()
    expect(decodePublicV25Head({ ...head, excavation: { ...head.excavation,
      bag: { ...head.excavation.bag, soil: -1 } } }, root.lineage)).toBeNull()
    expect(decodePublicV25Head({ ...head, excavation: { ...head.excavation,
      columns: [], extra: true } }, root.lineage)).toBeNull()
  })

  it('rejects invalid source pin and hostile inputs without mutation', () => {
    const root = genesis(), before = structuredClone(root)
    expect(decodePublicV25Head(root.head, { ...root.lineage, seed: 'other' })).toBeNull()
    expect(decodePublicV25Head(root.head, { ...root.lineage,
      rulesProfile: 'other' } as never)).toBeNull()
    expect(decodePublicV25Head(root.head, { ...root.lineage,
      sourceReceipt: { ...root.lineage.sourceReceipt, extra: true } } as never)).toBeNull()
    expect(() => createPublicV25Root({ ...source(), previous: null })).toThrow(RangeError)
    const hostile = <T extends object>(value: T) => new Proxy(value, {
      get() { throw new Error('hostile') },
    })
    expect(() => createPublicV25Root(hostile(source()))).toThrow(RangeError)
    expect(decodePublicV25Head(hostile(root.head), root.lineage)).toBeNull()
    expect(decodePublicV25Head({ ...root.head, excavation: hostile(root.head.excavation) },
      root.lineage)).toBeNull()
    expect(root).toEqual(before)
  })

  it('checks exact root slots, checkpoint replay, revision order, and unchanged excavation', () => {
    const root = genesis(), before = structuredClone(root)
    expect(decodePublicV25Root(root)).toEqual(root)
    expect(decodePublicV25Root({ ...root, extra: true })).toBeNull()
    expect(decodePublicV25Root({ ...root, previous: root.head })).toBeNull()
    const next = { lineage: root.lineage, previous: root.head, head: { ...root.head,
      saveRevision: 1, witness: { kind: 'checkpoint' as const } } }
    expect(decodePublicV25Root(next)).toEqual(next)
    expect(decodePublicV25Root({ ...next, head: { ...next.head, saveRevision: 2 } })).toBeNull()
    expect(decodePublicV25Root({ ...next, previous: { ...root.head,
      state: { ...root.head.state, player: { ...root.head.state.player, coins: 999 } } } })).toBeNull()
    expect(decodePublicV25Root({ ...next, head: { ...next.head,
      excavation: { ...next.head.excavation, bag: { ...next.head.excavation.bag, soil: 1 } } } })).toBeNull()
    expect(decodePublicV25Root({ ...next, head: { ...next.head,
      state: { ...next.head.state, player: { ...next.head.state.player, coins: 999 } } } })).toBeNull()
    expect(root).toEqual(before)
  })

  it('accepts the maximal 128-frame witness through one checked replay', () => {
    const maximal = framed(genesis(), Array.from({ length: 128 }, () =>
      ({ intents: [], walkRequested: false })))
    expect(decodePublicV25Root(maximal)).toEqual(maximal)
  })

  it('accepts dry and saved-bridge frames but rejects a wet intermediate frame', () => {
    const dry = atGreenway({ x: 12, z: 5.7 })
    expect(decodePublicV25Root(framed(dry, [move(0.1)]))?.head.saveRevision).toBe(1)
    const bank = atGreenway({ x: 12, z: 5.9 }), bankBefore = structuredClone(bank)
    expect(decodePublicV25Root(framed(bank, [move(0.16)]))).toBeNull()
    const returnTrip = framed(bank, [move(0.16), move(-0.16)])
    expect(returnTrip.head.state.player.position).toEqual(bank.head.state.player.position)
    expect(decodePublicV25Root(returnTrip)).toBeNull()
    expect(bank).toEqual(bankBefore)
    const site = resolvePublicV17GreenwaySite('wizard-realms', 'works3:bridge:1')!
    if (site.kind !== 'bridge') throw new Error('Missing bridge fixture')
    const bridge = atGreenway(site.gapCenter, site.id)
    expect(decodePublicV25Root(framed(bridge, [move(0.16)]))?.head.saveRevision).toBe(1)
  })
})
