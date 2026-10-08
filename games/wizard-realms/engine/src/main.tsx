import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { StreamedPreviewApp } from './StreamedPreviewApp'

const root = document.getElementById('root')
if (!root) throw new Error('Wizard Realms could not find its application root.')

// The streamed preview never mounts the v5 App, so it never reads or writes a v5 save.
const streamedPreview = new URLSearchParams(window.location.search).get('devRegion') === 'streamed'
createRoot(root).render(<StrictMode>{streamedPreview ? <StreamedPreviewApp /> : <App />}</StrictMode>)
