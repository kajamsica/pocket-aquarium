import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { intentForView, objectiveFor, retainOpenStoreId } from './App'
import { mireglassActionChoices, mireglassNearestInteractChoice, mireglassNextObjective } from './MireglassPlayableApp'
import { publicWorldViewProjection } from './PublicWorldView'
import { streamedControlIntents } from './StreamedPreviewApp'
import { MIREGLASS_CONTENT_REVISION } from './domain/mireglassContent'
import type { MireglassExpeditionAction } from './domain/mireglassExpedition'
import type { MireglassWorldState } from './domain/mireglassWorld'
import { routeBuildOptions } from './domain/routeSites'
import { actPublicMireglass } from './domain/publicWorldActions'
import { advancePublicWorldFrame, type PublicWorldAdvanceResult, type PublicWorldIntent } from './domain/publicWorldRuntime'
import { createFreshPublicWorld, createPublicWorldFromBootstrap, type PublicWorldState } from './domain/publicWorldState'
import {
  PUBLIC_V6_ROOT_KEY, commitLegacyImportToPublicV6, commitPublicV6World, inspectLegacyImportSource,
  inspectPublicV6Artifacts, loadPublicV6Root,
  type LegacyImportInspection, type PublicV6ArtifactInspection, type PublicV6RootLoad,
} from './domain/publicWorldV6'
import type { GenerationProfile, PlayerState, WizardWorldState } from './domain/types'
import { WizardSurface, type WizardViewIntent } from './view'
import { createFixedInputClock, createTimedMovementSampler, recordTimedMovement, sampleFixedInputBatch } from './view/timedInput'

const SEED = 'greenway-alpha'
const STEP_MS = 50
const MAX_CATCH_UP_STEPS = 12
const TRAVEL_SAVE_MS = 5_000
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
}
export function inspectPublicEntry(storage: Pick<Storage, 'getItem'>,
  locks: PublicLockProvider | undefined): Promise<PublicOperation<PublicEntryInspection>> {
  return withPublicLock(locks, () => {
    const root = loadPublicV6Root(storage)
    return succeeded({ root,
      classic: root.status === 'missing' ? inspectLegacyImportSource(storage, 'greenway-classic-v1') : { status: 'missing' },
      expanded: root.status === 'missing' ? inspectLegacyImportSource(storage, 'greenway-expanded-v1') : { status: 'missing' },
      artifacts: inspectPublicV6Artifacts(storage) })
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
  samples: readonly (readonly [number, number])[]): PublicWorldAdvanceResult {
  let next = state
  const events: PublicWorldAdvanceResult['events'] = []
  const rejections: PublicWorldAdvanceResult['rejections'] = []
  for (const frame of queued) {
    const result = advancePublicWorldFrame(next, frame)
    next = result.state; events.push(...result.events); rejections.push(...result.rejections)
  }
  for (const sample of samples) {
    const result = advancePublicWorldFrame(next, streamedControlIntents(next.player.yaw, sample))
    next = result.state; events.push(...result.events); rejections.push(...result.rejections)
  }
  return { state: next, events, rejections }
}

const STYLES = `
.wr-public,.wr-public-menu{position:fixed;inset:0;background:#14221f;color:#f5f1df;font:14px/1.4 system-ui}.wr-public .wr-surface{min-height:0}
.wr-public-menu{display:grid;place-items:center;padding:20px;box-sizing:border-box}.wr-public-card{box-sizing:border-box;width:min(560px,100%);max-height:90vh;overflow:auto;padding:24px;border:1px solid #c9ad6680;border-radius:18px;background:#101a17f4;box-shadow:0 20px 60px #0008}.wr-public-card h1{margin:0 0 8px;color:#f5d889;font:700 30px Georgia,serif}.wr-public-card p{color:#c5d0c3}.wr-public-card button,.wr-public-panel button{min-height:44px;padding:7px 12px;border:1px solid #d5b86f77;border-radius:8px;background:#324b3d;color:#fff0c7;font:inherit;cursor:pointer}.wr-public-card button{display:block;width:100%;margin:8px 0;text-align:left}.wr-public-card button:disabled,.wr-public-panel button:disabled{opacity:.5;cursor:not-allowed}.wr-public-warning{padding:9px;border:1px solid #e3a27788;border-radius:8px;background:#4b2824e8;color:#ffe0d4!important}
.wr-public-panel{position:absolute;z-index:8;right:12px;top:12px;box-sizing:border-box;width:min(315px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;padding:12px;border:1px solid #c9ad6680;border-radius:12px;background:#101a17ed;box-shadow:0 10px 32px #0008}.wr-public-panel h1{margin:0;color:#f5d889;font:700 19px Georgia,serif}.wr-public-panel p{margin:6px 0}.wr-public-panel small{color:#b8c9bb}.wr-public-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}.wr-public-actions button{text-align:left}.wr-public-actions small{display:block}.wr-public-panel[data-collapsed=true]{width:auto}.wr-public-panel[data-collapsed=true] .wr-public-body{display:none}.wr-public[data-owner=streamed] .wr-gear,.wr-public[data-owner=streamed] .wr-trade{display:none}
@media(max-width:719px){.wr-public-panel{top:auto;bottom:calc(144px + env(safe-area-inset-bottom,0px));max-height:42vh}.wr-public-panel[data-collapsed=true]{bottom:calc(144px + env(safe-area-inset-bottom,0px))}}
`

const locks = () => typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: PublicLockProvider }).locks : undefined
const storage = () => { try { return window.localStorage } catch { return null } }
const transientSaveFailure = (reason: string | null) => reason === 'storage-error' || reason === 'lock-unavailable'
const errorText = (reason: string) => `Save blocked (${reason}). Existing bytes were preserved. ${transientSaveFailure(reason)
  ? 'Retry Save to keep your in-memory progress.' : 'Do not clear site data. Recovery requires a verified save operation.'}`
