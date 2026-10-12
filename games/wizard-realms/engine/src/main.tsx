import { lazy, StrictMode, Suspense } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import App from './App'
import { MireglassPlayableApp } from './MireglassPlayableApp'
import { PublicWizardApp } from './PublicWizardApp'
import { PublicV8EntryApp } from './PublicV8Entry'
import { PublicV9EntryApp } from './PublicV9Entry'
import { PublicV10EntryApp } from './PublicV10Entry'
import { PublicV11EntryApp } from './PublicV11Entry'
import { PublicV13EntryApp } from './PublicV13Entry'
import { PublicV14EntryApp } from './PublicV14Entry'
import { PublicV14Controller } from './PublicV14Controller'
import { PublicV15EntryApp } from './PublicV15Entry'
import { PublicV15Controller } from './PublicV15Controller'
import { PublicV16EntryApp } from './PublicV16Entry'
import { PublicV16Controller } from './PublicV16Controller'
import { PublicV17EntryApp } from './PublicV17Entry'
import { PublicV17Controller } from './PublicV17Controller'
import { PublicV23EntryApp } from './PublicV23Entry'
import { PublicV23Controller } from './PublicV23Controller'
import { PublicV24EntryApp } from './PublicV24Entry'
import { PublicV25EntryApp } from './PublicV25Entry'
import { PublicV26EntryApp } from './PublicV26Entry'
import { PublicV27EntryApp } from './PublicV27Entry'
import { PublicV28EntryApp } from './PublicV28Entry'
import { PublicV29EntryApp } from './PublicV29Entry'
import { PublicV30EntryApp } from './PublicV30Entry'
import { PublicV31EntryApp } from './PublicV31Entry'
import { PublicV32EntryApp } from './PublicV32Entry'
import { PublicV33EntryApp } from './PublicV33Entry'
import { PublicV34EntryApp } from './PublicV34Entry'
import { PublicV35EntryApp } from './PublicV35Entry'
import { PublicV36EntryApp } from './PublicV36Entry'
import { PublicV37EntryApp } from './PublicV37Entry'
import { PublicV38EntryApp } from './PublicV38Entry'
import { PublicV39EntryApp } from './PublicV39Entry'
import { PublicV40EntryApp } from './PublicV40Entry'
import { StreamedPreviewApp } from './StreamedPreviewApp'

const root = document.getElementById('root')
if (!root) throw new Error('Wizard Realms could not find its application root.')
const reactRoot = (import.meta.hot?.data.reactRoot as Root | undefined) ?? createRoot(root)
import.meta.hot?.dispose((data) => { data.reactRoot = reactRoot })

