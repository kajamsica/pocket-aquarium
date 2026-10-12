import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { choosePublicV34Entry, inspectPublicV34Entry,
  PublicV34EntryView } from './PublicV34Entry'
import type { PublicV34EntryBindings } from './PublicV34Entry'
import { inspectPublicV34, resumePublicV34, startPublicV34 } from './domain/publicWorldV34Flow'
import type { PublicV34Start } from './domain/publicWorldV34Flow'
import mainSource from './main.tsx?raw'

vi.mock('./domain/publicWorldV34Flow', () => ({
  inspectPublicV34: vi.fn(), resumePublicV34: vi.fn(), startPublicV34: vi.fn(),
}))

const inspect = vi.mocked(inspectPublicV34)
const resume = vi.mocked(resumePublicV34)
const start = vi.mocked(startPublicV34)
const saved = { head: { saveRevision: 7 }, lineage: { origin: 'v33-migration' } } as unknown as PublicV34Start

function bindings(): PublicV34EntryBindings {
  const store = { readChecked: vi.fn(() => { throw Error('legacy read') }) }
  return { locks: { request: vi.fn() }, store: {} as never,
    v33Store: store, v32Store: store, v31Store: store, v30Store: store,
    v29Store: store, v28Store: store, v27Store: store, v26Store: store,
    v25Store: store, v24Store: store, v23Store: store, v17Store: store } as unknown as PublicV34EntryBindings
}

beforeEach(() => { vi.clearAllMocks() })

describe('V34 separate-branch entry', () => {
  it('resumes only the V34 target and never reads ancestors on resume', async () => {
    const f = bindings()
    inspect.mockResolvedValue({ ok: true, value: { status: 'valid', start: saved } })
    resume.mockResolvedValue({ ok: true, value: saved })
    const decision = await inspectPublicV34Entry(f)
    expect(decision).toEqual({ status: 'resume', start: saved })
    expect(await choosePublicV34Entry(decision, 'resume', f))
      .toEqual({ ok: true, value: saved })
    expect(inspect).toHaveBeenCalledWith(f.locks, f.store)
    expect(resume).toHaveBeenCalledWith(f.locks, f.store, 7, saved.lineage)
    expect(start).not.toHaveBeenCalled()
    expect(f.v33Store.readChecked).not.toHaveBeenCalled()
  })

  it('requires an explicit copy and rechecks that V34 is still missing', async () => {
    const f = bindings()
    inspect.mockResolvedValue({ ok: true, value: { status: 'migration-available' } })
    start.mockResolvedValue({ ok: true, value: saved })
    const decision = await inspectPublicV34Entry(f)
    expect(decision).toEqual({ status: 'copy-available' })
    expect(start).not.toHaveBeenCalled()
    expect(await choosePublicV34Entry(decision, 'copy', f))
      .toEqual({ ok: true, value: saved })
    expect(inspect).toHaveBeenCalledTimes(2)
    expect(start).toHaveBeenCalledOnce()
    expect(start.mock.calls[0]).toHaveLength(14)
    expect(start.mock.calls[0][2]).toBe(f.v33Store)
    expect(start.mock.calls[0][13]).toBe(f.v17Store)
  })

  it('does not copy over a target that appears during the choice', async () => {
    const f = bindings()
    inspect.mockResolvedValue({ ok: true, value: { status: 'valid', start: saved } })
    expect(await choosePublicV34Entry({ status: 'copy-available' }, 'copy', f))
      .toEqual({ ok: false, reason: 'target-conflict' })
    expect(start).not.toHaveBeenCalled()
  })

  it('blocks corrupt storage and does not claim fresh adventure creation', async () => {
    const f = bindings()
    inspect.mockResolvedValue({ ok: true, value: { status: 'blocked', reason: 'corrupt' } })
    expect(await inspectPublicV34Entry(f)).toEqual({ status: 'blocked', reason: 'corrupt' })
    expect(await choosePublicV34Entry({ status: 'blocked', reason: 'corrupt' }, 'copy', f))
      .toEqual({ ok: false, reason: 'choice-unavailable' })
    const copy = renderToStaticMarkup(createElement(PublicV34EntryView, {
      entry: { status: 'copy-available' }, busy: false,
      onChoose: () => {}, onRetry: () => {}, actionError: null }))
    expect(copy).toContain('Experimental V34 preview, separate save branch')
    expect(copy).toContain('V33 remains unchanged')
    expect(copy).toContain('does not yet create a new adventure')
    expect(copy).toContain('Copy V33 adventure into V34')
    expect(copy).not.toContain('Start new adventure')
    expect(mainSource).toContain('export const PUBLIC_V34_ENTRY_READY = false')
    expect(mainSource).toContain("publicWorld === 'v34'")
  })
})
