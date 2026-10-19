import { IDBFactory } from 'fake-indexeddb'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

const captured = vi.hoisted(() => ({ element: null as import('react').ReactNode }))
vi.mock('react-dom/client', () => ({ createRoot: () => ({
  render: (element: import('react').ReactNode) => { captured.element = element },
}) }))
afterEach(() => { vi.unstubAllGlobals(); captured.element = null })

describe('the V25 browser route', () => {
  it('mounts only the opt-in V25 entry without opening V24 or V25 storage', async () => {
    const factory = new IDBFactory(), open = vi.spyOn(factory, 'open')
    vi.stubGlobal('document', { getElementById: () => ({}) })
    vi.stubGlobal('window', { location: { search: '?publicWorld=v25' }, indexedDB: factory })
    await import('./main')
    const markup = renderToStaticMarkup(captured.element)
    expect(markup).toContain('data-public-v25-entry="true"')
    expect(markup).toContain('Checking this device for a V25 world')
    expect(markup).not.toContain('data-public-v24-entry')
    expect(markup).not.toContain('data-public-v23="true"')
    expect(open).not.toHaveBeenCalled()
    expect(await factory.databases()).toEqual([])
  })
})
