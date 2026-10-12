import { describe, expect, it } from 'vitest'
import { createPublicV23Root } from './publicWorldV23Snapshot'
import { emptyPublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import { emptyPublicV29MiningTools } from './publicWorldV29MiningTools'
import { PUBLIC_V34_SCHEMA } from './publicWorldV34Snapshot'
import type { PublicV34Head } from './publicWorldV34Snapshot'
import { createPublicV35Root, decodePublicV35CheckedSuccessor,
  decodePublicV35Root, replayPublicV35Witness } from './publicWorldV35Snapshot'

function freshV34Head(): PublicV34Head {
  const { head } = createPublicV23Root('wizard-realms')
  return { schemaVersion: PUBLIC_V34_SCHEMA, saveRevision: 0, witness: null,
    state: head.state, greenwayWorks: head.greenwayWorks,
    regionalWorks: head.regionalWorks, terrain: emptyPublicV26TerrainLedger(),
    nextHomeAtMs: 0, riverBridgeIds: [], miningTools: emptyPublicV29MiningTools(),
    claimedBridgeheadId: null, raisedSoilCells: [] }
}

describe('V35 bounded checked lineage', () => {
  it('copies V34 progress into an independent exact V35 genesis', () => {
    const source = freshV34Head(), original = structuredClone(source)
    const root = createPublicV35Root(source)
    expect(decodePublicV35Root(root)).toEqual(root)
    expect(root.lineage.genesis).not.toBe(source)
    expect(root.head).toMatchObject({ saveRevision: 0,
      ledgerSurveyBridgeId: null, ledgerClaimReward: null })
    expect(source).toEqual(original)
    expect(decodePublicV35Root({ ...root, extra: 1 })).toBeNull()
    expect(decodePublicV35Root({ ...root, head: { ...root.head,
      ledgerClaimReward: 'coins' } })).toBeNull()
  })

  it('replays an inherited successor, but rejects forged payout and stale predecessor', () => {
    const root = createPublicV35Root(freshV34Head())
    const witness = { kind: 'checkpoint' as const }
    const replayed = replayPublicV35Witness(root.head, witness)
    if (!replayed) throw new Error('Inherited checkpoint did not replay')
    const next = { lineage: root.lineage, previous: root.head,
      head: { ...root.head, ...replayed, witness, saveRevision: 1 } }
    expect(decodePublicV35CheckedSuccessor(root, next)).toEqual(next)
    expect(decodePublicV35Root(next)).toEqual(next)
    expect(decodePublicV35CheckedSuccessor(root, { ...next,
      head: { ...next.head, ledgerClaimReward: 'coins' } })).toBeNull()
    expect(decodePublicV35CheckedSuccessor(root, { ...next,
      previous: { ...root.head, saveRevision: 1 } })).toBeNull()
    expect(decodePublicV35Root({ ...next, head: { ...next.head,
      witness: { kind: 'ledger-deliver/v1', reward: 'coins' } } })).toBeNull()
  })
})
