import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { MireglassPlayableApp } from './MireglassPlayableApp'
import { PublicWizardApp } from './PublicWizardApp'
import { PublicV8EntryApp } from './PublicV8Entry'
import { PublicV9EntryApp } from './PublicV9Entry'
import { PublicV10EntryApp } from './PublicV10Entry'
import { StreamedPreviewApp } from './StreamedPreviewApp'

const root = document.getElementById('root')
if (!root) throw new Error('Wizard Realms could not find its application root.')

// The streamed preview never mounts the v5 App, so it never reads or writes a v5 save.
const streamedPreview = new URLSearchParams(window.location.search).get('devRegion') === 'streamed'
const mireglassDev = new URLSearchParams(window.location.search).get('devRegion') === 'mireglass'
const publicWorld = new URLSearchParams(window.location.search).get('publicWorld')
createRoot(root).render(<StrictMode>{mireglassDev ? <MireglassPlayableApp />
  : streamedPreview ? <StreamedPreviewApp /> : publicWorld === 'v10' ? <PublicV10EntryApp />
    : publicWorld === 'v9' ? <PublicV9EntryApp />
    : publicWorld === 'v8' ? <PublicV8EntryApp />
    : publicWorld === '1' ? <PublicWizardApp /> : <App />}</StrictMode>)
