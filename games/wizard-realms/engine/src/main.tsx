import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { MireglassPlayableApp } from './MireglassPlayableApp'
import { PublicWizardApp } from './PublicWizardApp'
import { StreamedPreviewApp } from './StreamedPreviewApp'

const root = document.getElementById('root')
if (!root) throw new Error('Wizard Realms could not find its application root.')

// The streamed preview never mounts the v5 App, so it never reads or writes a v5 save.
const streamedPreview = new URLSearchParams(window.location.search).get('devRegion') === 'streamed'
const mireglassDev = new URLSearchParams(window.location.search).get('devRegion') === 'mireglass'
const publicV6 = new URLSearchParams(window.location.search).get('publicWorld') === '1'
createRoot(root).render(<StrictMode>{mireglassDev ? <MireglassPlayableApp />
  : streamedPreview ? <StreamedPreviewApp /> : publicV6 ? <PublicWizardApp /> : <App />}</StrictMode>)
