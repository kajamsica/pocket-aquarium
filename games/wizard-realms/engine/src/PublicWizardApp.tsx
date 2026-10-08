import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { eventText as greenwayEventText, intentForView, objectiveFor, retainOpenStoreId } from './App'
import { bearingText, mireglassActionChoices, mireglassEventText, mireglassNearestInteractChoice, mireglassNextObjective } from './MireglassPlayableApp'
import { publicWorldViewProjection } from './PublicWorldView'
import { streamedControlIntents } from './StreamedPreviewApp'
import { MIREGLASS_CONTENT_REVISION, MIREGLASS_CORE } from './domain/mireglassContent'
import { HERB_CYCLE_TICKS } from './domain/mireglassHerbForaging'
import type { HerbHarvestEntry, MireglassHerbRegionProgress } from './domain/mireglassHerbForaging'
import { mireglassHerbPatches } from './domain/mireglassHerbPatches'
import { areaAt } from './domain/generation'
import { applyFieldCampAction, applyFieldCampV10Action, resolveFieldCampSite } from './domain/fieldCamp'
import type { MireglassWorldState } from './domain/mireglassWorld'
import { routeBuildOptions } from './domain/routeSites'
import { actPublicMireglass, actPublicV10Mireglass, type PublicMireglassAction } from './domain/publicWorldActions'
import { advancePublicWorldFrame, advancePublicWorldV10Frame,
  type PublicWorldAdvanceResult, type PublicWorldEvent, type PublicWorldIntent } from './domain/publicWorldRuntime'
import { createFreshPublicWorld, createPublicWorldFromBootstrap, type PublicWorldState } from './domain/publicWorldState'
import {
  PUBLIC_V6_ROOT_KEY, PUBLIC_V6_SCHEMA, commitLegacyImportToPublicV6, commitPublicV6World, inspectLegacyImportSource,
  inspectPublicV6Artifacts, loadPublicV6Root, parsePublicV6BootstrapRoot, parsePublicV6PlayableRoot,
  readPublicV6RecoverySnapshot, recoverPublicV6Root, serializePublicV6World,
  type LegacyImportInspection, type PublicV6ArtifactInspection, type PublicV6RecoverySnapshot, type PublicV6RootLoad,
} from './domain/publicWorldV6'
import { parsePublicV7PlayableRoot } from './domain/publicWorldV7'
import {
  clearArchivedStaleV7Stage, commitPublicV7Snapshot, importLegacyToPublicV7, inspectPublicV7Entry,
  reconcilePublicV7FreshFork, reconcilePublicV7RootConflict, recoverPublicV7Snapshot,
  resumePublicV7, startFreshPublicV7, unsavedPublicV7Bytes, upgradePublicV6,
  type PublicV7Operation, type PublicV7Start, type PublicWorldV7EntryInspection, type PublicWorldV7State,
} from './domain/publicWorldV7Flow'
import type { PublicV7RecoverySnapshot } from './domain/publicWorldV7Recovery'
import type { PublicV7RootConflictChoice } from './domain/publicWorldV7RootConflict'
import type { PublicV7FreshForkChoice } from './domain/publicWorldV7FreshFork'
import type { PublicV8Operation, PublicV8Start } from './domain/publicWorldV8Flow'
import type { PublicV9Operation, PublicV9Start } from './domain/publicWorldV9Flow'
import { serializePublicV9Rescue, type PublicV9SourceReceipt } from './domain/publicWorldV9Snapshot'
import type { PublicWorldV9State } from './domain/publicWorldV9State'
import type { PublicV10Operation, PublicV10Start } from './domain/publicWorldV10Flow'
import { serializePublicV10Rescue, type PublicV10SourceReceipt } from './domain/publicWorldV10Snapshot'
import type { PublicWorldV10State } from './domain/publicWorldV10State'
import type { PublicV6BootstrapRoot } from './domain/publicWorldV6'
import type { GenerationProfile, PlayerState, WizardWorldState } from './domain/types'
import { WizardSurface, type WizardViewIntent } from './view'
import type { WizardFieldCampView } from './view/contracts'
import { createFixedInputClock, createTimedMovementSampler, recordTimedMovement, sampleFixedInputBatch } from './view/timedInput'

const SEED = 'greenway-alpha'
const STEP_MS = 50
const MAX_CATCH_UP_STEPS = 12
const TRAVEL_SAVE_MS = 5_000
export const publicSaveableVersion = (version: number, events: readonly PublicWorldEvent[]) =>
  version + (events.length ? 1 : 0)
export const publicTravelFlushNeeded = (dirty: boolean, version: number, lastQueuedVersion: number) =>
  dirty && version !== lastQueuedVersion
/** Shared across tabs. Every public v6 read that can lead to a write uses this lock. */
export const PUBLIC_V6_LOCK_NAME = `${PUBLIC_V6_ROOT_KEY}:exclusive`

export interface PublicLockProvider {
  request<T>(name: string, options: { mode: 'exclusive' }, callback: () => T | Promise<T>): Promise<T>
}
export type PublicOperation<T> = { ok: true; value: T } | { ok: false; reason: string }
const failed = (reason: string): PublicOperation<never> => ({ ok: false, reason })
const succeeded = <T,>(value: T): PublicOperation<T> => ({ ok: true, value })
async function withPublicLock<T>(locks: PublicLockProvider | undefined,
  operation: () => PublicOperation<T>): Promise<PublicOperation<T>> {
  if (!locks) return failed('lock-unavailable')
  try { return await locks.request(PUBLIC_V6_LOCK_NAME, { mode: 'exclusive' }, operation) }
  catch { return failed('storage-error') }
}

export interface PublicEntryInspection {
  root: PublicV6RootLoad
  classic: LegacyImportInspection
  expanded: LegacyImportInspection
  artifacts: PublicV6ArtifactInspection
  recovery: ReturnType<typeof readPublicV6RecoverySnapshot>
}
function publicEntryBlockReason(entry: PublicEntryInspection): string | null {
  const { root, classic, expanded, artifacts, recovery } = entry
  if (root.status === 'storage-error' || artifacts.status === 'storage-error'
    || recovery.status === 'storage-error' || classic.status === 'storage-error'
    || expanded.status === 'storage-error') return 'unreadable storage'
  if (root.status === 'invalid') return 'invalid root'
  if (artifacts.stage.status === 'pending' || artifacts.stage.status === 'invalid') return 'pending or invalid stage'
  if (artifacts.backup.status === 'invalid') return 'invalid backup'
  return null
}
export function inspectPublicEntry(storage: Pick<Storage, 'getItem'>,
  locks: PublicLockProvider | undefined): Promise<PublicOperation<PublicEntryInspection>> {
  return withPublicLock(locks, () => {
    const root = loadPublicV6Root(storage)
    return succeeded({ root,
      classic: root.status === 'missing' ? inspectLegacyImportSource(storage, 'greenway-classic-v1') : { status: 'missing' },
      expanded: root.status === 'missing' ? inspectLegacyImportSource(storage, 'greenway-expanded-v1') : { status: 'missing' },
      artifacts: inspectPublicV6Artifacts(storage), recovery: readPublicV6RecoverySnapshot(storage) })
  })
}

export type PublicRecoverySource = 'root' | 'stage' | 'backup'
const RECOVERY_SOURCES: readonly { source: PublicRecoverySource; label: string; detail: string }[] = [
  { source: 'root', label: 'Keep committed root', detail: 'Retain the current validated root and settle its stage.' },
  { source: 'stage', label: 'Use validated stage', detail: 'Promote the staged progress that did not finish publishing.' },
  { source: 'backup', label: 'Restore verified backup', detail: 'Return to the prior validated save.' },
]
export function publicRecoveryChoices(snapshot: PublicV6RecoverySnapshot) {
  return RECOVERY_SOURCES.filter(({ source }) => {
    const bytes = source === 'root' ? snapshot.rootBytes : source === 'stage' ? snapshot.stageBytes : snapshot.backupBytes
    return bytes !== null && !!(parsePublicV6BootstrapRoot(bytes) ?? parsePublicV6PlayableRoot(bytes))
  })
}
export function recoverPublicWorld(storage: Pick<Storage, 'getItem' | 'setItem'>,
  locks: PublicLockProvider | undefined, source: PublicRecoverySource,
  expected: PublicV6RecoverySnapshot): Promise<PublicOperation<{ archiveKey: string }>> {
  return withPublicLock(locks, () => {
    // Read and the complete verified archive/publish operation share the same cross-tab lock.
    const current = readPublicV6RecoverySnapshot(storage)
    if (current.status === 'storage-error') return failed('storage-error')
    const result = recoverPublicV6Root(storage, source, expected)
    return result.status === 'recovered' ? succeeded({ archiveKey: result.archiveKey }) : failed(result.status)
  })
}

