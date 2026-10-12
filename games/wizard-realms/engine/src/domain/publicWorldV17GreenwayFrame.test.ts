import { describe, expect, it } from 'vitest'
import { advancePublicV17GreenwayFrame } from './publicWorldV17GreenwayFrame'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import { createFreshPublicV17Head } from './publicWorldV17Snapshot'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import type { PublicV17Progress } from './publicWorldV17Validation'

describe('v17 built bridge movement feedback', () => {
  it('explains the actual bridge lane on an off-rail wet entry, while a centered crossing succeeds', () => {
    const seed = 'wizard-realms'
    const site = resolvePublicV17GreenwaySite(seed, 'works4:bridge:greenway-creek:-14')
    if (!site || site.kind !== 'bridge') throw new Error('Missing built x=-1.4 bridge')
    const { head } = createFreshPublicV17Head(seed)
    const greenwayWorks = { ...head.greenwayWorks, builtBridgeIds: [site.id] }
    const at = (x: number, z: number): PublicV17Progress => {
      const support = publicV17StarterSupportAt({ seed,
        profile: head.state.generationProfile,
        route: head.state.greenway.routes[0] ?? null,
        built: false, greenwayWorks }, { x, z })
      if (!support) throw new Error('Missing dry-bank support')
      return { state: { ...head.state, player: { ...head.state.player,
        yaw: 2.805, position: { x, y: support.floorY, z } } }, greenwayWorks }
    }

    const side = at(0.2, 5.9)
    const frame = advancePublicV17GreenwayFrame(side,
      [{ type: 'move', delta: { x: 0, z: 0.16 } }], { walkRequested: true })
    expect(frame.rejections).toEqual([expect.objectContaining({
      code: 'off_connector',
      message: 'Move to a dry-bank end of the built bridge centered at x=-1.4 m '
        + '(lane x=-2.2 to -0.6 m), then cross straight along its rails.',
    })])
    expect(frame.progress.state.player.position).toEqual(side.state.player.position)

    let centered = at(site.from.x, site.from.z - 0.2)
    for (let step = 0; step < 54; step++) {
      const frame = advancePublicV17GreenwayFrame(centered,
        [{ type: 'move', delta: { x: 0, z: 0.16 } }], { walkRequested: true })
      expect(frame.rejections, `centered crossing step ${step}`).toEqual([])
      centered = frame.progress
    }
    expect(centered.state.player.position.x).toBe(site.from.x)
    expect(centered.state.player.position.z).toBeGreaterThan(site.to.z)
  })

  it.each([
    ['bridge', 'works4:bridge:greenway-creek:-14'],
    ['ladder', 'works4:ladder:greenway-north-cliff:11'],
    ['dig', 'works3:dig:0:4'],
  ] as const)('uses the same final support for a grounded %s move', (kind, id) => {
    const seed = 'wizard-realms'
    const { head } = createFreshPublicV17Head(seed)
    const site = resolvePublicV17GreenwaySite(seed, id)
    if (!site || site.kind !== kind) throw new Error(`Missing ${kind} site`)
    const greenwayWorks = {
      builtBridgeIds: kind === 'bridge' ? [id] : [],
      builtLadderIds: kind === 'ladder' ? [id] : [],
      dugTileIds: kind === 'dig' ? [id] : [],
    }
    const point = site.kind === 'dig' ? { x: site.center.x, z: site.center.z }
      : { x: site.from.x, z: site.from.z + (site.kind === 'bridge' ? -0.2 : 0.6) }
    const context = { seed, profile: head.state.generationProfile,
      route: head.state.greenway.routes[0] ?? null, built: false, greenwayWorks }
    const startSupport = publicV17StarterSupportAt(context, point)
    if (!startSupport) throw new Error('Missing starting support')
    const progress: PublicV17Progress = { state: { ...head.state,
      player: { ...head.state.player, position: { ...point, y: startSupport.floorY } } },
    greenwayWorks }
    const delta = site.kind === 'dig' ? { x: 0.16, z: 0 }
      : { x: 0, z: site.kind === 'bridge' ? 0.16 : -0.16 }
    const frame = advancePublicV17GreenwayFrame(progress,
      [{ type: 'look', yawDelta: 0.08, pitchDelta: 0 }, { type: 'move', delta }],
      { walkRequested: true })
    expect(frame.rejections).toEqual([])
    const position = frame.progress.state.player.position
    const endSupport = publicV17StarterSupportAt(context, position)
    expect(endSupport).not.toBeNull()
    expect(position.y).toBe(endSupport?.floorY)
    expect(frame.progress.state.player.verticalVelocity).toBe(0)
    expect(frame.progress.state.player.yaw).toBe(progress.state.player.yaw + 0.08)
    expect(frame.progress.state.tick).toBe(progress.state.tick + 1)
  })

  it('still resolves support for idle, look-only, jump, and airborne frames', () => {
    const { head } = createFreshPublicV17Head('wizard-realms')
    const progress = { state: head.state, greenwayWorks: head.greenwayWorks }
    const idle = advancePublicV17GreenwayFrame(progress, [], { walkRequested: true })
    expect(idle.rejections).toEqual([])
    expect(idle.progress.state.player.position).toEqual(progress.state.player.position)
    const looked = advancePublicV17GreenwayFrame(idle.progress,
      [{ type: 'look', yawDelta: 0.08, pitchDelta: 0 }], { walkRequested: true })
    expect(looked.rejections).toEqual([])
    expect(looked.progress.state.player.position).toEqual(progress.state.player.position)
    const jumped = advancePublicV17GreenwayFrame(looked.progress,
      [{ type: 'jump' }], { walkRequested: true })
    expect(jumped.rejections).toEqual([])
    expect(jumped.progress.state.player.position.y)
      .toBeGreaterThan(progress.state.player.position.y)
    const airborne = advancePublicV17GreenwayFrame(jumped.progress,
      [], { walkRequested: true })
    expect(airborne.rejections).toEqual([])
    expect(airborne.progress.state.player.verticalVelocity)
      .toBeLessThan(jumped.progress.state.player.verticalVelocity)
  })
})
