import { highlandLandmark } from './domain/highlandContent'
import { highlandWindCastWindow, highlandWindTrailLocation } from './domain/highlandWindContent'
import type { PublicWorldV12State } from './domain/publicWorldV12State'
import { storeSellUnitPrice } from './domain/world'
import { WORLD_CELL_METERS, worldTileAtGrid } from './domain/worldChunks'
import { publicWorldV11ViewProjection } from './PublicV11WorldView'
import type { WizardFieldCampView, WizardViewProjection, WizardWindwardStepView } from './view/contracts'

const TICKS_PER_SECOND = 20
const secondsLeft = (tick: number, until: number) => Math.ceil(Math.max(0, until - tick) / TICKS_PER_SECOND)
const gridAtWorld = (coordinate: number) => Math.ceil(coordinate / WORLD_CELL_METERS - 0.5)
const distance3 = (from: PublicWorldV12State['player']['position'], to: readonly [number, number, number]) =>
  Math.hypot(from.x - to[0], from.y - to[1], from.z - to[2])
const onFoot = (state: PublicWorldV12State) => state.player.verticalVelocity === 0
  && Math.abs(state.player.position.y - worldTileAtGrid(state.seed,
    gridAtWorld(state.player.position.x), gridAtWorld(state.player.position.z)).center.y) <= 0.001

function knownStoneBuyers(state: PublicWorldV12State, quantity: number): WizardWindwardStepView['stoneReturn'] {
  if (quantity < 1) return undefined
  const known = new Set(state.discoveredTileIds)
  const offers = state.greenway.stores.flatMap((store) => {
    const tile = worldTileAtGrid(state.seed,
      Math.round(store.position.x / WORLD_CELL_METERS), Math.round(store.position.z / WORLD_CELL_METERS))
    const unitPrice = storeSellUnitPrice(store.id, 'stone')
    if (!known.has(tile.id) || unitPrice === null || !Number.isSafeInteger(quantity * unitPrice)) return []
    return [{ storeId: store.id, name: store.name, unitPrice, total: quantity * unitPrice }]
  }).sort((left, right) => right.unitPrice - left.unitPrice || left.storeId.localeCompare(right.storeId))
  return offers.length ? { quantity, offers } : undefined
}

/** Additive v12 read model. Projection never studies, casts, reveals terrain, or changes the saved spell list. */
export function publicWorldV12ViewProjection(state: PublicWorldV12State, messages: readonly string[],
  selectedSiteId: string | null, openStoreId: string | null = null,
  fieldCamp?: WizardFieldCampView): WizardViewProjection {
  const { windContentRevision: _revision, windstep: _windstep, ...v11 } = state
  const base = publicWorldV11ViewProjection(v11, messages, selectedSiteId, openStoreId, fieldCamp)
  const crown = base.landmarks?.find((landmark) => landmark.kind === 'quarry-crown' && landmark.discovered)
  const glyphPosition = crown?.position ?? null
  const stoneQuantity = state.player.inventory
    .filter((stack) => stack.itemId === 'stone').reduce((sum, stack) => sum + stack.quantity, 0)
  const activeSeconds = secondsLeft(state.tick, state.windstep.activeUntilTick)
  const cooldownSeconds = secondsLeft(state.tick, state.windstep.nextCastTick)
  const trail = highlandWindTrailLocation(state.player.position)
  const dryTrail = trail !== null && worldTileAtGrid(state.seed,
    gridAtWorld(state.player.position.x), gridAtWorld(state.player.position.z)).terrain !== 'wetland'
  const stoneReturn = knownStoneBuyers(state, stoneQuantity)
  const availableActionSequence = Number.isSafeInteger(state.eventSequence + 1)
  const windwardStep: WizardWindwardStepView = {
    learned: state.windstep.learned,
    glyph: glyphPosition ? { position: glyphPosition,
      canStudy: !state.windstep.learned && state.highland.landmarkDiscovered
        && state.movementOwner === 'streamed' && onFoot(state) && availableActionSequence
        && distance3(state.player.position, glyphPosition) <= 3 } : null,
    activeSeconds, cooldownSeconds,
    canCast: state.windstep.learned && state.movementOwner === 'streamed'
      && onFoot(state) && activeSeconds === 0 && cooldownSeconds === 0 && dryTrail
      && availableActionSequence && highlandWindCastWindow(state.tick) !== null,
    ...(stoneReturn ? { stoneReturn } : {}),
  }
  return { ...base, windwardStep }
}
