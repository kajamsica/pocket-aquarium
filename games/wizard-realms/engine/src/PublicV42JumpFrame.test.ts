import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createPublicV42ControllerRuntime } from './PublicV42ControllerRuntime'
import { createAtomicV42Store } from './domain/atomicV42Database'
import { projectPublicV31Pose } from './domain/publicWorldV31Support'
import { commitPublicV42 } from './domain/publicWorldV42Flow'
import { createFreshPublicV41Root } from './domain/publicWorldV41Snapshot'
import { createPublicV42Root } from './domain/publicWorldV42Snapshot'

const locks = { request: async <T,>(_name: string, _options: { mode: 'exclusive' },
  body: () => T | Promise<T>) => body() }

describe('V42 copied Jump frames', () => {
  it('previews the airborne frames and saves the landed batch through V42', async () => {
    const source = createFreshPublicV41Root('wizard-realms')
    const root = createPublicV42Root(source)
    const store = createAtomicV42Store(new IDBFactory())
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw Error('Unexpected V42 target')
    expect(await store.commit(missing.proof, root)).toBe('committed')
    const runtime = createPublicV42ControllerRuntime({ head: root.head,
      lineage: root.lineage }, (revision, lineage, witness) =>
      commitPublicV42(locks, store, revision, lineage, witness))

    expect(runtime.advanceFrame([{ type: 'jump' }], false).rejections).toEqual([])
    expect(runtime.preview().state.player.verticalVelocity).toBeGreaterThan(0)
    expect(await runtime.save()).toMatchObject({ status: 'deferred-airborne' })
    for (let frame = 0; frame < 40; frame++) {
      const current = runtime.preview(), pose = projectPublicV31Pose(current)
      if (current.state.player.verticalVelocity === 0 && pose
        && Math.abs(pose.effective.position.y - pose.effective.floorY) < 1e-6) break
      expect(runtime.advanceFrame([], false).rejections).toEqual([])
    }
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(await store.readChecked()).toMatchObject({ status: 'valid', root: {
      head: { witness: { kind: 'frame-batch/v1' } } } })
  })
})
