export const CHARACTER_ON_FOOT_CLIPS = ['Idle', 'Walk', 'Run', 'TurnLeft', 'TurnRight', 'Jump'] as const
export const CHARACTER_RIDE_CLIPS = ['RideIdle', 'RideWalk', 'RideRun'] as const
export const CHARACTER_TOOL_GRIP_CLIP = 'ToolGrip' as const
export const CHARACTER_CLIPS = [...CHARACTER_ON_FOOT_CLIPS, ...CHARACTER_RIDE_CLIPS] as const
const V2_CHARACTER_CLIPS = ['Idle', 'Walk', 'Turn'] as const

export type CharacterClip = (typeof CHARACTER_CLIPS)[number] | (typeof V2_CHARACTER_CLIPS)[number]
export type CharacterRideClip = (typeof CHARACTER_RIDE_CLIPS)[number]

/** Rider-root translation in mount-local meters; adjust from the adult mount export's seat metadata. */
export const RIDER_SEAT_OFFSET: readonly [number, number, number] = [0, 1.1502, -0.04]

export const ADULT_SEDGEHORN_PREVIEW = {
  glbUrl: new URL('../../art/creatures/sedgehorn_mount/sedgehorn_adult.glb', import.meta.url).href,
  clipsByRiderClip: { RideIdle: 'Idle', RideWalk: 'Walk', RideRun: 'Run' },
  requiredClips: ['Idle', 'Walk', 'Run'],
} as const satisfies {
  readonly glbUrl: string
  readonly clipsByRiderClip: Readonly<Record<CharacterRideClip, 'Idle' | 'Walk' | 'Run'>>
  readonly requiredClips: readonly ('Idle' | 'Walk' | 'Run')[]
}

export function missingAdultSedgehornClips(availableNames: readonly string[]) {
  return ADULT_SEDGEHORN_PREVIEW.requiredClips.filter((name) => !availableNames.includes(name))
}

export function overlappingToolGripTracks(clips: readonly { readonly name: string; readonly tracks: readonly { readonly name: string }[] }[]) {
  const grip = clips.find((clip) => clip.name === CHARACTER_TOOL_GRIP_CLIP)
  if (!grip) return []
  const onFootTrackNames = new Set(clips
    .filter((clip) => CHARACTER_ON_FOOT_CLIPS.some((name) => name === clip.name))
    .flatMap((clip) => clip.tracks.map((track) => track.name)))
  return grip.tracks.map((track) => track.name).filter((name) => onFootTrackNames.has(name))
}

export const CHARACTER_HELD_TOOLS = [
  { id: 'none', label: 'None' },
  { id: 'axe', label: 'Axe' },
  { id: 'basic-pick', label: 'Basic pick' },
  { id: 'enchanted-pick', label: 'Enchanted pick' },
  { id: 'spade', label: 'Field spade' },
  { id: 'wand', label: 'Oak wand (staff-like)' },
] as const

export type CharacterHeldTool = (typeof CHARACTER_HELD_TOOLS)[number]['id']

export function onFootHeldTool(candidateId: string, heldTool: CharacterHeldTool, riding: boolean): Exclude<CharacterHeldTool, 'none'> | null {
  return candidateId === 'wayfarer-v9-male' && !riding && heldTool !== 'none' ? heldTool : null
}

export interface CharacterCandidate {
  readonly id: string
  readonly workbenchId: string
  readonly label: string
  readonly status: 'design_approved' | 'candidate_no_go'
  readonly statusLabel: string
  readonly summary: string
  readonly renderCaption: string
  readonly glbUrl: string
  readonly conceptUrl: string
  readonly approvedRenders: readonly { readonly label: string; readonly url: string }[]
  readonly reviewRenders: readonly { readonly label: string; readonly url: string }[]
  readonly expectedClips: readonly CharacterClip[]
  readonly reviewNotes: readonly string[]
}