export interface PublicStart { state: PublicWorldState; bytes: string }
function commitChecked(storage: Pick<Storage, 'getItem' | 'setItem'>, state: PublicWorldState,
  expectedBytes: string | null, confirmedFreshStartWithLegacy = false): PublicOperation<PublicStart> {
  const artifacts = inspectPublicV6Artifacts(storage)
  if (artifacts.status === 'storage-error') return failed('storage-error')
  if (artifacts.stage.status === 'pending' || artifacts.stage.status === 'invalid') return failed('pending-stage')
  if (artifacts.backup.status === 'invalid') return failed('invalid-backup')
  const current = loadPublicV6Root(storage)
  if (current.status === 'invalid' || current.status === 'storage-error') return failed(current.status)
  if (('bytes' in current ? current.bytes : null) !== expectedBytes) return failed('root-changed')
  const result = commitPublicV6World(storage, state, expectedBytes, { confirmedFreshStartWithLegacy })
  return result.status === 'committed' ? succeeded({ state: result.root.state, bytes: result.bytes }) : failed(result.status)
}
export function commitPublicSnapshot(storage: Pick<Storage, 'getItem' | 'setItem'>,
  locks: PublicLockProvider | undefined, state: PublicWorldState, expectedBytes: string | null,
  confirmedFreshStartWithLegacy = false): Promise<PublicOperation<PublicStart>> {
  return withPublicLock(locks, () => commitChecked(storage, state, expectedBytes, confirmedFreshStartWithLegacy))
}
export function resumePublicWorld(storage: Pick<Storage, 'getItem' | 'setItem'>,
  locks: PublicLockProvider | undefined, expectedBytes: string): Promise<PublicOperation<PublicStart>> {
  return withPublicLock(locks, () => {
    const artifacts = inspectPublicV6Artifacts(storage)
    if (artifacts.status === 'storage-error' || artifacts.stage.status === 'pending' || artifacts.stage.status === 'invalid'
      || artifacts.backup.status === 'invalid')
      return failed('pending-stage')
    const root = loadPublicV6Root(storage)
    if (!('bytes' in root) || root.bytes !== expectedBytes) return failed('root-changed')
    if (root.status === 'valid-playable') return succeeded({ state: root.root.state, bytes: root.bytes })
    const state = createPublicWorldFromBootstrap(root.root)
    return commitChecked(storage, state, root.bytes)
  })
}
export function importPublicWorld(storage: Pick<Storage, 'getItem' | 'setItem'>,
  locks: PublicLockProvider | undefined,
  inspected: Extract<LegacyImportInspection, { status: 'available' }>): Promise<PublicOperation<PublicStart>> {
  return withPublicLock(locks, () => {
    const artifacts = inspectPublicV6Artifacts(storage)
    if (artifacts.status === 'storage-error' || artifacts.stage.status === 'pending' || artifacts.stage.status === 'invalid'
      || artifacts.backup.status === 'invalid')
      return failed('pending-stage')
    if (loadPublicV6Root(storage).status !== 'missing') return failed('root-present')
    const imported = commitLegacyImportToPublicV6(storage, inspected)
    if (imported.status !== 'committed') return failed(imported.status)
    const bootstrap = loadPublicV6Root(storage)
    if (bootstrap.status !== 'valid-bootstrap') return failed('bootstrap-verification-failed')
    return commitChecked(storage, createPublicWorldFromBootstrap(bootstrap.root), bootstrap.bytes)
  })
}
export function startFreshPublicWorld(storage: Pick<Storage, 'getItem' | 'setItem'>,
  locks: PublicLockProvider | undefined, profile: GenerationProfile,
  confirmedFreshStartWithLegacy: boolean): Promise<PublicOperation<PublicStart>> {
  return withPublicLock(locks, () => {
    if (loadPublicV6Root(storage).status !== 'missing') return failed('root-present')
    return commitChecked(storage, createFreshPublicWorld(SEED, profile), null, confirmedFreshStartWithLegacy)
  })
}

export function greenwayForPublicView(state: PublicWorldState): WizardWorldState {
  return { ...state.greenway, seed: state.seed, generationProfile: state.generationProfile,
    tick: state.tick, rng: state.rng, eventSequence: state.eventSequence,
    player: state.player as PlayerState, discoveredTileIds: [...state.discoveredTileIds] }
}
export function mireglassForPublicView(state: PublicWorldState): MireglassWorldState {
  return { seed: state.seed, contentRevision: MIREGLASS_CONTENT_REVISION, tick: state.tick,
    player: state.player, discoveredTileIds: state.discoveredTileIds, expedition: state.mireglass }
}
/** Nonmovement frames stay separate; each sampled look+move occupies exactly one 50 ms frame. */
export function advancePublicControls(state: PublicWorldState, queued: readonly (readonly PublicWorldIntent[])[],
  samples: readonly (readonly [number, number])[], v10Bootstrap: PublicV6BootstrapRoot | null = null): PublicWorldAdvanceResult {
  let next = state
  const events: PublicWorldAdvanceResult['events'] = []
  const rejections: PublicWorldAdvanceResult['rejections'] = []
  const isV10 = 'terrainRevision' in state
  const advance = (intents: readonly PublicWorldIntent[]) => isV10
    ? advancePublicWorldV10Frame(requirePublicV10State(next), intents, v10Bootstrap)
    : advancePublicWorldFrame(next, intents)
  for (const frame of queued) {
    const result = advance(frame)
    next = result.state; events.push(...result.events); rejections.push(...result.rejections)
  }
  for (const sample of samples) {
    const result = advance(streamedControlIntents(next.player.yaw, sample))
    next = result.state; events.push(...result.events); rejections.push(...result.rejections)
  }
  return { state: next, events, rejections }
}

/** An exportable valid root for progress that could not be committed on this device. */
export function unsavedPublicWorldBytes(state: PublicWorldState, lastCommittedBytes: string | null): string | null {
  const prior = lastCommittedBytes === null ? null : parsePublicV6PlayableRoot(lastCommittedBytes)
  if (!prior || !Number.isSafeInteger(prior.saveRevision + 1)) return null
  try {
    return serializePublicV6World({ schemaVersion: PUBLIC_V6_SCHEMA,
      saveRevision: prior.saveRevision + 1, bootstrap: prior.bootstrap, state })
  } catch { return null }
}

