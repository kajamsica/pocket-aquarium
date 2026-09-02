import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  ReefAction,
  ReefRenderSettings,
  ReefRenderTelemetry,
  ReefSnapshot,
} from './contracts'
import { ReefScene } from './scene/ReefScene'
import {
  advanceReefState,
  applyReefAction,
  createInitialReefState,
} from './sim/reefSimulation'
import { ReefHUD } from './ui/ReefHUD'

const UPDATE_INTERVAL_MS = 250
const MAX_ELAPSED_REAL_SECONDS = 0.5
const RENDER_TELEMETRY_INTERVAL_MS = 250
const DEFAULT_RENDER_SETTINGS: ReefRenderSettings = {
  quality: 'balanced',
  diagnosticView: 'beauty',
}

export default function App() {
  const [snapshot, setSnapshot] = useState<ReefSnapshot>(createInitialReefState)
  const [renderSettings, setRenderSettings] = useState(DEFAULT_RENDER_SETTINGS)
  const [renderTelemetry, setRenderTelemetry] = useState<ReefRenderTelemetry>()
  const lastTelemetryUpdate = useRef(0)

  useEffect(() => {
    let previousUpdate = performance.now()

    const timer = window.setInterval(() => {
      const currentUpdate = performance.now()
      const elapsedRealSeconds = Math.min(
        (currentUpdate - previousUpdate) / 1000,
        MAX_ELAPSED_REAL_SECONDS,
      )
      previousUpdate = currentUpdate
      setSnapshot((current) => advanceReefState(current, elapsedRealSeconds))
    }, UPDATE_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [])

  const dispatch = useCallback((action: ReefAction) => {
    setSnapshot((current) => applyReefAction(current, action))
  }, [])

  const updateRenderTelemetry = useCallback((telemetry: ReefRenderTelemetry) => {
    const now = performance.now()
    if (now - lastTelemetryUpdate.current < RENDER_TELEMETRY_INTERVAL_MS) return
    lastTelemetryUpdate.current = now
    setRenderTelemetry(telemetry)
  }, [])

  return (
    <main className="reef-app">
      <ReefScene
        snapshot={snapshot}
        renderSettings={renderSettings}
        onRenderTelemetry={updateRenderTelemetry}
      />
      <ReefHUD
        snapshot={snapshot}
        dispatch={dispatch}
        renderSettings={renderSettings}
        renderTelemetry={renderTelemetry}
        onRenderSettingsChange={setRenderSettings}
      />
    </main>
  )
}
