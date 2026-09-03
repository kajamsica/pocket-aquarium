import { useCallback, useEffect, useRef, useState } from 'react'

import type { ReefRenderSettings, ReefRenderTelemetry } from './contracts'
import {
  advancePocketState,
  createPocketReefShowcase,
  dispatchPocketAction,
  projectPocketState,
} from './integration/pocketAquariumBridge'
import { ReefScene } from './scene/ReefScene'
import { SpecimenRosterProvider } from './scene/SpecimenFish'
import { PocketGameHUD } from './ui/PocketGameHUD'

const UPDATE_INTERVAL_MS = 250
const MAX_ELAPSED_REAL_SECONDS = 0.5
const RENDER_TELEMETRY_INTERVAL_MS = 250
const DEFAULT_RENDER_SETTINGS: ReefRenderSettings = {
  quality: 'balanced',
  diagnosticView: 'beauty',
}

export default function App() {
  const [pocketState, setPocketState] = useState(createPocketReefShowcase)
  const [renderSettings, setRenderSettings] = useState(DEFAULT_RENDER_SETTINGS)
  const [renderTelemetry, setRenderTelemetry] = useState<ReefRenderTelemetry>()
  const lastTelemetryUpdate = useRef(0)
  const view = projectPocketState(pocketState)

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

  const dispatch = useCallback((action: Parameters<typeof dispatchPocketAction>[1]) => {
    setPocketState((current) => dispatchPocketAction(current, action))
  }, [])

  const updateRenderTelemetry = useCallback((telemetry: ReefRenderTelemetry) => {
    const now = performance.now()
    if (now - lastTelemetryUpdate.current < RENDER_TELEMETRY_INTERVAL_MS) return
    lastTelemetryUpdate.current = now
    setRenderTelemetry(telemetry)
  }, [])

  return (
    <main className="reef-app">
      <SpecimenRosterProvider specimens={view.specimens}>
        <ReefScene
          snapshot={view.reefSnapshot}
          renderSettings={renderSettings}
          onRenderTelemetry={updateRenderTelemetry}
        />
      </SpecimenRosterProvider>
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
