import { describe, expect, it } from 'vitest'
import { MOUNT_CANDIDATES, mountStatusLabel, selectMountCandidate } from './mountCatalog'

describe('five-mount workbench catalog', () => {
  it('keeps five distinct silhouettes and travel roles', () => {
    expect(MOUNT_CANDIDATES.map((mount) => mount.form)).toEqual([
      'Pack beetle', 'Amphibious newt', 'Cliff gecko', 'Burrowing mole', 'Flying ray',
    ])
    expect(new Set(MOUNT_CANDIDATES.map((mount) => mount.traversal)).size).toBe(5)
    expect(new Set(MOUNT_CANDIDATES.map((mount) => mount.id)).size).toBe(5)
  })

  it('lists only verified 3D previews as review-ready', () => {
    expect(MOUNT_CANDIDATES[0].modelUrl).toContain('ironback_beetle.glb')
    expect(MOUNT_CANDIDATES[1].modelUrl).toContain('reedskipper_newt.glb')
    expect(MOUNT_CANDIDATES[2].modelUrl).toContain('cragclaw_gecko.glb')
    expect(MOUNT_CANDIDATES[3].modelUrl).toContain('barrow_mole.glb')
    expect(MOUNT_CANDIDATES[4].modelUrl).toContain('aether_ray.glb')
    expect(MOUNT_CANDIDATES.map(mountStatusLabel)).toEqual(Array(5).fill('3D candidate ready for review'))
    expect(mountStatusLabel({ ...MOUNT_CANDIDATES[0], status: 'source_authored' })).toBe('Source authored, 3D render pending')
    expect(mountStatusLabel({ ...MOUNT_CANDIDATES[4], modelUrl: undefined })).not.toContain('ready for review')
  })

  it('selects explicitly and never silently falls back from an unknown mount', () => {
    expect(selectMountCandidate(null)?.id).toBe('ironback-beetle')
    expect(selectMountCandidate('aether-ray')?.name).toBe('Aether Ray')
    expect(selectMountCandidate('unknown')).toBeUndefined()
  })
})