const APPROVED_V9_RENDERS = [
  { label: 'Front', url: new URL('../../art/characters/wayfarer_v9_approved/v9_front.png', import.meta.url).href },
  { label: 'Three-quarter', url: new URL('../../art/characters/wayfarer_v9_approved/v9_three_quarter.png', import.meta.url).href },
  { label: 'Side', url: new URL('../../art/characters/wayfarer_v9_approved/v9_side.png', import.meta.url).href },
  { label: 'Back', url: new URL('../../art/characters/wayfarer_v9_approved/v9_back.png', import.meta.url).href },
] as const

/** The selected V9 design is approved; the exported GLB still needs runtime inspection. */
export const CHARACTER_CANDIDATES: readonly CharacterCandidate[] = [
  {
    id: 'wayfarer-v9-male',
    workbenchId: 'wayfarer',
    label: 'Wayfarer wizard, male V9',
    status: 'design_approved',
    statusLabel: 'V9 design approved',
    summary: 'The selected bottom-row V9 design is approved for the playable Wayfarer. Inspect the exported GLB here for visual fidelity, scale, and animation before treating the game asset as verified.',
    renderCaption: 'V9 Blender review render',
    glbUrl: new URL('../../art/characters/wayfarer_v9_game/wayfarer_v9_male.glb', import.meta.url).href,
    conceptUrl: new URL('../../art/concepts/wayfarer-male-concept-v4.png', import.meta.url).href,
    approvedRenders: APPROVED_V9_RENDERS,
    reviewRenders: [
      { label: 'Front', url: new URL('../../art/characters/wayfarer_v9_game/male_front.png', import.meta.url).href },
      { label: 'Three-quarter', url: new URL('../../art/characters/wayfarer_v9_game/male_three_quarter.png', import.meta.url).href },
      { label: 'Side', url: new URL('../../art/characters/wayfarer_v9_game/male_side.png', import.meta.url).href },
      { label: 'Back', url: new URL('../../art/characters/wayfarer_v9_game/male_back.png', import.meta.url).href },
    ],
    expectedClips: CHARACTER_CLIPS,
    reviewNotes: [
      'The bottom-row V9 design is the approved art direction; this GLB is the game asset candidate.',
      'Compare the loaded model with the approved V9 bust renders and the game asset review renders.',
      'Check Idle, Walk, Run, stepping TurnLeft and TurnRight, and the Jump preview with each right-hand tool, plus an exported height of about 2.1 to 2.4 m.',
    ],
  },
  {
    id: 'wayfarer-v2-male',
    workbenchId: 'wayfarer',
    label: 'Wayfarer wizard, male v2',
    status: 'candidate_no_go',
    statusLabel: 'Visual NO-GO',
    summary: 'V2 remains a rejected technical comparison. Its valid rig does not make it the approved playable Wayfarer.',
    renderCaption: 'Rejected V2 Blender candidate',
    glbUrl: new URL('../../art/characters/wayfarer_v2/wayfarer_v2_male.glb', import.meta.url).href,
    conceptUrl: new URL('../../art/concepts/wayfarer-male-concept-v4.png', import.meta.url).href,
    approvedRenders: APPROVED_V9_RENDERS,
    reviewRenders: [
      { label: 'Front', url: new URL('../../art/characters/wayfarer_v2/male_front.png', import.meta.url).href },
      { label: 'Three-quarter', url: new URL('../../art/characters/wayfarer_v2/male_three_quarter.png', import.meta.url).href },
      { label: 'Side', url: new URL('../../art/characters/wayfarer_v2/male_side.png', import.meta.url).href },
      { label: 'Back', url: new URL('../../art/characters/wayfarer_v2/male_back.png', import.meta.url).href },
    ],
    expectedClips: V2_CHARACTER_CLIPS,
    reviewNotes: [
      'Face and hair read as assembled primitives instead of the approved sculpted forms.',
      'Sleeves and robe need tailored shapes, cloth folds, and stronger surface detail.',
      'This valid rig is for pipeline inspection only and is not the playable character.',
    ],
  },
]

export function selectCharacterCandidate(workbenchId: string, candidateId: string | null): CharacterCandidate | undefined {
  const matches = CHARACTER_CANDIDATES.filter((candidate) => candidate.workbenchId === workbenchId)
  return candidateId === null ? matches[0] : matches.find((candidate) => candidate.id === candidateId)
}
