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

describe('the v15 browser route', () => {
  it('mounts only its own opt-in entry before reading or writing a save', async () => {
    const factory = new FakeFactory()
    const open = vi.spyOn(factory, 'open')
    vi.stubGlobal('document', { getElementById: () => ({}) })
    vi.stubGlobal('window', { location: { search: '?publicWorld=v15' }, indexedDB: factory })
    await import('./main')
    const markup = renderToStaticMarkup(captured.element)
    expect(markup).toContain('data-public-v15-entry="true"')
    expect(markup).toContain('Checking this device for a v15 world')
    expect(markup).not.toContain('data-public-v14-entry')
    expect(markup).not.toContain('data-public-v15="true"')
    expect(open).not.toHaveBeenCalled()
    expect(await factory.databases()).toEqual([])
  })
})
