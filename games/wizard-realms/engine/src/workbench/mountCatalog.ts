export interface MountCandidate {
  readonly id: string
  readonly name: string
  readonly form: string
  readonly traversal: string
  readonly silhouette: string
  readonly acquisition: string
  readonly status: 'design_proposed' | 'source_authored' | 'review_ready'
  readonly modelUrl?: string
}

// A model URL is added only after the exported GLB exists and has been checked.
// Source scripts or design notes alone must not be presented as a 3D preview.
export const MOUNT_CANDIDATES: readonly MountCandidate[] = [
  {
    id: 'ironback-beetle', name: 'Ironback', form: 'Pack beetle',
    traversal: 'Ground cargo', silhouette: 'Six low legs, a broad plated shell, and side cargo panniers.',
    acquisition: 'Earn its trust through hauling and care.', status: 'review_ready',
    modelUrl: new URL('../../art/creatures/ironback_beetle/ironback_beetle.glb', import.meta.url).href,
  },
  {
    id: 'reedskipper-newt', name: 'Reedskipper', form: 'Amphibious newt',
    traversal: 'Wetland and river', silhouette: 'Long salamander body, webbed feet, and a broad swimming tail.',
    acquisition: 'Raise one near the marsh after learning watercraft.', status: 'review_ready',
    modelUrl: new URL('../../art/creatures/reedskipper_newt/reedskipper_newt.glb', import.meta.url).href,
  },
  {
    id: 'cragclaw-gecko', name: 'Cragclaw', form: 'Cliff gecko',
    traversal: 'Steep stone', silhouette: 'Splayed gripping toes, alert eyes, and a balancing tail.',
    acquisition: 'Build a safe cliff route before bonding.', status: 'review_ready',
    modelUrl: new URL('../../art/creatures/cragclaw_gecko/cragclaw_gecko.glb', import.meta.url).href,
  },
  {
    id: 'barrow-mole', name: 'Barrow', form: 'Burrowing mole',
    traversal: 'Diggable ground', silhouette: 'Heavy foreclaws, a tapered snout, and a compact tunneling body.',
    acquisition: 'Develop excavation skill and a suitable habitat.', status: 'review_ready',
    modelUrl: new URL('../../art/creatures/barrow_mole/barrow_mole.glb', import.meta.url).href,
  },
  {
    id: 'aether-ray', name: 'Aether Ray', form: 'Flying ray',
    traversal: 'Late-game flight', silhouette: 'A wide manta-like wing plane and a trailing rudder tail.',
    acquisition: 'A top-level reward after mastering care, magic, and travel.', status: 'review_ready',
    modelUrl: new URL('../../art/creatures/aether_ray/aether_ray.glb', import.meta.url).href,
  },
]

export function selectMountCandidate(id: string | null): MountCandidate | undefined {
  return id === null ? MOUNT_CANDIDATES[0] : MOUNT_CANDIDATES.find((candidate) => candidate.id === id)
}

export function mountStatusLabel(candidate: MountCandidate): string {
  if (candidate.status === 'review_ready' && candidate.modelUrl) return '3D candidate ready for review'
  if (candidate.status === 'source_authored') return 'Source authored, 3D render pending'
  return 'Design proposed, 3D model pending'
}
