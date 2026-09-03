import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ReefRenderSettings, ReefRenderTelemetry } from './contracts'
import {
  advancePocketState,
  advancePocketStateDevSafe,
  createPocketNewGame,
  createPocketReefShowcase,
  devSafeSaveKey,
  dispatchPocketAction,
  isDevSafeActive,
  pocketSaveKey,
  projectPocketState,
  restorePocketGame,
  serializePocketGame,
  type PocketPreventedDeath,
} from './integration/pocketAquariumBridge'
import { ReefScene } from './scene/ReefScene'
import { FeedingProvider, type FeedingApi } from './scene/feeding'
import { SpecimenRosterProvider } from './scene/SpecimenFish'
import { PocketGameHUD } from './ui/PocketGameHUD'
import { SpecimenWorkbench } from './workbench/SpecimenWorkbench'

const UPDATE_INTERVAL_MS = 250
const MAX_ELAPSED_REAL_SECONDS = 0.5
const RENDER_TELEMETRY_INTERVAL_MS = 250
const DEFAULT_RENDER_SETTINGS: ReefRenderSettings = {
  quality: 'balanced',
  diagnosticView: 'beauty',
  brightness: 1,
}
const SEARCH_PARAMS = new URLSearchParams(window.location.search)
const WORKBENCH_SPECIES = SEARCH_PARAMS.get('workbench')
const SHOWCASE_MODE = SEARCH_PARAMS.get('showcase') === '1'
const DEV_SAFE = isDevSafeActive()
const SAVE_KEY = DEV_SAFE ? devSafeSaveKey : pocketSaveKey
const MAX_PREVENTED = 20

if (WORKBENCH_SPECIES === 'ocellaris') {
  const icon = document.createElement('link')
  icon.rel = 'icon'
  icon.href = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='14' fill='%23e87528'/%3E%3Cpath d='M10 4v24M21 4v24' stroke='white' stroke-width='5'/%3E%3C/svg%3E"
  document.head.append(icon)
}

function AquariumApp() {
  const [pocketState, setPocketState] = useState(() => {
    if (SHOWCASE_MODE) return createPocketReefShowcase()
    try {
      const saved = window.localStorage.getItem(SAVE_KEY)
      return saved ? restorePocketGame(JSON.parse(saved)) : createPocketNewGame()
    } catch {
      return createPocketNewGame()
    }
  })
  const pocketStateRef = useRef(pocketState)
  const [prevented, setPrevented] = useState<readonly PocketPreventedDeath[]>([])
  // Death protection defaults on inside the gated dev shell; toggling only changes future ticks.
  const [protectionOn, setProtectionOn] = useState(true)
  const protectionRef = useRef(true)
  protectionRef.current = protectionOn
  const [renderSettings, setRenderSettings] = useState(DEFAULT_RENDER_SETTINGS)
  const [renderTelemetry, setRenderTelemetry] = useState<ReefRenderTelemetry>()
  const lastTelemetryUpdate = useRef(0)
  const godModeOn = DEV_SAFE && protectionOn
  const view = projectPocketState(pocketState, { unlimitedCredits: godModeOn })
  pocketStateRef.current = pocketState

  useEffect(() => {
    let previousUpdate = performance.now()

    const timer = window.setInterval(() => {
      const currentUpdate = performance.now()
      const elapsedRealSeconds = Math.min(
        (currentUpdate - previousUpdate) / 1000,
        MAX_ELAPSED_REAL_SECONDS,
      )
      previousUpdate = currentUpdate
      if (DEV_SAFE && protectionRef.current) {
        const advanced = advancePocketStateDevSafe(pocketStateRef.current, elapsedRealSeconds)
        pocketStateRef.current = advanced.state
        setPocketState(advanced.state)
        if (advanced.prevented.length) setPrevented((log) => [...advanced.prevented, ...log].slice(0, MAX_PREVENTED))
        return
      }
      setPocketState((current) => advancePocketState(current, elapsedRealSeconds))
    }, UPDATE_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (SHOWCASE_MODE) return
    const save = () => {
      try { window.localStorage.setItem(SAVE_KEY, serializePocketGame(pocketStateRef.current)) } catch { /* storage is optional */ }
    }
    const timer = window.setInterval(save, 1000)
    window.addEventListener('pagehide', save)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('pagehide', save)
    }
  }, [])

  const dispatch = useCallback((action: Parameters<typeof dispatchPocketAction>[1]) => {
    setPocketState((current) => {
      // God mode: validate/apply the action with unlimited credits, then restore the real
      // dev-save balance so purchases and refills install for free without touching economy.
      if (DEV_SAFE && protectionRef.current) {
        const next = dispatchPocketAction({ ...current, credits: Number.MAX_SAFE_INTEGER }, action)
        next.credits = current.credits
        return next
      }
      return dispatchPocketAction(current, action)
    })
  }, [])

  const godMode = useMemo(() => DEV_SAFE ? {
    on: protectionOn,
    prevented,
    toggle: () => setProtectionOn((current) => !current),
  } : undefined, [prevented, protectionOn])

  const feeding = useMemo<FeedingApi>(() => ({
    food: view.food,
    feed: (normalizedX) => dispatch({ type: 'FEED', x: normalizedX }),
    consume: (foodId, eaterId) => dispatch({ type: 'CONSUME_FOOD', foodId, eaterId }),
  }), [dispatch, view.food])

  const updateRenderTelemetry = useCallback((telemetry: ReefRenderTelemetry) => {
    const now = performance.now()
    if (now - lastTelemetryUpdate.current < RENDER_TELEMETRY_INTERVAL_MS) return
    lastTelemetryUpdate.current = now
    setRenderTelemetry(telemetry)
  }, [])

  return (
    <main className="reef-app pocket-reef-app">
      <FeedingProvider value={feeding}>
        <SpecimenRosterProvider specimens={view.specimens} dispatch={dispatch}>
          <ReefScene
            snapshot={view.reefSnapshot}
            renderSettings={renderSettings}
            onRenderTelemetry={updateRenderTelemetry}
          />
        </SpecimenRosterProvider>
      </FeedingProvider>
      <PocketGameHUD
        view={view}
        dispatch={dispatch}
        renderSettings={renderSettings}
        renderTelemetry={renderTelemetry}
        onRenderSettingsChange={setRenderSettings}
        godMode={godMode}
      />
    </main>
  )
}

export default function App() {
  return WORKBENCH_SPECIES === 'ocellaris' ? <SpecimenWorkbench /> : <AquariumApp />
}
