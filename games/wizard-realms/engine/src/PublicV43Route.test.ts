import { describe, expect, it } from 'vitest'
import mainSource from './main.tsx?raw'

describe('V43 dev route', () => {
  it('mounts the checked entry and V43 controller only in development', () => {
    expect(mainSource).toContain("import { PublicV43EntryApp } from './PublicV43Entry'")
    const route = mainSource.indexOf("publicWorld === 'v43'")
    const v42 = mainSource.indexOf("publicWorld === 'v42'")
    expect(route).toBeGreaterThan(0)
    expect(route).toBeLessThan(v42)
    expect(mainSource.slice(route, v42)).toContain('import.meta.env.DEV')
    expect(mainSource.slice(route, v42)).toContain(
      '<PublicV43EntryApp renderSession={(start, bindings) =>')
    expect(mainSource.slice(route, v42)).toContain(
      '<PublicV23Controller version="v43" start={start} {...bindings} />')
    expect(mainSource.slice(route, v42)).toContain(
      '<main role="status">Experimental V43 is development-only.</main>')
    expect(mainSource.slice(route, v42)).not.toContain('V42 adventure remains available')
    expect(mainSource.slice(route, v42)).not.toContain('<a href=')
  })
})
