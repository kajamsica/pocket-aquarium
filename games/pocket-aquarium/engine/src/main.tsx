import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { pocketSaveKey } from './integration/pocketAquariumBridge'
import { eraseAllPocketAquariumData } from './integration/pocketTankRepository'
import './styles.css'

class PocketRootErrorBoundary extends Component<{ readonly children: ReactNode }, {
  readonly failed: boolean
  readonly eraseFailed: boolean
}> {
  state = { failed: false, eraseFailed: false }

  static getDerivedStateFromError() {
    return { failed: true, eraseFailed: false }
  }

  private eraseAndRestart = () => {
    const confirmed = window.confirm('Permanently delete every aquarium and local preference on this device? This cannot be undone.')
    if (!confirmed) return
    try {
      eraseAllPocketAquariumData(window.localStorage, pocketSaveKey)
      const freshUrl = new URL(window.location.href)
      freshUrl.search = ''
      freshUrl.hash = ''
      window.location.replace(freshUrl.toString())
    } catch {
      this.setState({ eraseFailed: true })
    }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <main className="reef-app pocket-recovery-screen">
      <section aria-labelledby="pocket-recovery-title">
        <span aria-hidden="true">◌</span>
        <p>Pocket Aquarium recovery</p>
        <h1 id="pocket-recovery-title">The aquarium hit rough water.</h1>
        <p>Your saved tanks are still on this device. Try reopening the game first.</p>
        <div>
          <button className="hud-button hud-button-primary" type="button" onClick={() => window.location.reload()}>Try again</button>
          <button className="hud-button pocket-destructive-action" type="button" onClick={this.eraseAndRestart}>Erase all data and restart</button>
        </div>
        {this.state.eraseFailed ? <strong role="alert">Data could not be erased. Check this browser's storage permissions and try again.</strong> : null}
      </section>
    </main>
  }
}

const root = document.getElementById('root')

if (!root) {
  throw new Error('Reef Room could not find its application root.')
}

createRoot(root).render(
  <StrictMode>
    <PocketRootErrorBoundary><App /></PocketRootErrorBoundary>
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