const eventText = (type: string) => type.replaceAll('_', ' ')
const appendMessages = (current: readonly string[], additions: readonly string[]) => [...current, ...additions].slice(-4)

export function PublicWizardApp() {
  const [entry, setEntry] = useState<PublicEntryInspection | null>(null)
  const [world, setWorld] = useState<PublicWorldState | null>(null)
  const [busy, setBusy] = useState(true)
  const [blocked, setBlocked] = useState(false)
  const [blockedReason, setBlockedReason] = useState<string | null>(null)
  const [notice, setNotice] = useState('Checking this device for a public v6 save…')
  const [confirmFresh, setConfirmFresh] = useState<GenerationProfile | null>(null)
  const [messages, setMessages] = useState<string[]>(['Welcome to Wizard Realms.'])
  const [openStoreId, setOpenStoreId] = useState<string | null>(null)
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(true)
  const worldRef = useRef<PublicWorldState | null>(null)
  const expectedBytes = useRef<string | null>(null)
  const blockedRef = useRef(false)
  const blockedReasonRef = useRef<string | null>(null)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const input = useRef(createTimedMovementSampler(performance.now()))
  const clock = useRef(createFixedInputClock(input.current.cursorMs))
  const pending = useRef<PublicWorldIntent[][]>([])
  const openStoreRef = useRef<string | null>(null)
  const travelDirty = useRef(false)
  const lastSaveMs = useRef(performance.now())
  const lastReadoutMs = useRef(performance.now())

  const report = useCallback((text: string) => setMessages((current) => appendMessages(current, [text])), [])
  const stop = useCallback((reason: string) => {
    blockedRef.current = true; blockedReasonRef.current = reason
    setBlocked(true); setBlockedReason(reason); setNotice(errorText(reason))
  }, [])
  const save = useCallback((snapshot: PublicWorldState) => {
    if (blockedRef.current) return
    lastSaveMs.current = performance.now()
    saveQueue.current = saveQueue.current.then(async () => {
      if (blockedRef.current) return
      const currentStorage = storage()
      if (!currentStorage) { stop('storage-error'); return }
      const result = await commitPublicSnapshot(currentStorage, locks(), snapshot, expectedBytes.current)
      if (!result.ok) { stop(result.reason); return }
      expectedBytes.current = result.value.bytes
      lastSaveMs.current = performance.now()
      if (worldRef.current === snapshot) travelDirty.current = false
      setNotice('Public v6 progress saved on this device. Legacy saves remain untouched.')
    }).catch(() => stop('storage-error'))
  }, [stop])
  const activate = (start: PublicStart) => {
    expectedBytes.current = start.bytes; worldRef.current = start.state
    setWorld(start.state); setBusy(false); setBlocked(false); setBlockedReason(null)
    blockedRef.current = false; blockedReasonRef.current = null
    setNotice('Public v6 progress is saved. Greenway and Mireglass share one player.')
    lastSaveMs.current = performance.now()
  }
  useEffect(() => {
    let cancelled = false
    const currentStorage = storage()
    if (!currentStorage) { stop('storage-error'); setBusy(false); return }
    void inspectPublicEntry(currentStorage, locks()).then((result) => {
      if (cancelled) return
      if (!result.ok) { stop(result.reason); setBusy(false); return }
      setEntry(result.value); setBusy(false)
      const { root, classic, expanded, artifacts } = result.value
      if (root.status === 'invalid' || root.status === 'storage-error'
        || artifacts.status === 'storage-error'
        || artifacts.stage.status === 'pending' || artifacts.stage.status === 'invalid'
        || artifacts.backup.status === 'invalid'
        || classic.status === 'storage-error' || expanded.status === 'storage-error') {
        stop('existing invalid root, pending stage, or unreadable storage'); return
      }
      setNotice(root.status === 'missing' ? 'Choose a new Greenway world or explicitly import a legacy save.'
        : 'A public v6 world is available. Resume it explicitly to play.')
    }).catch(() => { if (!cancelled) { stop('storage-error'); setBusy(false) } })
    return () => { cancelled = true }
  }, [stop])

  const choose = async (operation: Promise<PublicOperation<PublicStart>>) => {
    setBusy(true)
    const result = await operation
    if (result.ok) activate(result.value)
    else { setBusy(false); setNotice(errorText(result.reason)) }
  }
  const chooseFresh = (profile: GenerationProfile) => {
    if (!entry) return
    const currentStorage = storage()
    if (!currentStorage) { stop('storage-error'); return }
    const legacyPresent = entry.classic.status !== 'missing' || entry.expanded.status !== 'missing'
    if (legacyPresent && confirmFresh !== profile) { setConfirmFresh(profile); return }
    void choose(startFreshPublicWorld(currentStorage, locks(), profile, legacyPresent))
  }
  const retrySave = async () => {
    if (!transientSaveFailure(blockedReasonRef.current) || !worldRef.current) return
    setBusy(true)
    await saveQueue.current
    blockedRef.current = false; blockedReasonRef.current = null
    setBlocked(false); setBlockedReason(null); setNotice('Retrying the unchanged v6 save root…')
    save(worldRef.current)
    await saveQueue.current
    setBusy(false)
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
        if (forceSave && travelDirty.current) save(worldRef.current)
        return
      }
      try {
        const result = advancePublicControls(worldRef.current, frames, samples)
        worldRef.current = result.state
        if (result.events.length || result.rejections.length || now - lastReadoutMs.current >= 1_000) {
          setWorld(result.state); lastReadoutMs.current = now
        }
        const nextStore = result.state.movementOwner === 'greenway'
          ? retainOpenStoreId(greenwayForPublicView(result.state), openStoreRef.current) : null
        openStoreRef.current = nextStore; setOpenStoreId(nextStore)
        const texts = [...result.events.filter((event) => event.type !== 'player_moved' && event.type !== 'player_looked')
          .map((event) => eventText(event.type)), ...result.rejections.map((rejection) => rejection.message)]
        if (texts.length) setMessages((current) => appendMessages(current, texts))
        if (result.events.some((event) => event.type === 'player_moved' || event.type === 'player_looked'
          || event.type === 'tile_discovered' || event.type === 'player_jumped')) travelDirty.current = true
        if ((frames.length && result.events.length) || (travelDirty.current
          && (forceSave || now - lastSaveMs.current >= TRAVEL_SAVE_MS))) save(result.state)
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
  }, [world !== null, save, stop])

  const actMireglass = useCallback((action: MireglassExpeditionAction) => {
    const current = worldRef.current
    if (!current || current.movementOwner !== 'streamed' || blockedRef.current) return
    const result = actPublicMireglass(current, action)
    if (result.rejection) { report(result.rejection.message); return }
    worldRef.current = result.state; setWorld(result.state)
    report(eventText(result.event.type)); save(result.state)
  }, [report, save])
  const onIntent = useCallback((intent: WizardViewIntent) => {
    const current = worldRef.current
    if (!current || blockedRef.current) return
    if (intent.type === 'movement') { recordTimedMovement(input.current, intent.atMs ?? performance.now(), intent.vector); return }
    if (intent.type === 'movement.tap') {
      if (intent.source !== 'keyboard') pending.current.push(streamedControlIntents(current.player.yaw, intent.vector))
      return
    }
    if (intent.type === 'jump') { pending.current.push([{ type: 'jump' }]); return }
    if (intent.type === 'build-site.select') {
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
      const choice = mireglassNearestInteractChoice(region)
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
  }, [actMireglass, report, selectedSiteId])

  const projection = useMemo(() => world ? publicWorldViewProjection(world, messages, selectedSiteId, openStoreId) : null,
    [world, messages, selectedSiteId, openStoreId])
  const region = world?.movementOwner === 'streamed' ? mireglassForPublicView(world) : null
  const choices = region ? mireglassActionChoices(region) : []
  const objective = region ? mireglassNextObjective(region) : null
  if (!world || !projection) {
    const root = entry?.root
    const legacyPresent = entry && (entry.classic.status !== 'missing' || entry.expanded.status !== 'missing')
    return <main className="wr-public-menu"><style>{STYLES}</style><section className="wr-public-card">
      <h1>Wizard Realms</h1><p>One public world connects Greenway and Mireglass Reach. Choose how to begin.</p>
      <p role="status" className={blocked ? 'wr-public-warning' : ''}>{notice}</p>
      {entry?.artifacts.status === 'available' && entry.artifacts.backup.status === 'available' &&
        <p>Verified v6 backup bytes exist. They will not be restored automatically.</p>}
      {root?.status === 'valid-playable' && !blocked && <button disabled={busy} onClick={() => { const currentStorage = storage();
        if (currentStorage) void choose(resumePublicWorld(currentStorage, locks(), root.bytes)); else stop('storage-error') }}>Resume existing v6 world</button>}
      {root?.status === 'valid-bootstrap' && !blocked && <button disabled={busy} onClick={() => { const currentStorage = storage();
        if (currentStorage) void choose(resumePublicWorld(currentStorage, locks(), root.bytes)); else stop('storage-error') }}>Finish explicit legacy import and play</button>}
      {root?.status === 'missing' && !blocked && <>
        {([entry?.classic, entry?.expanded] as const).map((source) => source?.status === 'available'
          ? <button key={source.source.profile} disabled={busy} onClick={() => { const currentStorage = storage();
            if (currentStorage) void choose(importPublicWorld(currentStorage, locks(), source)); else stop('storage-error') }}>Import {source.source.profile === 'greenway-classic-v1' ? 'classic' : 'expanded'} Greenway from {source.source.key}</button> : null)}
        {([['greenway-classic-v1', 'classic'], ['greenway-expanded-v1', 'expanded']] as const).map(([profile, label]) =>
          <button key={profile} disabled={busy} onClick={() => chooseFresh(profile)}>{confirmFresh === profile
            ? `Confirm new ${label} world; preserve legacy bytes` : `Start new ${label} Greenway world`}</button>)}
        {legacyPresent && <p className="wr-public-warning">A legacy save exists. Starting new requires a second explicit tap. Legacy bytes are never deleted or rewritten.</p>}
        {entry && (entry.classic.status === 'invalid' || entry.classic.status === 'incompatible' || entry.expanded.status === 'invalid' || entry.expanded.status === 'incompatible')
          ? <p>Some legacy saves cannot be imported. Their original bytes remain untouched.</p> : null}
      </>}
      {blocked && <><p className="wr-public-warning">No save bytes were deleted or recovered automatically. Keep site data intact until a verified recovery path is available.</p>
        <button onClick={() => window.location.reload()}>Reload to recheck storage</button></>}
    </section></main>
  }
  return <main className="wr-public" data-owner={world.movementOwner}><style>{STYLES}</style>
    <WizardSurface projection={projection} onIntent={onIntent} />
    <aside className="wr-public-panel" data-collapsed={collapsed} aria-label="Public world controls">
      <button onClick={() => setCollapsed((value) => !value)}>{collapsed ? 'World / Save' : 'Collapse controls'}</button>
      <div className="wr-public-body"><h1>{region ? 'Mireglass Reach' : 'Greenway'}</h1>
        <p role="status" className={blocked ? 'wr-public-warning' : ''}>{notice}</p>
        <p><small>x {world.player.position.x.toFixed(1)}, z {world.player.position.z.toFixed(1)} · {world.player.coins} coins · tick {world.tick}</small></p>
        <p>{messages.at(-1)}</p>
        <p><b>Next:</b> {objective?.label ?? objectiveFor(greenwayForPublicView(world))}</p>
        {region && <div className="wr-public-actions">{choices.map((choice) => <button key={choice.id} disabled={blocked}
          onClick={() => actMireglass(choice.action)}>{choice.label}<small>{choice.detail}</small></button>)}</div>}
        <button disabled={blocked} onClick={() => { if (worldRef.current) save(worldRef.current) }}>Save now</button>
        {blocked && transientSaveFailure(blockedReason) && <button disabled={busy} onClick={() => void retrySave()}>Retry Save</button>}
        {blocked && <><p className="wr-public-warning">Reload discards progress made since the last successful save.</p>
          <button onClick={() => window.location.reload()}>Reload latest saved world</button></>}
      </div>
    </aside>
  </main>
}

export default PublicWizardApp
