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

describe('the v17 browser route', () => {
  it('mounts only its opt-in entry without opening any save before user consent', async () => {
    const factory = new FakeFactory()
    const open = vi.spyOn(factory, 'open')
    vi.stubGlobal('document', { getElementById: () => ({}) })
    vi.stubGlobal('window', { location: { search: '?publicWorld=v17' }, indexedDB: factory })
    await import('./main')
    const markup = renderToStaticMarkup(captured.element)
    expect(markup).toContain('data-public-v17-entry="true"')
    expect(markup).toContain('Checking this device for a v17 world')
    expect(markup).not.toContain('data-public-v16-entry')
    expect(markup).not.toContain('data-public-v17="true"')
    expect(open).not.toHaveBeenCalled()
    expect(await factory.databases()).toEqual([])
  })
})
