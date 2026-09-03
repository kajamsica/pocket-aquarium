import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Reef Room could not find its application root.')
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// The native Capacitor build uses a custom URL scheme and bundles these same bytes.
// Register only the production HTTP(S) host so Vite development and native loading can
// never be pinned behind a stale web cache.
if (import.meta.env.PROD && 'serviceWorker' in navigator && /^(https?:)$/.test(window.location.protocol)) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' })
  })
}
