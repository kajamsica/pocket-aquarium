import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ReefRenderSettings, ReefRenderTelemetry } from './contracts'
import {
  advancePocketState,
  createPocketNewGame,
  createPocketReefShowcase,
  dispatchPocketAction,
  pocketSaveKey,
  projectPocketState,
  restorePocketGame,
  serializePocketGame,
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
      const saved = window.localStorage.getItem(pocketSaveKey)
      return saved ? restorePocketGame(JSON.parse(saved)) : createPocketNewGame()
    } catch {
      return createPocketNewGame()
    }
  })
  const pocketStateRef = useRef(pocketState)
  const [renderSettings, setRenderSettings] = useState(DEFAULT_RENDER_SETTINGS)
  const [renderTelemetry, setRenderTelemetry] = useState<ReefRenderTelemetry>()
  const lastTelemetryUpdate = useRef(0)
  const view = projectPocketState(pocketState)
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
      setPocketState((current) => advancePocketState(current, elapsedRealSeconds))
    }, UPDATE_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (SHOWCASE_MODE) return
    const save = () => {
      try { window.localStorage.setItem(pocketSaveKey, serializePocketGame(pocketStateRef.current)) } catch { /* storage is optional */ }
    }
    const timer = window.setInterval(save, 1000)
    window.addEventListener('pagehide', save)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('pagehide', save)
    }
  }, [])

  const dispatch = useCallback((action: Parameters<typeof dispatchPocketAction>[1]) => {
    setPocketState((current) => dispatchPocketAction(current, action))
  }, [])

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
      />
    </main>
  )
}

export default function App() {
  return WORKBENCH_SPECIES === 'ocellaris' ? <SpecimenWorkbench /> : <AquariumApp />
}
