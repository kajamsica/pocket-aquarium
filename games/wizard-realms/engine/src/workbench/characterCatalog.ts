export const CHARACTER_CLIPS = ['Idle', 'Walk', 'Turn'] as const

export type CharacterClip = (typeof CHARACTER_CLIPS)[number]

export interface CharacterCandidate {
  readonly id: string
  readonly workbenchId: string
  readonly label: string
  readonly status: 'candidate_no_go'
  readonly statusLabel: string
  readonly glbUrl: string
  readonly referenceUrl: string
  readonly reviewRenders: readonly { readonly label: string; readonly url: string }[]
  readonly expectedClips: readonly CharacterClip[]
  readonly visualDebt: readonly string[]
}

/** Candidates are inspectable, not playable. Promotion needs a separate visual acceptance decision. */
export const CHARACTER_CANDIDATES: readonly CharacterCandidate[] = [
  {
    id: 'wayfarer-v2-male',
    workbenchId: 'wayfarer',
    label: 'Wayfarer wizard, male v2',
    status: 'candidate_no_go',
    statusLabel: 'Visual NO-GO',
    glbUrl: new URL('../../art/characters/wayfarer_v2/wayfarer_v2_male.glb', import.meta.url).href,
    referenceUrl: new URL('../../art/concepts/wayfarer-male-concept-v4.png', import.meta.url).href,
    reviewRenders: [
      { label: 'Front', url: new URL('../../art/characters/wayfarer_v2/male_front.png', import.meta.url).href },
      { label: 'Three-quarter', url: new URL('../../art/characters/wayfarer_v2/male_three_quarter.png', import.meta.url).href },
      { label: 'Side', url: new URL('../../art/characters/wayfarer_v2/male_side.png', import.meta.url).href },
      { label: 'Back', url: new URL('../../art/characters/wayfarer_v2/male_back.png', import.meta.url).href },
    ],
    expectedClips: CHARACTER_CLIPS,
    visualDebt: [
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
