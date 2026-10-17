import { decodeGreenwayProcurementWitness, fulfillGreenwayProcurementOrder }
  from './greenwayProcurementOrder'
import type { GreenwayProcurementRejection, GreenwayProcurementState,
  GreenwayProcurementWitness } from './greenwayProcurementOrder'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { PUBLIC_V42_PROGRESS_KEYS } from './publicWorldV42RewardAction'
import { decodePublicV43FamiliarProgress, PUBLIC_V43_PROGRESS_KEYS }
  from './publicWorldV43FamiliarAction'
import type { PublicV43FamiliarProgress } from './publicWorldV43FamiliarAction'

export type PublicV43LogOrderProgress = PublicV43FamiliarProgress & Readonly<{
  greenwayOrder: GreenwayProcurementState
}>
export type PublicV43LogOrderWitness = GreenwayProcurementWitness
export type PublicV43LogOrderResult = Readonly<{
  progress: PublicV43LogOrderProgress; rejection?: never
}> | Readonly<{ progress?: never; rejection: GreenwayProcurementRejection }>

function familiarOnly(raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(PUBLIC_V43_PROGRESS_KEYS.map((key) => [key, raw[key]]))
}
function v42Only(raw: PublicV43FamiliarProgress): Record<string, unknown> {
  return Object.fromEntries(PUBLIC_V42_PROGRESS_KEYS.map((key) => [key, raw[key]]))
}
function safeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Validate the tiny optional overlay without re-decoding the large world state. */
export function decodePublicV43LogOrderState(raw: unknown,
  eventSequence: number): GreenwayProcurementState | null {
  try {
    if (!safeCount(eventSequence)
      || !exactPublicV23(raw, ['claimedAtSequence'])) return null
    const claimed = raw.claimedAtSequence
    return claimed === null || safeCount(claimed) && claimed >= 1
      && claimed <= eventSequence
      ? { claimedAtSequence: claimed as number | null } : null
  } catch { return null }
}

/** Legacy V43 heads omit the order; its first accepted witness creates it. */
export function createPublicV43LogOrder(source: PublicV43FamiliarProgress):
  PublicV43LogOrderProgress | null {
  const familiar = decodePublicV43FamiliarProgress(familiarOnly(source))
  return familiar ? { ...familiar, greenwayOrder: { claimedAtSequence: null } } : null
}

export function decodePublicV43LogOrderProgress(raw: unknown):
  PublicV43LogOrderProgress | null {
  try {
    if (!exactPublicV23(raw, [...PUBLIC_V43_PROGRESS_KEYS, 'greenwayOrder'])) return null
    const familiar = decodePublicV43FamiliarProgress(familiarOnly(raw))
    const order = familiar && decodePublicV43LogOrderState(raw.greenwayOrder,
      familiar.state.eventSequence)
    return familiar && order ? { ...familiar, greenwayOrder: order } : null
  } catch { return null }
}

export const decodePublicV43LogOrderWitness = decodeGreenwayProcurementWitness

/** Authoritative intent: no quantity, price, or reward comes from the client. */
export function confirmPublicV43LogOrder(raw: PublicV43LogOrderProgress,
  witness: unknown): PublicV43LogOrderResult {
  if (!decodePublicV43LogOrderWitness(witness)) return { rejection: 'invalid_action' }
  const before = decodePublicV43LogOrderProgress(raw)
  if (!before) return { rejection: 'invalid_progress' }
  const fulfilled = fulfillGreenwayProcurementOrder({ ...v42Only(before),
    greenwayOrder: before.greenwayOrder }, witness)
  if (fulfilled.rejection) return { rejection: fulfilled.rejection }
  const next = decodePublicV43LogOrderProgress({ ...fulfilled.progress,
    familiar: before.familiar })
  return next ? { progress: next } : { rejection: 'invalid_value' }
}
