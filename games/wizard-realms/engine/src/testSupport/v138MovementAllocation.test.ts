import { IDBFactory } from 'fake-indexeddb'
import { expect, it } from 'vitest'
import { createPublicV36ControllerRuntime } from '../PublicV36ControllerRuntime'
import { createAtomicV36Store } from '../domain/atomicV36Database'
import { commitPublicV36, startFreshPublicV36 } from '../domain/publicWorldV36Flow'

type Memory = { rss: number; heapTotal: number; heapUsed: number;
  external: number; arrayBuffers: number }
type AllocationNode = { callFrame: { functionName: string; url: string;
  lineNumber: number }; selfSize: number; children?: AllocationNode[] }
type InspectorSession = { connect(): void; disconnect(): void;
  post(method: string, params: object,
    callback: (error: Error | null, reply: { profile?: { head: AllocationNode } }) => void): void }
type AllocationSampler = { start(): Promise<void>;
  stop(): Promise<{ sampledMiB: number; topSites: object[] }> }
const node = globalThis as typeof globalThis & {
  process: { env: Record<string, string | undefined>; memoryUsage(): Memory }
  gc?: () => void
}
const mib = (bytes: number) => Math.round(bytes / 1048576 * 10) / 10
const read = () => node.process.memoryUsage()

function allocationSites(head: AllocationNode) {
  const sites = new Map<string, { bytes: number; stack: string[] }>()
  const walk = (node: AllocationNode, parents: AllocationNode['callFrame'][]) => {
    const frames = [...parents, node.callFrame]
    if (node.selfSize > 0) {
      const local = frames.filter((frame) => frame.url.includes('/engine/src/'))
      const stack = (local.length ? local : frames.slice(-4)).slice(-5).map((frame) =>
        `${frame.functionName || '(anonymous)'}@${frame.url.replace(/^.*\/engine\//, '')}:${frame.lineNumber + 1}`)
      const key = stack.join(' > '), prior = sites.get(key)
      sites.set(key, { bytes: node.selfSize + (prior?.bytes ?? 0), stack })
    }
    for (const child of node.children ?? []) walk(child, frames)
  }
  walk(head, [])
  const grouped = [...sites.values()]
  return { sampledMiB: mib(grouped.reduce((total, site) => total + site.bytes, 0)),
    topSites: grouped.sort((a, b) => b.bytes - a.bytes).slice(0, 6).map((site) => ({
      sampledMiB: mib(site.bytes), stack: site.stack })) }
}

async function phase(name: string, run: (sample: () => void) => void | Promise<void>,
  allocations?: AllocationSampler, label = 'V138_MEMORY', rssLimit = Infinity) {
  node.gc?.()
  const before = read()
  const peak = { ...before }
  const observe = () => {
    const current = read()
    for (const key of Object.keys(peak) as (keyof Memory)[])
      peak[key] = Math.max(peak[key], current[key])
    return current
  }
  const sample = () => {
    observe()
    if (peak.rss > rssLimit)
      throw Error(`${name}: RSS exceeded ${mib(rssLimit)} MiB guard`)
  }
  const startedAt = performance.now()
  await allocations?.start()
  const timer = setInterval(observe, 10)
  let end: Memory
  let sites: Awaited<ReturnType<AllocationSampler['stop']>> | undefined
  try { sample(); await run(sample); sample(); end = read() }
  finally { clearInterval(timer); sites = await allocations?.stop() }
  node.gc?.()
  const settled = read()
  const values = (memory: Memory) => Object.fromEntries(
    (Object.keys(memory) as (keyof Memory)[]).map((key) => [key, mib(memory[key])]))
  console.log(label + ' ' + JSON.stringify({ phase: name,
    durationMs: Math.round(performance.now() - startedAt),
    beforeMiB: values(before), peakMiB: values(peak),
    endMiB: values(end), settledMiB: values(settled) }))
  if (sites) console.log(label.replace('_MEMORY', '_ALLOC') + ' ' +
    JSON.stringify({ phase: name, ...sites }))
  if (settled.rss > rssLimit)
    throw Error(`${name}: settled RSS exceeded ${mib(rssLimit)} MiB guard`)
  return { peak, settled }
}

