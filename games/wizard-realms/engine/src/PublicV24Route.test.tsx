import { IDBFactory as FakeFactory } from 'fake-indexeddb'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

const captured = vi.hoisted(() => ({ element: null as import('react').ReactNode }))
vi.mock('react-dom/client', () => ({
  createRoot: () => ({ render: (element: import('react').ReactNode) => {
    captured.element = element
  } }),
}))

afterEach(() => { vi.unstubAllGlobals(); captured.element = null })

describe('the v24 browser route', () => {
  it('mounts only its opt-in entry without opening either source or target save', async () => {
    const factory = new FakeFactory(), open = vi.spyOn(factory, 'open')
    vi.stubGlobal('document', { getElementById: () => ({}) })
    vi.stubGlobal('window', { location: { search: '?publicWorld=v24' }, indexedDB: factory })
    await import('./main')
    const markup = renderToStaticMarkup(captured.element)
    expect(markup).toContain('data-public-v24-entry="true"')
    expect(markup).toContain('Checking this device for a V24 world')
    expect(markup).not.toContain('data-public-v23-entry')
    expect(markup).not.toContain('data-public-v23="true"')
    expect(open).not.toHaveBeenCalled()
    expect(await factory.databases()).toEqual([])
  })
})
