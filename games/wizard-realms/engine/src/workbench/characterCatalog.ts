export const CHARACTER_CLIPS = ['Idle', 'Walk', 'Turn'] as const

export type CharacterClip = (typeof CHARACTER_CLIPS)[number]

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
      'Check Idle, Walk, and Turn, plus an exported height of about 2.1 to 2.4 m.',
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
    expectedClips: CHARACTER_CLIPS,
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
