import { IDBFactory } from 'fake-indexeddb'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

const captured = vi.hoisted(() => ({ element: null as import('react').ReactNode }))
vi.mock('react-dom/client', () => ({ createRoot: () => ({
  render: (element: import('react').ReactNode) => { captured.element = element },
}) }))
afterEach(() => { vi.unstubAllGlobals(); captured.element = null })

describe('the V26 browser route', () => {
  it('mounts only the opt-in V26 entry without opening any save storage', async () => {
    const factory = new IDBFactory(), open = vi.spyOn(factory, 'open')
    vi.stubGlobal('document', { getElementById: () => ({}) })
    vi.stubGlobal('window', { location: { search: '?publicWorld=v26' }, indexedDB: factory })
    await import('./main')
    const markup = renderToStaticMarkup(captured.element)
    expect(markup).toContain('data-public-v26-entry="true"')
    expect(markup).toContain('Checking this device for a V26 world')
    expect(markup).not.toContain('data-public-v25-entry')
    expect(markup).not.toContain('data-public-v23="true"')
    expect(open).not.toHaveBeenCalled()
    expect(await factory.databases()).toEqual([])
  })
})
