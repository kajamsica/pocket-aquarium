import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ReefRenderSettings, ReefRenderTelemetry } from './contracts'
import { projectPocketState } from './integration/pocketAquariumBridge'
import { createPocketGameController } from './integration/pocketGameController'
import { FeedingProvider, type FeedingApi } from './scene/feeding'
import { ReefScene } from './scene/ReefScene'
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
const WORKBENCH_SPECIES = new URLSearchParams(window.location.search).get('workbench')

if (WORKBENCH_SPECIES === 'ocellaris') {
  const icon = document.createElement('link')
  icon.rel = 'icon'
  icon.href = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='14' fill='%23e87528'/%3E%3Cpath d='M10 4v24M21 4v24' stroke='white' stroke-width='5'/%3E%3C/svg%3E"
  document.head.append(icon)
}

function AquariumApp() {
  const controller = useMemo(() => createPocketGameController(), [])
  const [view, setView] = useState(() => projectPocketState(controller.getState()))
  const [renderSettings, setRenderSettings] = useState(DEFAULT_RENDER_SETTINGS)
  const [renderTelemetry, setRenderTelemetry] = useState<ReefRenderTelemetry>()
  const lastTelemetryUpdate = useRef(0)

  // The controller owns mutable state; the scene and HUD only ever project its snapshots.
  useEffect(() => controller.subscribe((state) => setView(projectPocketState(state))), [controller])

  useEffect(() => {
    let previousUpdate = performance.now()
    const timer = window.setInterval(() => {
      const currentUpdate = performance.now()
      const elapsedRealSeconds = Math.min(
        (currentUpdate - previousUpdate) / 1000,
        MAX_ELAPSED_REAL_SECONDS,
      )
      previousUpdate = currentUpdate
      controller.advance(elapsedRealSeconds)
    }, UPDATE_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [controller])

  useEffect(() => {
    const flush = () => controller.save()
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
    }
  }, [controller])

  const dispatch = useCallback(
    (action: Parameters<typeof controller.dispatch>[0]) => controller.dispatch(action),
    [controller],
  )

  // Tapping the water and mouth contact both flow through the one authoritative dispatcher.
  const feeding = useMemo<FeedingApi>(() => ({
    food: view.food,
    feed: (normalizedX) => controller.dispatch({ type: 'FEED', x: normalizedX }),
    consume: (foodId, eaterId) => controller.dispatch({ type: 'CONSUME_FOOD', foodId, eaterId }),
  }), [controller, view.food])

  const updateRenderTelemetry = useCallback((telemetry: ReefRenderTelemetry) => {
    const now = performance.now()
    if (now - lastTelemetryUpdate.current < RENDER_TELEMETRY_INTERVAL_MS) return
    lastTelemetryUpdate.current = now
    setRenderTelemetry(telemetry)
  }, [])

  return (
    <main className="reef-app pocket-reef-app">
      <FeedingProvider value={feeding}>
        <SpecimenRosterProvider specimens={view.specimens}
          select={(id) => controller.dispatch({ type: 'SELECT_ENTITY', entityType: 'livestock', id })}>
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