async function allocationSampler() {
  const inspector = await import('node:inspector' as string) as {
    Session: new () => InspectorSession }
  const session: InspectorSession = new inspector.Session()
  session.connect()
  const post = (method: string, params: object = {}) => new Promise<{
    profile?: { head: AllocationNode } }>((resolve, reject) =>
    session.post(method, params, (error, reply) => error ? reject(error) : resolve(reply)))
  await post('HeapProfiler.enable')
  const allocations: AllocationSampler = {
    start: async () => { await post('HeapProfiler.startSampling', {
      samplingInterval: 524288, includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true }) },
    stop: async () => {
      const reply = await post('HeapProfiler.stopSampling')
      if (!reply.profile) throw Error('Missing V8 allocation sample')
      return allocationSites(reply.profile.head)
    },
  }
  return { allocations, close: () => session.disconnect() }
}

const profile = node.process.env.WR_V138_PROFILE === '1'

;(profile ? it : it.skip)('profiles a fresh V36 movement, view, and checked save without Canvas',
  async () => {
    expect(node.gc).toBeTypeOf('function')
    const factory = new IDBFactory(), store = createAtomicV36Store(factory)
    const locks = { request: async (_name: string, _options: unknown,
      body: () => Promise<unknown>) => body() } as never
    let start: Awaited<ReturnType<typeof startFreshPublicV36>> | undefined
    await phase('fresh_start', async (sample) => {
      start = await startFreshPublicV36(locks, store, 'wizard-realms')
      sample()
    })
    if (!start?.ok) throw Error(start?.reason ?? 'Fresh V36 start missing')
    const initial = start.value
    let runtime: ReturnType<typeof createPublicV36ControllerRuntime> | undefined
    await phase('runtime_init', (sample) => {
      runtime = createPublicV36ControllerRuntime(initial,
        (revision, lineage, witness) => commitPublicV36(locks, store,
          revision, lineage, witness))
      sample()
    })
    if (!runtime) throw Error('V36 runtime missing')
    const active = runtime
    const { allocations, close } = await allocationSampler()
    const frame = [{ type: 'move' as const, delta: { x: 0, z: -0.08 } }]
    let accepted = 0, visibleTiles = 0
    try {
      await phase('advance_only_16', (sample) => {
        for (let index = 0; index < 16; index++) {
          if (active.advanceFrame(frame, false).rejections.length === 0) accepted++
          sample()
        }
      }, allocations)
      await phase('advance_plus_view_16', (sample) => {
        for (let index = 0; index < 16; index++) {
          if (active.advanceFrame(frame, false).rejections.length === 0) accepted++
          sample()
          visibleTiles += active.view().activeTiles.length
          sample()
        }
      }, allocations)
      expect(accepted).toBe(32)
      expect(visibleTiles).toBeGreaterThan(0)
      let saved: Awaited<ReturnType<typeof active.save>> | undefined
      await phase('checked_save', async (sample) => {
        saved = await active.save()
        sample()
      }, allocations)
      expect(saved?.status).toBe('saved')
      expect(active.committed().head.saveRevision).toBe(1)
    } finally { close() }
  }, 120_000)

const longProfile = node.process.env.WR_V142_PROFILE === '1'