const STYLES = `
.wr-public,.wr-public-menu{position:fixed;inset:0;background:#14221f;color:#f5f1df;font:14px/1.4 system-ui}.wr-public .wr-surface{min-height:0}
.wr-public-menu{display:grid;place-items:center;padding:20px;box-sizing:border-box}.wr-public-card{box-sizing:border-box;width:min(560px,100%);max-height:90vh;overflow:auto;padding:24px;border:1px solid #c9ad6680;border-radius:18px;background:#101a17f4;box-shadow:0 20px 60px #0008}.wr-public-card h1{margin:0 0 8px;color:#f5d889;font:700 30px Georgia,serif}.wr-public-card p{color:#c5d0c3}.wr-public-card button,.wr-public-panel button{min-height:44px;padding:7px 12px;border:1px solid #d5b86f77;border-radius:8px;background:#324b3d;color:#fff0c7;font:inherit;cursor:pointer}.wr-public-card button{display:block;width:100%;margin:8px 0;text-align:left}.wr-public-card button:disabled,.wr-public-panel button:disabled{opacity:.5;cursor:not-allowed}.wr-public-warning{padding:9px;border:1px solid #e3a27788;border-radius:8px;background:#4b2824e8;color:#ffe0d4!important}
.wr-public-panel{position:absolute;z-index:8;right:12px;top:12px;box-sizing:border-box;width:min(315px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;padding:12px;border:1px solid #c9ad6680;border-radius:12px;background:#101a17ed;box-shadow:0 10px 32px #0008}.wr-public-panel h1{margin:0;color:#f5d889;font:700 19px Georgia,serif}.wr-public-panel p{margin:6px 0}.wr-public-panel small{color:#b8c9bb}.wr-public-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}.wr-public-actions button{text-align:left}.wr-public-actions small{display:block}.wr-public-panel[data-collapsed=true]{width:auto}.wr-public-panel[data-collapsed=true] .wr-public-body{display:none}.wr-public[data-owner=streamed] .wr-gear,.wr-public[data-owner=streamed] .wr-trade{display:none}
.wr-public-next{position:absolute;z-index:7;top:58px;left:50%;transform:translateX(-50%);box-sizing:border-box;width:min(410px,calc(100vw - 260px));margin:0;padding:7px 10px;border:1px solid #d5b86f77;border-radius:10px;background:#101a17dc;color:#fff0c7;font:600 13px/1.35 system-ui,sans-serif;text-align:center;pointer-events:none;box-shadow:0 6px 20px #0006}.wr-public-next[hidden]{display:none}.wr-public-next strong{color:#f5d889}.wr-public-next small{display:block;margin-top:3px;color:#c5d0c3;font-size:11px;font-weight:400}
@media(min-width:840px){.wr-public[data-owner=greenway] .wr-public-panel{right:318px;top:160px;width:min(315px,calc(100vw - 636px));max-height:max(180px,calc(100vh - 400px))}}
@media(min-width:720px) and (max-width:839px){.wr-public[data-owner=greenway] .wr-public-panel[data-collapsed=false]{inset:8px;width:auto;max-height:none;background:#101a17}.wr-public[data-owner=greenway]:has(.wr-public-panel[data-collapsed=false]) .wr-hud{visibility:hidden}}
@media(min-width:720px) and (max-width:839px){.wr-public[data-owner=greenway] .wr-public-panel[data-collapsed=true]{left:50%;right:auto;top:124px;transform:translateX(-50%);width:104px;padding:4px}.wr-public[data-owner=greenway] .wr-public-panel[data-collapsed=true] button{width:100%;padding:5px 2px;font-size:12px}}
@media(max-width:900px){.wr-public-next{top:56px;width:min(360px,calc(100vw - 150px));font-size:12px}}
@media(max-width:719px){.wr-public-panel{top:154px;bottom:auto;max-height:calc(100vh - 346px)}.wr-public-panel[data-collapsed=true]{padding:4px}.wr-public-panel[data-collapsed=false]{inset:8px;width:auto;max-height:none;background:#101a17}.wr-public:has(.wr-public-panel[data-collapsed=false]) .wr-hud{visibility:hidden}.wr-public-next{top:62px;left:12px;transform:none;width:calc(100vw - 24px);max-height:84px;overflow:auto;text-align:left;pointer-events:auto}.wr-public .wr-backpack-toggle,.wr-public .wr-map-toggle{top:154px}.wr-public .wr-prompt{top:210px}.wr-public .wr-events{top:286px}.wr-public .wr-surface[data-backpack-open=true] .wr-backpack{top:204px;max-height:calc(100% - 220px)}}
@media(max-width:719px){.wr-public:has([data-store-panel]) .wr-public-next{display:none}}
.wr-public:has([data-store-panel],.wr-build-preview) .wr-public-panel{display:none}
@media(max-width:719px) and (max-height:400px){.wr-public:has([data-ring-panel]) .wr-public-panel,.wr-public:has([data-ring-panel]) .wr-public-next{display:none}}
`

const locks = () => typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: PublicLockProvider }).locks : undefined
const storage = () => { try { return window.localStorage } catch { return null } }
const transientSaveFailure = (reason: string | null) => reason === 'storage-error' || reason === 'lock-unavailable'
const errorText = (reason: string) => `Save blocked (${reason}). Existing bytes were preserved. ${transientSaveFailure(reason)
  ? 'Retry Save to keep your in-memory progress.' : 'Do not clear site data. Recovery requires a verified save operation.'}`
const eventText = (type: string) => type.replaceAll('_', ' ')
export function publicWorldEventText(event: PublicWorldEvent): string {
  const itemId = 'itemId' in event && typeof event.itemId === 'string' ? event.itemId : null
  const regionalName = itemId === 'mireglass_reach/item/seal' ? 'Mireglass seal'
    : itemId === 'mireglass_reach/item/waders' ? 'Fen waders' : null
  if (regionalName) {
    if (event.type === 'item_unequipped') return `Unequipped ${regionalName}.`
    if (event.type === 'trade_listing_created') return `Listed ${event.quantity} ${regionalName} for trade.`
    if (event.type === 'trade_listing_cancelled') return `Returned ${event.quantity} ${regionalName} to your backpack.`
    if (event.type === 'trade_listing_sold') return `A market buyer paid ${event.totalPrice}g for ${event.quantity} ${regionalName}.`
  }
  return greenwayEventText(event as Parameters<typeof greenwayEventText>[0]) || eventText(event.type)
}
function publicRejectionText(state: PublicWorldState,
  rejection: PublicWorldAdvanceResult['rejections'][number]): string {
  if (rejection.intentType === 'move' && rejection.code === 'fen_channel') {
    return state.mireglass.builtRoutes.bridge
      ? 'The fen channel cannot be swum across. Use “Cross Fen bridge” (or “Return by Fen bridge” from the far bank) when in reach.'
      : 'The fen channel needs a bridge. Build the Fen bridge from a marked bank (8 logs), then use its Cross action.'
  }
  if (rejection.intentType === 'move' && rejection.code === 'slate_cliff') {
    return state.mireglass.builtRoutes.ladder
      ? 'The slate cliff cannot be walked up. Use “Cross Slate ladder” (or “Return by Slate ladder” from above) when in reach.'
      : 'The slate cliff needs a ladder. Build the Slate ladder from its marked base (4 logs), then use its Cross action.'
  }
  return rejection.message
}
export function publicFrameMessages(result: PublicWorldAdvanceResult): string[] {
  const cast = result.events.find((event) => event.type === 'spell_cast')
  const otherEvents = result.events.filter((event) => event.type !== 'player_moved'
    && event.type !== 'player_looked' && event !== cast
    && !(cast && event.type === 'tile_discovered'))
  return [...otherEvents.map(publicWorldEventText), ...result.rejections.map((rejection) => publicRejectionText(result.state, rejection)),
    ...(cast ? [publicWorldEventText(cast)] : [])].filter(Boolean)
}
export const appendMessages = (current: string[], additions: readonly string[], dedupeConsecutive = false): string[] => {
  const next = dedupeConsecutive
    ? additions.filter((text, index) => text !== (index === 0 ? current.at(-1) : additions[index - 1]))
    : additions
  return next.length ? [...current, ...next].slice(-4) : current
}
const herbLedger = (state: PublicWorldState): readonly HerbHarvestEntry[] | null => {
  const cycles = (state.mireglass as Partial<MireglassHerbRegionProgress>).herbHarvestCycles
  return Array.isArray(cycles) ? cycles : null
}
function requirePublicV7State(state: PublicWorldState): PublicWorldV7State {
  if (!herbLedger(state)) throw new RangeError('The public v7 herb history was lost.')
  return state as PublicWorldV7State
}
export function requirePublicV9State(state: PublicWorldState, previous?: PublicWorldState): PublicWorldV9State {
  const next = requirePublicV7State(state)
  if (!('fieldCampTileIds' in next) || !Array.isArray(next.fieldCampTileIds)) {
    throw new RangeError('The public v9 camp history was lost.')
  }
  const camps = next.fieldCampTileIds
  const priorCamps = (previous as Partial<PublicWorldV9State> | undefined)?.fieldCampTileIds
  if (previous && (!priorCamps || priorCamps.length !== camps.length
    || priorCamps.some((id, index) => id !== camps[index]))) {
    throw new RangeError('A world transition changed the public v9 camp history.')
  }
  return next as PublicWorldV9State
}

export function requirePublicV10State(state: PublicWorldState, previous?: PublicWorldState): PublicWorldV10State {
  const next = requirePublicV9State(state, previous)
  if (!('terrainRevision' in next) || next.terrainRevision !== 'mireglass-cache-pit-v1') {
    throw new RangeError('The v10 terrain revision was lost.')
  }
  if (previous && 'terrainRevision' in previous && previous.mireglass.cacheExcavated
    && !next.mireglass.cacheExcavated) throw new RangeError('The v10 excavation history was lost.')
  return next as PublicWorldV10State
}

