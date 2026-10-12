/** Public v11 ordinary movement uses one 50 ms frame. This policy is not saved. */
export const PUBLIC_WALK_STEP_METERS = 0.16
export const PUBLIC_RUN_STEP_METERS = 0.24
export const PUBLIC_V11_BOOTS_LISTING_ID = 'v11-leather-boots'
export const PUBLIC_V11_BOOTS_PRICE = 25

export function publicV11Gait(feet: string | null, walkRequested: boolean) {
  const canRun = feet === 'leather_boots'
  const pace = canRun && !walkRequested ? 'run' : 'walk'
  return {
    canRun,
    pace,
    metersPerStep: pace === 'run' ? PUBLIC_RUN_STEP_METERS : PUBLIC_WALK_STEP_METERS,
    reason: canRun ? pace === 'run' ? 'Running in leather boots' : 'Walking by choice'
      : feet === 'mireglass_reach/item/waders' ? 'Fen waders: walk only'
        : feet === null ? 'Barefoot: walk only' : 'This footwear: walk only',
  } as const
}