// The inspector is a separate route and code chunk. It never mounts a playable app or its save flow.
const workbenchId = new URLSearchParams(window.location.search).get('workbench')
const CharacterWorkbench = lazy(() => import('./workbench/CharacterWorkbench').then(({ CharacterWorkbench: Component }) => ({ default: Component })))
// The streamed preview never mounts the v5 App, so it never reads or writes a v5 save.
const streamedPreview = new URLSearchParams(window.location.search).get('devRegion') === 'streamed'
const mireglassDev = new URLSearchParams(window.location.search).get('devRegion') === 'mireglass'
const publicWorld = new URLSearchParams(window.location.search).get('publicWorld')
// Source review GO and measured V28 checked save/resume (349/264 ms) cleared the opt-in gate.
// No URL parameter can override this build-time readiness decision.
export const PUBLIC_V28_ENTRY_READY = true
// Checked replay, source review, and measured save latency cleared the V29 opt-in gate.
// A URL parameter cannot override this build-time readiness decision.
export const PUBLIC_V29_ENTRY_READY = true
// Checked copy, claim replay, and separate-store reload cleared the opt-in probe gate.
export const PUBLIC_V30_ENTRY_READY = true
// Separate checked store, action preflight, source review, and focused tests cleared the opt-in route.
// A URL parameter cannot override this build-time readiness decision.
export const PUBLIC_V31_ENTRY_READY = true
// Highland stays opt-in and closed until checked replay, review, and a real UI journey pass.
// V32's isolated checked store, source review, and focused replay suites cleared local UI exposure.
export const PUBLIC_V32_ENTRY_READY = true
// V33's separate checked store and V32 ancestry compile and build for opt-in UI exposure.
export const PUBLIC_V33_ENTRY_READY = true
// A distinct development save branch; source, memory and UI gates must pass before exposure.
export const PUBLIC_V34_ENTRY_READY = true
// A separate opt-in save copied explicitly from a checked V34 adventure.
export const PUBLIC_V35_ENTRY_READY = true
// V36 is a separate development save copied only by an explicit V35 choice.
export const PUBLIC_V36_ENTRY_READY = true
reactRoot.render(<StrictMode>{workbenchId !== null
  ? <Suspense fallback={<main role="status">Loading character workbench…</main>}><CharacterWorkbench workbenchId={workbenchId} /></Suspense>
  : mireglassDev ? <MireglassPlayableApp />
  : streamedPreview ? <StreamedPreviewApp /> : publicWorld === 'v40'
    ? import.meta.env.DEV
      ? <PublicV40EntryApp renderSession={(start, bindings) =>
        <PublicV23Controller version="v40" start={start} {...bindings} />} />
      : <main role="status">Experimental V40 is development-only. Your V39 adventure remains available.
        <a href="?publicWorld=v39">Open V39</a></main>
    : publicWorld === 'v39'
    ? import.meta.env.DEV
      ? <PublicV39EntryApp renderSession={(start, bindings) =>
        <PublicV23Controller version="v39" start={start} {...bindings} />} />
      : <main role="status">Experimental V39 is development-only. Your V38 adventure remains available.
        <a href="?publicWorld=v38">Open V38</a></main>
    : publicWorld === 'v38'
    ? import.meta.env.DEV
      ? <PublicV38EntryApp renderSession={(start, bindings) =>
        <PublicV23Controller version="v38" start={start} {...bindings} />} />
      : <main role="status">Experimental V38 is development-only. Your V37 adventure remains available.
        <a href="?publicWorld=v37">Open V37</a></main>
    : publicWorld === 'v37'
    ? import.meta.env.DEV
      ? <PublicV37EntryApp renderSession={(start, bindings) =>
        <PublicV23Controller version="v37" start={start} {...bindings} />} />
      : <main role="status">Experimental V37 is development-only. Your V36 adventure remains available.
        <a href="?publicWorld=v36">Open V36</a></main>
    : publicWorld === 'v36'
    ? import.meta.env.DEV && PUBLIC_V36_ENTRY_READY
      ? <PublicV36EntryApp renderSession={(start, bindings) =>
        <PublicV23Controller version="v36" start={start} {...bindings} />} />
      : <main role="status">Experimental V36 is not ready. Your V35 save remains available.
        <a href="?publicWorld=v35">Open V35</a></main>
    : publicWorld === 'v35'
    ? import.meta.env.DEV && PUBLIC_V35_ENTRY_READY
      ? <PublicV35EntryApp renderSession={(start, bindings) =>
        <PublicV23Controller version="v35" start={start} {...bindings} />} />
      : <main role="status">Experimental V35 is not ready. Your V34 save remains available.
        <a href="?publicWorld=v34">Open V34</a></main>
    : publicWorld === 'v34'
    ? import.meta.env.DEV && PUBLIC_V34_ENTRY_READY
      ? <PublicV34EntryApp renderSession={(start, bindings) =>
        <PublicV23Controller version="v34" start={start} {...bindings} />} />
      : <main role="status">Experimental V34 is not ready. This is a separate development
        save branch, not the current game. <a href="?publicWorld=v33">Open V33</a></main>
    : publicWorld === 'v33'
    ? PUBLIC_V33_ENTRY_READY
      ? <PublicV33EntryApp renderSession={(start, bindings) =>
        <PublicV23Controller version="v33" start={start} {...bindings} />} />
      : <main role="status">Fairy-ring travel is waiting for its checked save and
        UI safety gate. <a href="?publicWorld=v32">Open the current adventure</a></main>
    : publicWorld === 'v32'
    ? PUBLIC_V32_ENTRY_READY
      ? <PublicV32EntryApp renderSession={(start, bindings) =>
        <PublicV23Controller version="v32" start={start} {...bindings} />} />
      : <main role="status">Highland Quarry is waiting for checked replay, source review,
        and a real journey test. <a href="?publicWorld=v31">Open the current adventure</a></main>
    : publicWorld === 'v31'
    ? PUBLIC_V31_ENTRY_READY
      ? <PublicV31EntryApp renderSession={(start, bindings) =>
        <PublicV23Controller version="v31" start={start} {...bindings} />} />
      : <main role="status">V31 Soil Works is waiting for checked controller, placement,
        and reload verification. <a href="?publicWorld=v30">Open V30 River Works</a></main>
    : publicWorld === 'v30'
    ? PUBLIC_V30_ENTRY_READY
      ? <PublicV30EntryApp renderSession={(start, bindings) =>
        <PublicV23Controller version="v30" start={start} {...bindings} />} />
      : <main role="status">V30 River Works is waiting for checked copy, claim, and reload verification.</main>
    : publicWorld === 'v29'
    ? PUBLIC_V29_ENTRY_READY
      ? <PublicV29EntryApp renderSession={(start, bindings) =>
        <PublicV23Controller version="v29" start={start} {...bindings} />} />
      : <main role="status">V29 deep excavation is waiting for source and save-performance checks.</main>
    : publicWorld === 'v28'
    ? PUBLIC_V28_ENTRY_READY
      ? <PublicV28EntryApp renderSession={(start, bindings) =>
        <PublicV23Controller version="v28" start={start} {...bindings} />} />
      : <main role="status">V28 preview is waiting for source and save-performance checks.</main>
    : publicWorld === 'v27'
    ? <PublicV27EntryApp renderSession={(start, bindings) =>
      <PublicV23Controller version="v27" start={start} {...bindings} />} />
    : publicWorld === 'v26'
    ? <PublicV26EntryApp renderSession={(start, bindings) =>
      <PublicV23Controller version="v26" start={start} {...bindings} />} />
    : publicWorld === 'v25'
    ? <PublicV25EntryApp renderSession={(start, bindings) =>
      <PublicV23Controller version="v25" start={start} {...bindings} />} />
    : publicWorld === 'v24'
    ? <PublicV24EntryApp renderSession={(start, bindings) =>
      <PublicV23Controller version="v24" start={start} {...bindings} />} />
    : publicWorld === 'v23'
    ? <PublicV23EntryApp renderSession={(start, bindings) =>
      <PublicV23Controller start={start} {...bindings} />} />
    : publicWorld === 'v17'
    ? <PublicV17EntryApp renderSession={(start, bindings) =>
      <PublicV17Controller start={start} {...bindings} />} />
    : publicWorld === 'v16'
    ? <PublicV16EntryApp renderSession={(start, bindings) =>
      <PublicV16Controller start={start} {...bindings} />} />
    : publicWorld === 'v15'
    ? <PublicV15EntryApp renderSession={(start, bindings) =>
      <PublicV15Controller start={start} {...bindings} />} />
    : publicWorld === 'v14'
    ? <PublicV14EntryApp renderSession={(start, bindings) =>
      <PublicV14Controller start={start} {...bindings} />} />
    : publicWorld === 'v13' ? <PublicV13EntryApp />
    : publicWorld === 'v11' ? <PublicV11EntryApp />
    : publicWorld === 'v10' ? <PublicV10EntryApp />
    : publicWorld === 'v9' ? <PublicV9EntryApp />
    : publicWorld === 'v8' ? <PublicV8EntryApp />
    : publicWorld === '1' ? <PublicWizardApp /> : <App />}</StrictMode>)