;(longProfile ? it : it.skip)('profiles six V36 no-Canvas forward and reverse cycles',
  async () => {
    expect(node.gc).toBeTypeOf('function')
    const rssLimit = 450 * 1048576
    const factory = new IDBFactory(), store = createAtomicV36Store(factory)
    const locks = { request: async (_name: string, _options: unknown,
      body: () => Promise<unknown>) => body() } as never
    let start: Awaited<ReturnType<typeof startFreshPublicV36>> | undefined
    await phase('v142_fresh_start', async (sample) => {
      start = await startFreshPublicV36(locks, store, 'wizard-realms')
      sample()
    }, undefined, 'V142_MEMORY', rssLimit)
    if (!start?.ok) throw Error(start?.reason ?? 'Fresh V36 start missing')
    const initial = start.value
    let runtime: ReturnType<typeof createPublicV36ControllerRuntime> | undefined
    await phase('v142_runtime_init', (sample) => {
      runtime = createPublicV36ControllerRuntime(initial,
        (revision, lineage, witness) => commitPublicV36(locks, store,
          revision, lineage, witness))
      sample()
    }, undefined, 'V142_MEMORY', rssLimit)
    if (!runtime) throw Error('V36 runtime missing')
    const active = runtime
    const initialRevision = active.committed().head.saveRevision
    const blocks: { peak: Memory; settled: Memory }[] = []
    let accepted = 0, saves = 0, visibleTiles = 0
    for (let cycle = 1; cycle <= 6; cycle++) {
      for (let half = 0; half < 2; half++) {
        const block = (cycle - 1) * 2 + half + 1
        const direction = half === 0 ? 'forward' : 'reverse'
        const frame = [{ type: 'move' as const,
          delta: { x: 0, z: half === 0 ? -0.08 : 0.08 } }]
        const memory = await phase(`v142_block_${block}_${direction}`, async (sample) => {
          for (let step = 0; step < 16; step++) {
            const result = active.advanceFrame(frame, false)
            if (result.rejections.length)
              throw Error(`Block ${block} frame ${step + 1} rejected: ${JSON.stringify(result.rejections)}`)
            accepted++
            visibleTiles += active.view().activeTiles.length
            sample()
          }
          const saved = await active.save()
          if (saved.status !== 'saved')
            throw Error(`Block ${block} checked save failed: ${JSON.stringify(saved)}`)
          saves++
          sample()
          if (active.committed().head.saveRevision !== initialRevision + saves)
            throw Error(`Block ${block} checked revision mismatch`)
        }, undefined, 'V142_MEMORY', rssLimit)
        blocks.push(memory)
        console.log('V142_BLOCK ' + JSON.stringify({ block, cycle, direction,
          accepted, saves, peakRssMiB: mib(memory.peak.rss),
          settledRssMiB: mib(memory.settled.rss) }))
      }
    }
    expect(accepted).toBe(192)
    expect(saves).toBe(12)
    expect(visibleTiles).toBeGreaterThan(0)
    const fields = Object.keys(blocks[0].peak) as (keyof Memory)[]
    const values = (memory: Memory) => Object.fromEntries(fields.map((key) =>
      [key, mib(memory[key])]))
    const maxima = Object.fromEntries(fields.map((key) => [key, mib(Math.max(
      ...blocks.map((block) => block.peak[key])))]))
    console.log('V142_SUMMARY ' + JSON.stringify({ accepted, saves,
      block1SettledMiB: values(blocks[0].settled),
      block12SettledMiB: values(blocks[11].settled), peakMaxMiB: maxima }))
  }, 180_000)

const matrixProfile = node.process.env.WR_V158_PROFILE === '1'