export function publicFieldCampView(state: PublicWorldV9State, selectedTileId: string | null,
  source: PublicV9SourceReceipt | PublicV10SourceReceipt, blocked: boolean): WizardFieldCampView {
  const selectionEnabled = !blocked && state.movementOwner === 'streamed' && state.fieldCampTileIds.length === 0
  const tileId = selectionEnabled ? selectedTileId : null
  const previewPosition = tileId === null ? null : resolveFieldCampSite(state.seed, tileId)?.tile.center
  const position = state.player.position
  // Aim at a broad basin entry area, never a generated or selectable camp tile.
  const approach = { x: Math.max(MIREGLASS_CORE.maxX - 32, Math.min(position.x, MIREGLASS_CORE.maxX)),
    z: Math.max(MIREGLASS_CORE.minZ, Math.min(position.z, MIREGLASS_CORE.minZ + 32)) }
  const meters = Math.round(Math.hypot(approach.x - position.x, approach.z - position.z) / 10) * 10
  const guidance = blocked || state.fieldCampTileIds.length ? null
    : `Inner basin approach is ${meters < 10 ? 'here' : `roughly ${bearingText(position, approach)} of here, about ${meters} m direct`}. A camp can be built on suitable loam before the fen bridge. It costs 4 logs + 1 stone; the bridge costs 8 logs, so reserve 4 additional logs beyond the bridge supply if building both. ⌂ appears on discovered suitable ground.`
  return { selectionEnabled, guidance, camps: state.fieldCampTileIds.flatMap((id) => {
    const site = resolveFieldCampSite(state.seed, id)
    return site ? [{ tileId: id, position: [site.tile.center.x, site.tile.center.y, site.tile.center.z] as const }] : []
  }), preview: tileId === null ? null : { tileId,
    position: previewPosition ? [previewPosition.x, previewPosition.y, previewPosition.z] : null,
    rejection: 'sourceV9Head' in source
      ? applyFieldCampV10Action(requirePublicV10State(state), tileId, source.sourceV9Head.bootstrap).rejection ?? null
      : applyFieldCampAction(state, tileId, source.sourceV8Head.bootstrap).rejection ?? null } }
}

export function unsavedPublicV9Bytes(state: PublicWorldV9State, source: PublicV9SourceReceipt,
  savedRevision: number): string | null {
  try { return serializePublicV9Rescue(state, source.sourceV8Head.bootstrap, savedRevision + 1, source) }
  catch { return null }
}

export function unsavedPublicV10Bytes(state: PublicWorldV10State, source: PublicV10SourceReceipt,
  savedRevision: number): string | null {
  try { return serializePublicV10Rescue(state, source.sourceV9Head.bootstrap, savedRevision + 1, source) }
  catch { return null }
}

export function publicV7RecoveryChoices(snapshot: PublicV7RecoverySnapshot,
  storage: Pick<Storage, 'getItem'>) {
  const v6 = loadPublicV6Root(storage)
  if (v6.status === 'storage-error') return []
  return RECOVERY_SOURCES.filter(({ source }) => {
    const bytes = source === 'root' ? snapshot.rootBytes : source === 'stage' ? snapshot.stageBytes : snapshot.backupBytes
    const root = bytes === null ? null : parsePublicV7PlayableRoot(bytes)
    return root !== null && (root.migrationSourceV6Bytes === null
      ? v6.status === 'missing' : 'bytes' in v6 && v6.bytes === root.migrationSourceV6Bytes)
  })
}

const FRESH_FORK_CHOICE_COPY: Record<PublicV7FreshForkChoice,
  { label: string; confirmation: string; result: string }> = {
    'continue-v7': {
      label: 'Keep my current fresh v7 journey and archive the later v6 save',
      confirmation: 'Confirm current fresh v7 journey and preserve both originals in an archive',
      result: 'The current fresh v7 journey remains active.',
    },
    'use-v7-stage': {
      label: 'Keep the pending newer fresh v7 save and archive the later v6 save',
      confirmation: 'Confirm pending newer fresh v7 save and preserve both originals in an archive',
      result: 'The pending newer fresh v7 save is active.',
    },
    'use-v6': {
      label: 'Use the later v6 save and archive my fresh v7 journey',
      confirmation: 'Confirm later v6 save and preserve both originals in an archive',
      result: 'The later v6 save was upgraded to v7.',
    },
  }
export function publicFreshForkChoiceCopy(choice: PublicV7FreshForkChoice) {
  return FRESH_FORK_CHOICE_COPY[choice]
}

export function publicPendingV7StageGuidance(freshForkEligible: boolean, otherChoiceAvailable: boolean): string | null {
  if (freshForkEligible) {
    return 'A fresh v7 start was interrupted before its root finished saving, and a later v6 save now exists. Choose explicitly which progress to keep. Both branches will be archived before publishing your choice; the v6 save stays unchanged.'
  }
  if (!otherChoiceAvailable) {
    return 'No safe recovery choice is available for these saved bytes. Keep this site data and all saves. Reload only rechecks storage; it cannot repair the conflict on its own.'
  }
  return null
}

export function publicHerbChoices(state: PublicWorldState) {
  const harvested = herbLedger(state)
  if (state.movementOwner !== 'streamed' || !harvested) return []
  const cycle = Math.floor(state.tick / HERB_CYCLE_TICKS)
  return mireglassHerbPatches(state.seed).flatMap((patch) => {
    const meters = Math.hypot(state.player.position.x - patch.tile.center.x,
      state.player.position.y - patch.tile.center.y, state.player.position.z - patch.tile.center.z)
    const last = harvested.find((entry) => entry.patchId === patch.id)
    if (meters > 3 || (last && last.cycle >= cycle)) return []
    return [{ id: `forage:${patch.id}`, label: 'Gather marsh herb',
      detail: 'Regrows after five game-time minutes; Greenway buys herbs for 3g',
      action: { type: 'forage_herb' as const, patchId: patch.id }, distanceMeters: meters }]
  })
}

export function publicHerbRouteHint(state: PublicWorldState): string | null {
  const harvested = herbLedger(state)
  if (!harvested) return null
  const held = state.player.inventory.find((stack) => stack.itemId === 'marsh_herb')?.quantity ?? 0
  if (held) return `Take ${held} marsh herb${held === 1 ? '' : 's'} back to Greenway Outfitters to sell for 3g each.`
  if (state.movementOwner === 'greenway') return 'Bell Alder in Mireglass has renewable marsh herbs that Greenway Outfitters buys.'
  const patches = mireglassHerbPatches(state.seed)
  const cycle = Math.floor(state.tick / HERB_CYCLE_TICKS)
  const available = patches.filter((patch) => !harvested.some((entry) =>
    entry.patchId === patch.id && entry.cycle >= cycle))
  if (!available.length) return 'Bell Alder herbs are regrowing. Explore or trade, then return next cycle.'
  const nearest = [...available].sort((a, b) =>
    Math.hypot(a.tile.center.x - state.player.position.x, a.tile.center.z - state.player.position.z)
      - Math.hypot(b.tile.center.x - state.player.position.x, b.tile.center.z - state.player.position.z))[0]
  const meters = Math.round(Math.hypot(nearest.tile.center.x - state.player.position.x,
    nearest.tile.center.z - state.player.position.z))
  if (meters < 3) return 'Gather the dry Bell Alder marsh herb here, then bring it to Greenway.'
  return `Find a dry Bell Alder herb patch ${bearingText(state.player.position, nearest.tile.center)} of here, about ${meters} m direct, then bring it to Greenway.`
}

export function publicHerbMapGuidance(current: string | undefined, expeditionComplete: boolean,
  herbRouteHint: string | null): string | undefined {
  return expeditionComplete && herbRouteHint ? `Next: ${herbRouteHint}` : current
}

export function publicHerbGuidancePriority(state: PublicWorldState, expeditionComplete: boolean): boolean {
  return expeditionComplete || state.player.inventory.some((stack) =>
    stack.itemId === 'marsh_herb' && stack.quantity > 0)
}

export function publicAreaTitle(state: PublicWorldState): string {
  return state.movementOwner === 'streamed' ? 'Mireglass Reach'
    : areaAt(state.greenway.areas, state.player.position.x, state.player.position.z).name
}

export function publicRegionTransitionText(before: PublicWorldState, after: PublicWorldState): string | null {
  if (before.movementOwner === after.movementOwner) return null
  return after.movementOwner === 'streamed'
    ? 'Entered Mireglass Reach. Follow the dry frontier trail to its marker.'
    : 'Returned to Greenway.'
}

export type PublicV8PlayableSession = {
  start: PublicV8Start
  commit: (state: PublicWorldV7State, expectedRevision: number) => Promise<PublicV8Operation<PublicV8Start>>
}
export type PublicV9PlayableSession = {
  start: PublicV9Start
  commit: (state: PublicWorldV9State, expectedRevision: number, sourceReceipt: PublicV9SourceReceipt) => Promise<PublicV9Operation<PublicV9Start>>
}
export type PublicV10PlayableSession = {
  start: PublicV10Start
  commit: (state: PublicWorldV10State, expectedRevision: number, sourceReceipt: PublicV10SourceReceipt) => Promise<PublicV10Operation<PublicV10Start>>
}
type PublicPlayableSessionProps =
  | { v8Session?: PublicV8PlayableSession; v9Session?: never; v10Session?: never }
  | { v8Session?: never; v9Session: PublicV9PlayableSession; v10Session?: never }
  | { v8Session?: never; v9Session?: never; v10Session: PublicV10PlayableSession }