;(matrixProfile ? it : it.skip)('profiles isolated V36 save and view allocation arms',
  async () => {
    expect(node.gc).toBeTypeOf('function')
    const rssLimit = 450 * 1048576
    const armOrder = ['save+view', 'save+no-view', 'no-save+view',
      'no-save+no-view'] as const
    const selectedArm = node.process.env.WR_V159_ARM
    const selectedArms = armOrder.filter((arm) => selectedArm === undefined || arm === selectedArm)
    if (!selectedArms.length) throw Error(`Invalid WR_V159_ARM: ${selectedArm}`)
    const locks = { request: async (_name: string, _options: unknown,
      body: () => Promise<unknown>) => body() } as never
    const { allocations, close } = await allocationSampler()
    console.log('V158_ORDER ' + JSON.stringify({ armOrder: selectedArms, framesPerBlock: 16,
      blocksPerArm: 6, direction: 'alternating forward/reverse' }))
    try {
      for (const arm of selectedArms) {
        const hasSave = arm.startsWith('save')
        const hasView = arm.endsWith('view') && !arm.endsWith('no-view')
        const store = createAtomicV36Store(new IDBFactory())
        let runtime: ReturnType<typeof createPublicV36ControllerRuntime> | undefined
        await phase(`${arm}_init`, async (sample) => {
          const start = await startFreshPublicV36(locks, store, 'wizard-realms')
          sample()
          if (!start.ok) throw Error(start.reason ?? `${arm}: fresh start missing`)
          runtime = createPublicV36ControllerRuntime(start.value,
            (revision, lineage, witness) => commitPublicV36(locks, store,
              revision, lineage, witness))
          sample()
        }, undefined, 'V158_MEMORY', rssLimit)
        if (!runtime) throw Error(`${arm}: V36 runtime missing`)
        const active = runtime
        let accepted = 0, saves = 0, visibleTiles = 0
        const blocks: { peak: Memory; settled: Memory }[] = []
        for (let block = 1; block <= 6; block++) {
          const direction = block % 2 ? 'forward' : 'reverse'
          const frame = [{ type: 'move' as const,
            delta: { x: 0, z: block % 2 ? -0.08 : 0.08 } }]
          let blockVisibleTiles = 0
          const memory = await phase(`${arm}_block_${block}_${direction}`,
            async (sample) => {
              for (let step = 0; step < 16; step++) {
                const result = active.advanceFrame(frame, false)
                if (result.rejections.length)
                  throw Error(`${arm} block ${block} frame ${step + 1} rejected: `
                    + JSON.stringify(result.rejections))
                accepted++
                if (hasView) {
                  const tiles = active.view().activeTiles.length
                  blockVisibleTiles += tiles
                  visibleTiles += tiles
                }
                sample()
              }
              if (hasSave) {
                const saved = await active.save()
                if (saved.status !== 'saved')
                  throw Error(`${arm} block ${block} checked save failed: `
                    + JSON.stringify(saved))
                saves++
                sample()
              }
            }, block === 1 && hasView ? allocations : undefined,
            'V158_MEMORY', rssLimit)
          blocks.push(memory)
          const readback = await store.readChecked()
          if (readback.status !== 'valid')
            throw Error(`${arm} block ${block} readback: ${readback.status}`)
          const revision = readback.root.head.saveRevision
          if (revision !== saves) throw Error(`${arm} block ${block} revision ${revision} != ${saves}`)
          const frames = (witness: typeof readback.root.head.witness) =>
            witness?.kind === 'frame-batch/v1' ? witness.frames.length : 0
          console.log('V158_BLOCK ' + JSON.stringify({ arm, block, direction,
            accepted, saves, checkedRevision: revision, visibleTiles,
            blockVisibleTiles, pendingFrames: accepted - saves * 16,
            peakRssMiB: mib(memory.peak.rss), settledRssMiB: mib(memory.settled.rss),
            currentWitnessFrames: frames(readback.root.head.witness),
            previousWitnessFrames: readback.root.previous
              ? frames(readback.root.previous.witness) : 0,
            serializedRootBytes: new TextEncoder().encode(
              JSON.stringify(readback.root)).byteLength }))
        }
        expect(accepted).toBe(96)
        expect(saves).toBe(hasSave ? 6 : 0)
        if (hasView) expect(visibleTiles).toBeGreaterThan(0)
        else expect(visibleTiles).toBe(0)
        console.log('V158_SUMMARY ' + JSON.stringify({ arm, accepted, saves,
          visibleTiles, block1SettledRssMiB: mib(blocks[0].settled.rss),
          block6SettledRssMiB: mib(blocks[5].settled.rss),
          peakRssMiB: mib(Math.max(...blocks.map((item) => item.peak.rss))) }))
      }
    } finally { close() }
  }, 240_000)