export function PublicWizardApp({ v8Session, v9Session, v10Session }: PublicPlayableSessionProps) {
  const session = v10Session ?? v9Session ?? v8Session
  const sessionVersion = v10Session ? 'v10' : v9Session ? 'v9' : 'v8'
  const [entry, setEntry] = useState<PublicWorldV7EntryInspection | null>(null)
  const [world, setWorld] = useState<PublicWorldV7State | null>(session?.start.state ?? null)
  const [busy, setBusy] = useState(!session)
  const [blocked, setBlocked] = useState(false)
  const [blockedReason, setBlockedReason] = useState<string | null>(null)
  const [notice, setNotice] = useState(session
    ? `Public ${sessionVersion} save #${session.start.saveRevision} loaded at tick ${session.start.state.tick}. Greenway and Mireglass share one player.`
    : 'Checking this device for a Wizard Realms save…')
  const [confirmFresh, setConfirmFresh] = useState<GenerationProfile | null>(null)
  const [selectedRecovery, setSelectedRecovery] = useState<PublicRecoverySource | null>(null)
  const [confirmStaleStage, setConfirmStaleStage] = useState(false)
  const [confirmRootChoice, setConfirmRootChoice] = useState<PublicV7RootConflictChoice | null>(null)
  const [confirmFreshForkChoice, setConfirmFreshForkChoice] = useState<PublicV7FreshForkChoice | null>(null)
  const [messages, setMessages] = useState<string[]>(['Welcome to Wizard Realms.'])
  const [openStoreId, setOpenStoreId] = useState<string | null>(null)
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)
  const [selectedCampTileId, setSelectedCampTileId] = useState<string | null>(null)
  const selectedCampRef = useRef<string | null>(null)
  const [collapsed, setCollapsed] = useState(true)
  const worldRef = useRef<PublicWorldV7State | null>(session?.start.state ?? null)
  const expectedBytes = useRef<string | null>(null)
  const expectedRevision = useRef(session?.start.saveRevision ?? 0)
  const sourceV7Bytes = useRef(v8Session?.start.sourceV7Bytes ?? null)
  const sourceReceipt = useRef(v9Session?.start.sourceReceipt ?? null)
  const sourceV10Receipt = useRef(v10Session?.start.sourceReceipt ?? null)
  const blockedRef = useRef(false)
  const blockedReasonRef = useRef<string | null>(null)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const input = useRef(createTimedMovementSampler(performance.now()))
  const clock = useRef(createFixedInputClock(input.current.cursorMs))
  const pending = useRef<PublicWorldIntent[][]>([])
  const openStoreRef = useRef<string | null>(null)
  const travelDirty = useRef(false)
  const travelVersion = useRef(0)
  const lastQueuedTravelVersion = useRef(-1)
  const lastSaveMs = useRef(performance.now())
  const lastReadoutMs = useRef(performance.now())

  const report = useCallback((text: string) => setMessages((current) => appendMessages(current, [text])), [])
  const stop = useCallback((reason: string) => {
    blockedRef.current = true; blockedReasonRef.current = reason
    setBlocked(true); setBlockedReason(reason); setNotice(errorText(reason))
  }, [])
  const save = useCallback((snapshot: PublicWorldV7State) => {
    if (blockedRef.current) return
    const savedTravelVersion = travelVersion.current
    lastQueuedTravelVersion.current = savedTravelVersion
    lastSaveMs.current = performance.now()
    saveQueue.current = saveQueue.current.then(async () => {
      if (blockedRef.current) return
      if (v10Session || v9Session || v8Session) {
        const result = v10Session
          ? await v10Session.commit(requirePublicV10State(snapshot), expectedRevision.current, sourceV10Receipt.current!)
          : v9Session
          ? await v9Session.commit(requirePublicV9State(snapshot), expectedRevision.current, sourceReceipt.current!)
          : await v8Session!.commit(snapshot, expectedRevision.current)
        if (!result.ok) { setWorld(worldRef.current); stop(result.reason); return }
        expectedRevision.current = result.value.saveRevision
        lastSaveMs.current = performance.now()
        if (travelVersion.current === savedTravelVersion) travelDirty.current = false
        setNotice(`Public ${sessionVersion} save #${result.value.saveRevision} completed at tick ${result.value.state.tick} on this device. Older sources remain untouched.`)
        return
      }
      const currentStorage = storage()
      if (!currentStorage) { stop('storage-error'); return }
      const result = await commitPublicV7Snapshot(currentStorage, locks(), snapshot, expectedBytes.current)
      if (!result.ok) { stop(result.reason); return }
      expectedBytes.current = result.value.bytes
      lastSaveMs.current = performance.now()
      if (travelVersion.current === savedTravelVersion) travelDirty.current = false
      const saved = parsePublicV7PlayableRoot(result.value.bytes)
      setNotice(`Public v7 save #${saved?.saveRevision ?? '?'} completed on this device. Older saves remain untouched.`)
    }).catch(() => { if (v10Session || v9Session || v8Session) setWorld(worldRef.current); stop('storage-error') })
  }, [stop, v8Session, v9Session, v10Session, sessionVersion])
  const activate = (start: PublicV7Start) => {
    expectedBytes.current = start.bytes; worldRef.current = start.state
    travelDirty.current = false; travelVersion.current = 0; lastQueuedTravelVersion.current = -1
    setWorld(start.state); setBusy(false); setBlocked(false); setBlockedReason(null)
    blockedRef.current = false; blockedReasonRef.current = null
    setNotice('Public v7 progress is saved. Greenway and Mireglass share one player.')
    lastSaveMs.current = performance.now()
  }
  useEffect(() => {
    if (v8Session || v9Session || v10Session) return
    let cancelled = false
    const currentStorage = storage()
    if (!currentStorage) { stop('storage-error'); setBusy(false); return }
    void inspectPublicV7Entry(currentStorage, locks()).then((result) => {
      if (cancelled) return
      if (!result.ok) { stop(result.reason); setBusy(false); return }
      setEntry(result.value); setBusy(false)
      const { root } = result.value
      const reason = result.value.blockedReason
      if (reason) { stop(reason); return }
      setNotice(root.status === 'missing'
        ? result.value.v6.status === 'valid-playable' || result.value.v6.status === 'valid-bootstrap'
          ? 'A v6 world is available. Choose Upgrade to keep its progress and add the renewable frontier.'
          : 'Choose a new Greenway world or explicitly import a legacy save.'
        : 'A public v7 world is available. Resume it explicitly to play.')
    }).catch(() => { if (!cancelled) { stop('storage-error'); setBusy(false) } })
    return () => { cancelled = true }
  }, [stop, v8Session, v9Session, v10Session])

  const choose = async (operation: Promise<PublicV7Operation<PublicV7Start>>) => {
    setBusy(true)
    const result = await operation
    if (result.ok) activate(result.value)
    else {
      const currentStorage = storage()
      const reread = currentStorage ? await inspectPublicV7Entry(currentStorage, locks()) : null
      setBusy(false)
      if (reread?.ok) {
        setEntry(reread.value)
        const reason = reread.value.blockedReason
        blockedRef.current = reason !== null; blockedReasonRef.current = reason
        setBlocked(reason !== null); setBlockedReason(reason)
        setNotice(`${errorText(result.reason)}${reason ? ` Current save status: ${reason}.` : ''}`)
      } else stop(reread && !reread.ok ? reread.reason : 'storage-error')
    }
  }
  const chooseFresh = (profile: GenerationProfile) => {
    if (!entry) return
    const currentStorage = storage()
    if (!currentStorage) { stop('storage-error'); return }
    const legacyPresent = entry.classic.status !== 'missing' || entry.expanded.status !== 'missing'
    if (legacyPresent && confirmFresh !== profile) { setConfirmFresh(profile); return }
    void choose(startFreshPublicV7(currentStorage, locks(), profile, legacyPresent))
  }
  const recover = async (source: PublicRecoverySource) => {
    const currentStorage = storage()
    const v7Recovery = entry?.v6.status === 'skipped'
    const snapshot = v7Recovery
      ? entry?.recovery.status === 'available' ? entry.recovery.snapshot : null
      : entry?.v6Recovery.status === 'available' ? entry.v6Recovery.snapshot : null
    if (!currentStorage || !snapshot) { stop('storage-error'); return }
    setBusy(true)
    const result = v7Recovery
      ? await recoverPublicV7Snapshot(currentStorage, locks(), source, snapshot as PublicV7RecoverySnapshot)
      : await recoverPublicWorld(currentStorage, locks(), source, snapshot as PublicV6RecoverySnapshot)
    if (!result.ok) {
      setBusy(false); setSelectedRecovery(null)
      setNotice(result.reason === 'snapshot-changed'
        ? 'Recovery choice is stale because the saved bytes changed. Nothing was overwritten. Reload to inspect the current candidates.'
        : result.reason === 'source-changed'
          ? 'The v6 source no longer matches this recovery choice. Nothing was overwritten. Reload to inspect the current candidates.'
        : `Recovery did not finish (${result.reason}). The previous bytes may have been archived, and recovery may have staged changes. Reload to inspect the current candidates before choosing again.`)
      return
    }
    const reread = await inspectPublicV7Entry(currentStorage, locks())
    setBusy(false); setSelectedRecovery(null)
    if (!reread.ok) { stop(reread.reason); return }
    setEntry(reread.value)
    const reason = reread.value.blockedReason
    if (reason) {
      stop(reason)
      setNotice(`Recovery archived prior bytes at ${result.value.archiveKey}, but ${reason} still needs a verified choice.`)
      return
    }
    setBlocked(false); setBlockedReason(null)
    blockedRef.current = false; blockedReasonRef.current = null
    setNotice(`Recovery archived the previous bytes at ${result.value.archiveKey}. Choose Resume to continue.`)
  }
  const clearStaleStage = async () => {
    const currentStorage = storage()
    const candidate = entry?.stageConflict
    if (!currentStorage || candidate?.status !== 'eligible') { stop('storage-error'); return }
    setBusy(true)
    const result = await clearArchivedStaleV7Stage(currentStorage, locks(), candidate.snapshot)
    const reread = await inspectPublicV7Entry(currentStorage, locks())
    setBusy(false); setConfirmStaleStage(false)
    if (!reread.ok) { stop(reread.reason); return }
    setEntry(reread.value)
    const reason = reread.value.blockedReason
    blockedRef.current = reason !== null; blockedReasonRef.current = reason
    setBlocked(reason !== null); setBlockedReason(reason)
    setNotice(result.ok
      ? `Current v6 progress is intact. Stale v7 stage and backup bytes were archived at ${result.value.archiveKey}. Choose Upgrade to continue.`
      : `Conflict repair did not finish (${result.reason}). No save bytes were discarded without a verified archive. ${reason ? `Current status: ${reason}.` : 'Choose a validated path below.'}`)
  }
  const resolveRootConflict = async (choice: PublicV7RootConflictChoice) => {
    const currentStorage = storage()
    const candidate = entry?.rootConflict
    if (!currentStorage || candidate?.status !== 'eligible' || !candidate.choices.includes(choice)) {
      stop('storage-error'); return
    }
    setBusy(true)
    const result = await reconcilePublicV7RootConflict(currentStorage, locks(), choice, candidate.snapshot)
    const reread = await inspectPublicV7Entry(currentStorage, locks())
    setBusy(false); setConfirmRootChoice(null)
    if (!reread.ok) { stop(reread.reason); return }
    setEntry(reread.value)
    const reason = reread.value.blockedReason
    blockedRef.current = reason !== null; blockedReasonRef.current = reason
    setBlocked(reason !== null); setBlockedReason(reason)
    setNotice(result.ok
      ? `Both save branches were archived at ${result.value.archiveKey}. ${choice === 'continue-v7'
        ? 'The current v7 journey remains active.' : choice === 'use-v7-stage'
          ? 'The pending newer v7 save is active.' : 'The newer v6 journey was upgraded to v7.'} Choose Resume to play. Close older v6 tabs before continuing.`
      : `Save choice did not finish (${result.reason}). No branch was discarded without a verified archive. ${reason ? `Current status: ${reason}.` : 'Choose a validated path below.'}`)
  }
  const resolveFreshFork = async (choice: PublicV7FreshForkChoice) => {
    const currentStorage = storage()
    const candidate = entry?.freshFork
    if (!currentStorage || candidate?.status !== 'eligible' || !candidate.choices.includes(choice)) {
      stop('storage-error'); return
    }
    setBusy(true)
    const result = await reconcilePublicV7FreshFork(currentStorage, locks(), choice, candidate.snapshot)
    const reread = await inspectPublicV7Entry(currentStorage, locks())
    setBusy(false); setConfirmFreshForkChoice(null)
    if (!reread.ok) { stop(reread.reason); return }
    setEntry(reread.value)
    const reason = reread.value.blockedReason
    blockedRef.current = reason !== null; blockedReasonRef.current = reason
    setBlocked(reason !== null); setBlockedReason(reason)
    setNotice(result.ok
      ? `Both independent saves were archived at ${result.value.archiveKey}. ${publicFreshForkChoiceCopy(choice).result} Choose Resume to play. Close older v6 tabs; they can recreate this conflict.`
      : `Save choice did not finish (${result.reason}). No branch was discarded without a verified archive. ${reason ? `Current status: ${reason}.` : 'Choose a validated path below.'}`)
  }
  const retrySave = async () => {
    if (!transientSaveFailure(blockedReasonRef.current) || !worldRef.current) return
    setBusy(true)
    await saveQueue.current
    blockedRef.current = false; blockedReasonRef.current = null
    setBlocked(false); setBlockedReason(null)
    setNotice(`Retrying the unchanged ${v10Session ? 'v10 revision' : v9Session ? 'v9 revision' : v8Session ? 'v8 revision' : 'v7 save root'}…`)
    save(worldRef.current)
    await saveQueue.current
    setBusy(false)
  }
  const exportUnsaved = () => {
    const current = worldRef.current
    const bytes = current && (v10Session
      ? unsavedPublicV10Bytes(requirePublicV10State(current), sourceV10Receipt.current!, expectedRevision.current)
      : v9Session
      ? unsavedPublicV9Bytes(requirePublicV9State(current), sourceReceipt.current!, expectedRevision.current)
      : unsavedPublicV7Bytes(current, v8Session ? sourceV7Bytes.current : expectedBytes.current))
    if (!bytes) { setNotice('Unsaved progress could not be validated for export. Keep this tab open and do not clear site data.'); return }
    let url: string | null = null
    let link: HTMLAnchorElement | null = null
    try {
      url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' }))
      link = document.createElement('a')
      const version = v10Session ? 'v10' : v9Session ? 'v9' : 'v7'
      link.href = url; link.download = `wizard-realms-unsaved-${version}-${Date.now()}.json`
      document.body.append(link); link.click()
      setNotice(v10Session
        ? 'V10 terrain, camp state, and source receipt downloaded for recovery. This preview cannot import this file. Keep the file and this site data; the download has not replaced your save.'
        : v9Session
        ? 'V9 camp state and source receipt downloaded for recovery. This preview cannot import this file. Keep the file and this site data; the download has not replaced your save.'
        : `Unsaved progress downloaded as a valid ${version} snapshot. Keep the file before reloading; it has not replaced the current save.`)
    } catch { setNotice('Download failed. Keep this tab open and do not clear site data.') }
    finally {
      link?.remove()
      const cleanupUrl = url
      if (cleanupUrl) window.setTimeout(() => URL.revokeObjectURL(cleanupUrl), 60_000)
    }
  }

  useEffect(() => {
    if (!world) return
    const resetInput = () => {
      const now = performance.now()
      input.current = createTimedMovementSampler(now); clock.current = createFixedInputClock(now); pending.current = []
    }
    resetInput()
    const apply = (now: number, forceSave: boolean) => {
      if (blockedRef.current || !worldRef.current) return
      const samples = sampleFixedInputBatch(input.current, clock.current, now, STEP_MS, MAX_CATCH_UP_STEPS)
      const frames = pending.current.splice(0)
      if (!samples.length && !frames.length) {
        if (forceSave && publicTravelFlushNeeded(travelDirty.current, travelVersion.current,
          lastQueuedTravelVersion.current)) save(worldRef.current)
        return
      }
      try {
        const previous = worldRef.current
        const result = advancePublicControls(previous, frames, samples,
          v10Session ? sourceV10Receipt.current!.sourceV9Head.bootstrap : null)
        const next = v10Session ? requirePublicV10State(result.state, previous)
          : v9Session ? requirePublicV9State(result.state, previous) : requirePublicV7State(result.state)
        worldRef.current = next
        if (result.events.length || result.rejections.length || now - lastReadoutMs.current >= 1_000) {
          setWorld(next); lastReadoutMs.current = now
        }
        const nextStore = result.state.movementOwner === 'greenway'
          ? retainOpenStoreId(greenwayForPublicView(result.state), openStoreRef.current) : null
        openStoreRef.current = nextStore; setOpenStoreId(nextStore)
        const transition = publicRegionTransitionText(previous, next)
        if (transition) { selectedCampRef.current = null; setSelectedCampTileId(null); setSelectedSiteId(null) }
        const texts = [...publicFrameMessages(result), ...(transition ? [transition] : [])]
        if (texts.length) setMessages((current) => appendMessages(current, texts,
          result.rejections.length > 0 && result.events.length === 0 && !transition))
        // Idle world events can change durable state too, notably a trade listing settling.
        if (result.events.length) travelDirty.current = true
        travelVersion.current = publicSaveableVersion(travelVersion.current, result.events)
        if ((frames.length && result.events.length) || (publicTravelFlushNeeded(
          travelDirty.current, travelVersion.current, lastQueuedTravelVersion.current)
          && (forceSave || now - lastSaveMs.current >= TRAVEL_SAVE_MS))) save(next)
      } catch { stop('world-frame-error') }
    }
    const flush = () => { apply(performance.now(), true); resetInput() }
    const onVisibility = () => { if (document.hidden) flush() }
    const timer = window.setInterval(() => {
      if (!document.hidden) apply(performance.now(), false)
    }, STEP_MS)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', flush)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('blur', flush) }
  }, [world !== null, save, stop, v9Session, v10Session])

  const actMireglass = useCallback((action: PublicMireglassAction) => {
    const current = worldRef.current
    if (!current || current.movementOwner !== 'streamed' || blockedRef.current) return
    const result = v10Session
      ? actPublicV10Mireglass(requirePublicV10State(current), action, sourceV10Receipt.current!.sourceV9Head.bootstrap)
      : actPublicMireglass(current, action)
    if (result.rejection) { report(result.rejection.message); return }
    const next = v10Session ? requirePublicV10State(result.state, current)
      : v9Session ? requirePublicV9State(result.state, current) : requirePublicV7State(result.state)
    worldRef.current = next; setWorld(next)
    report(result.event.type === 'herb_foraged'
      ? 'Gathered a marsh herb. It will regrow after the next game-time cycle.'
      : mireglassEventText(result.event)); save(next)
  }, [report, save, v9Session, v10Session])
  const onIntent = useCallback((intent: WizardViewIntent) => {
    const current = worldRef.current
    if (!current || blockedRef.current) return
    if (intent.type === 'field-camp.select' || intent.type === 'field-camp.confirm') {
      if (!v9Session && !v10Session) return
      if (intent.type === 'field-camp.select' && intent.tileId === null) {
        selectedCampRef.current = null; setSelectedCampTileId(null); return
      }
      const campWorld = v10Session ? requirePublicV10State(current) : requirePublicV9State(current)
      if (campWorld.movementOwner !== 'streamed' || campWorld.fieldCampTileIds.length) return
      if (intent.type === 'field-camp.select') {
        selectedCampRef.current = intent.tileId; setSelectedCampTileId(intent.tileId); setSelectedSiteId(null); setWorld(current)
      } else if (selectedCampRef.current === intent.tileId) {
        const result = v10Session
          ? applyFieldCampV10Action(requirePublicV10State(campWorld), intent.tileId,
            sourceV10Receipt.current!.sourceV9Head.bootstrap)
          : applyFieldCampAction(campWorld, intent.tileId, sourceReceipt.current!.sourceV8Head.bootstrap)
        if (result.rejection) { setWorld(current); report(result.rejection.message); return }
        worldRef.current = result.state; setWorld(result.state)
        selectedCampRef.current = null; setSelectedCampTileId(null)
        report('Field camp built. Spent 4 logs and 1 stone; gained 30 construction XP.'); save(result.state)
      }
      return
    }
    if (intent.type === 'movement') { recordTimedMovement(input.current, intent.atMs ?? performance.now(), intent.vector); return }
    if (intent.type === 'movement.tap') {
      if (intent.source !== 'keyboard') pending.current.push(streamedControlIntents(current.player.yaw, intent.vector))
      return
    }
    if (intent.type === 'jump') { pending.current.push([{ type: 'jump' }]); return }
    if (intent.type === 'fairy-ring.teleport') {
      pending.current.push([{ type: 'teleport_fairy_ring', sourceRingId: intent.ringId,
        targetRingId: intent.destinationRingId }])
      return
    }
    if (intent.type === 'build-site.select') {
      selectedCampRef.current = null; setSelectedCampTileId(null)
      if (current.movementOwner !== 'greenway' || intent.siteId === null) setSelectedSiteId(intent.siteId)
      else {
        const site = routeBuildOptions(greenwayForPublicView(current)).find((candidate) => candidate.id === intent.siteId)
        if (site && !current.greenway.builtRouteIds.includes(site.routeId)) setSelectedSiteId(intent.siteId)
      }
      return
    }
    if (current.movementOwner === 'greenway') {
      if (intent.type === 'store.close') { openStoreRef.current = null; setOpenStoreId(null); return }
      if (intent.type === 'store.open') {
        const reachable = retainOpenStoreId(greenwayForPublicView(current), intent.storeId)
        openStoreRef.current = reachable; setOpenStoreId(reachable)
        if (!reachable) report('Move closer to the store before opening it.')
        return
      }
      if (intent.type === 'interact' && !retainOpenStoreId(greenwayForPublicView(current), openStoreRef.current)) {
        const nearby = publicWorldViewProjection(current, [], selectedSiteId, null).nearbyInteraction
        if (nearby?.kind === 'store') {
          openStoreRef.current = nearby.targetId; setOpenStoreId(nearby.targetId)
          return
        }
      }
      const action = intentForView(greenwayForPublicView(current), intent, openStoreRef.current)
      if (action) pending.current.push([action]); else report('No eligible Greenway action here.')
      return
    }
    const region = mireglassForPublicView(current)
    if (intent.type === 'interact') {
      const choice = mireglassNearestInteractChoice(region) ?? publicHerbChoices(current)[0]
      if (choice) actMireglass(choice.action); else report('No nearby frontier interaction.')
    } else if (intent.type === 'build-site.confirm') actMireglass({ type: 'build_route', siteId: intent.siteId })
    else if (intent.type === 'spell.cast' && intent.spellId === 'wayfinder_glow') actMireglass({ type: 'cast_wayfinder_glow' })
    else if (intent.type === 'equipment.equip') {
      const itemId = intent.stackId.replace(/^inventory-/, '')
      if (itemId === 'woodcutters_axe' || itemId === 'field_spade' || itemId === 'mireglass_reach/item/waders')
        actMireglass({ type: 'equip_item', itemId })
      else report('That frontier equipment is unavailable here.')
    }
    else if (intent.type === 'store.select-listing' && (intent.listingId === 'field_spade' || intent.listingId === 'mireglass_reach/item/waders'))
      actMireglass({ type: 'buy_item', itemId: intent.listingId })
    else if (intent.type === 'store.sell-item' && (intent.itemId === 'logs' || intent.itemId === 'mireglass_reach/item/seal'))
      actMireglass({ type: 'sell_item', itemId: intent.itemId, quantity: intent.quantity })
    else report('That frontier action is unavailable here.')
  }, [actMireglass, report, save, selectedSiteId, v9Session, v10Session])

  const projection = useMemo(() => world ? publicWorldViewProjection(world, messages, selectedSiteId, openStoreId,
    v10Session ? publicFieldCampView(requirePublicV10State(world), selectedCampTileId,
      sourceV10Receipt.current!, blocked)
      : v9Session ? publicFieldCampView(requirePublicV9State(world), selectedCampTileId,
        sourceReceipt.current!, blocked) : undefined,
    v10Session ? { cachePitDug: world.mireglass.cacheExcavated } : undefined) : null,
    [world, messages, selectedSiteId, openStoreId, selectedCampTileId, v9Session, v10Session, blocked])
  const region = world?.movementOwner === 'streamed' ? mireglassForPublicView(world) : null
  const choices = region && world ? [...mireglassActionChoices(region), ...publicHerbChoices(world)] : []
  const objective = region ? mireglassNextObjective(region) : null
  const herbRouteHint = world ? publicHerbRouteHint(world) : null
  if (!world || !projection) {
    const root = entry?.root
    const legacyPresent = entry && (entry.classic.status !== 'missing' || entry.expanded.status !== 'missing')
    const v7Recovery = entry?.v6.status === 'skipped'
    const stageConflict = entry?.stageConflict.status === 'eligible'
    const rootConflict = entry?.rootConflict.status === 'eligible' ? entry.rootConflict : null
    const freshFork = entry?.freshFork.status === 'eligible' ? entry.freshFork : null
    const recoveryStorage = v7Recovery ? storage() : null
    const recoveryChoices = blockedReason === 'source-changed' || stageConflict ? [] : v7Recovery
      ? entry?.recovery.status === 'available' && recoveryStorage
        ? publicV7RecoveryChoices(entry.recovery.snapshot, recoveryStorage) : []
      : entry?.v6Recovery.status === 'available' ? publicRecoveryChoices(entry.v6Recovery.snapshot) : []
    const pendingStageGuidance = blockedReason === 'pending-v7-stage'
      ? publicPendingV7StageGuidance(!!freshFork, stageConflict || recoveryChoices.length > 0) : null
    const saveVersion = v7Recovery ? 'v7' : 'v6'
    const v6Upgrade = entry?.v6.status === 'valid-playable' || entry?.v6.status === 'valid-bootstrap'
      ? entry.v6 : null
    return <main className="wr-public-menu"><style>{STYLES}</style><section className="wr-public-card">
      <h1>Wizard Realms</h1><p>One public world connects Greenway and Mireglass Reach. Choose how to begin.</p>
      <p role="status" className={blocked ? 'wr-public-warning' : ''}>{notice}</p>
      {entry?.artifacts.status === 'available' && entry.artifacts.backup.status === 'available' &&
        <p>Verified v7 backup bytes exist. They will not be restored automatically.</p>}
      {entry?.v6Artifacts.status === 'available' && entry.v6Artifacts.backup.status === 'available' &&
        <p>Verified v6 backup bytes exist. They will not be restored automatically.</p>}
      {root?.status === 'valid-playable' && !blocked && <button disabled={busy} onClick={() => { const currentStorage = storage();
        if (currentStorage) void choose(resumePublicV7(currentStorage, locks(), root.bytes)); else stop('storage-error') }}>Resume existing v7 world</button>}
      {root?.status === 'missing' && !blocked && v6Upgrade &&
        <button disabled={busy} onClick={() => { const currentStorage = storage();
          if (currentStorage) void choose(upgradePublicV6(currentStorage, locks(), v6Upgrade.bytes)); else stop('storage-error') }}>
          Upgrade and resume existing v6 world; preserve its original save
        </button>}
      {root?.status === 'missing' && entry?.v6.status === 'missing' && !blocked && <>
        {([entry?.classic, entry?.expanded] as const).map((source) => source?.status === 'available'
          ? <button key={source.source.profile} disabled={busy} onClick={() => { const currentStorage = storage();
            if (currentStorage) void choose(importLegacyToPublicV7(currentStorage, locks(), source)); else stop('storage-error') }}>Import {source.source.profile === 'greenway-classic-v1' ? 'classic' : 'expanded'} Greenway from {source.source.key}</button> : null)}
        {([['greenway-classic-v1', 'classic'], ['greenway-expanded-v1', 'expanded']] as const).map(([profile, label]) =>
          <button key={profile} disabled={busy} onClick={() => chooseFresh(profile)}>{confirmFresh === profile
            ? `Confirm new ${label} world; preserve legacy bytes` : `Start new ${label} Greenway world`}</button>)}
        {legacyPresent && <p className="wr-public-warning">A legacy save exists. Starting new requires a second explicit tap. Legacy bytes are never deleted or rewritten.</p>}
        {entry && (entry.classic.status === 'invalid' || entry.classic.status === 'incompatible' || entry.expanded.status === 'invalid' || entry.expanded.status === 'incompatible')
          ? <p>Some legacy saves cannot be imported. Their original bytes remain untouched.</p> : null}
      </>}
      {blocked && <><p className="wr-public-warning">{pendingStageGuidance
        ?? `No save bytes were deleted or recovered automatically. Recovery archives all current ${saveVersion} bytes before publishing your chosen valid source.`}</p>
        {blockedReason === 'source-changed' && <p>The older v6 save changed after v7 began. Close older v6 tabs. Both save branches remain intact until you make an explicit choice.</p>}
        {rootConflict?.choices.map((choice) => <div key={choice}>
          <button disabled={busy} onClick={() => setConfirmRootChoice(choice)}>{choice === 'continue-v7'
            ? 'Keep my current v7 journey and archive both branches' : choice === 'use-v7-stage'
              ? 'Keep the pending newer v7 save and archive both branches'
              : 'Use the newer v6 journey and archive both branches'}</button>
          {confirmRootChoice === choice && <button disabled={busy} onClick={() => void resolveRootConflict(choice)}>
            Confirm {choice === 'continue-v7' ? 'current v7' : choice === 'use-v7-stage'
              ? 'pending newer v7 save' : 'newer v6'} choice and preserve the other branch in an archive
          </button>}
        </div>)}
        {freshFork?.choices.map((choice) => <div key={choice}>
          <button disabled={busy} onClick={() => setConfirmFreshForkChoice(choice)}>
            {publicFreshForkChoiceCopy(choice).label}
          </button>
          {confirmFreshForkChoice === choice && <button disabled={busy} onClick={() => void resolveFreshFork(choice)}>
            {publicFreshForkChoiceCopy(choice).confirmation}
          </button>}
        </div>)}
        {blockedReason === 'source-changed' && !rootConflict && !freshFork &&
          <p>No safe automatic choice is available for these save histories. Keep this site data and both tabs; neither branch has been overwritten.</p>}
        {stageConflict && <><button disabled={busy} onClick={() => setConfirmStaleStage(true)}>Keep the current v6 save; archive stale v7 stage and backup</button>
          {confirmStaleStage && <button disabled={busy} onClick={() => void clearStaleStage()}>Confirm archive, then return to the v6 Upgrade choice</button>}</>}
        {recoveryChoices.map((choice) => <div key={choice.source}>
          <button disabled={busy} onClick={() => setSelectedRecovery(choice.source)}>{choice.label}<small style={{ display: 'block' }}>{choice.detail}</small></button>
          {selectedRecovery === choice.source && <button disabled={busy} onClick={() => void recover(choice.source)}>Confirm {choice.label.toLowerCase()} and archive all current {saveVersion} bytes</button>}
        </div>)}
        <button onClick={() => window.location.reload()}>Reload to recheck storage</button></>}
    </section></main>
  }
  const herbPriority = publicHerbGuidancePriority(world, !!objective?.complete)
  const nextGuidance = herbPriority && herbRouteHint
    ? herbRouteHint : objective?.label ?? objectiveFor(greenwayForPublicView(world))
  const playProjection = herbPriority && herbRouteHint
    ? { ...projection, map: { ...projection.map,
      guidance: publicHerbMapGuidance(projection.map.guidance, true, herbRouteHint) } }
    : projection
  return <main className="wr-public" data-owner={world.movementOwner}><style>{STYLES}</style>
    <WizardSurface projection={playProjection} onIntent={onIntent} />
    <p className="wr-public-next" hidden={!collapsed} tabIndex={collapsed ? 0 : -1}><strong>Next:</strong> {nextGuidance}
      {playProjection.fieldCamp?.guidance && <small><b>Camp:</b> {playProjection.fieldCamp.guidance}</small>}
      {world.tick < 1_000 && <small>W/S move · A/D turn · E interact · M map</small>}</p>
    <aside className="wr-public-panel" data-collapsed={collapsed} aria-label="Public world controls">
      <button onClick={() => setCollapsed((value) => !value)}>{collapsed ? 'World / Save' : 'Collapse controls'}</button>
      <div className="wr-public-body"><h1>{publicAreaTitle(world)}</h1>
        <p role="status" className={blocked ? 'wr-public-warning' : ''}>{notice}</p>
        <p><small>x {world.player.position.x.toFixed(1)}, z {world.player.position.z.toFixed(1)} · {world.player.coins} coins · tick {world.tick}</small></p>
        <p>{messages.at(-1)}</p>
        <p><b>Next:</b> {nextGuidance}</p>
        {playProjection.fieldCamp?.guidance && <p><b>Camp:</b> {playProjection.fieldCamp.guidance}</p>}
        {herbRouteHint && !herbPriority && <p><b>Bell Alder route:</b> {herbRouteHint}</p>}
        {!region && world.player.learnedSpellIds.includes('wayfinder_glow') &&
          <p><b>Frontier trail:</b> Travel due west to the dry opening at z = 0 to enter Mireglass Reach. Greenway training remains available.</p>}
        {region && <div className="wr-public-actions">{choices.map((choice) => <button key={choice.id} disabled={blocked}
          onClick={() => actMireglass(choice.action)}>{choice.label}<small>{choice.detail}</small></button>)}</div>}
        <button disabled={blocked} onClick={() => { if (worldRef.current) save(worldRef.current) }}>Save now</button>
        {blocked && transientSaveFailure(blockedReason) && <button disabled={busy} onClick={() => void retrySave()}>Retry Save</button>}
        {blocked && <><p className="wr-public-warning">Reload discards progress made since the last successful save. Download a snapshot first.</p>
          <button disabled={busy} onClick={exportUnsaved}>Download unsaved progress</button>
          <button onClick={() => window.location.reload()}>Reload latest saved world</button></>}
      </div>
    </aside>
  </main>
}

export default PublicWizardApp
