export interface CoralInventoryItem {
  readonly id: number
  readonly speciesName: string
  readonly variantDisplayName: string
  readonly speciesId?: string
  readonly variantId?: string
}

export interface CoralPlacementCandidateState {
  readonly valid: boolean
  readonly frozen: boolean
  readonly message?: string
}

export type CoralDraftPhase = 'armed' | 'following' | 'frozen'

export interface CoralDraftState<T extends { readonly valid: boolean }> {
  readonly phase: CoralDraftPhase
  readonly candidate: T | null
}

export function beginCoralDraft<T extends { readonly valid: boolean }>(): CoralDraftState<T> {
  return { phase: 'armed', candidate: null }
}

export function advanceCoralDraft<T extends { readonly valid: boolean }>(draft: CoralDraftState<T>,
  candidate: T | null, intent: 'follow' | 'freeze'): CoralDraftState<T> {
  if (intent === 'follow') {
    return draft.phase === 'frozen' ? draft : { phase: candidate ? 'following' : 'armed', candidate }
  }
  if (candidate?.valid) return { phase: 'frozen', candidate }
  return draft.phase === 'frozen' ? draft : { phase: 'following', candidate }
}

export function lockableCoralDraft<T extends { readonly valid: boolean }>(draft: CoralDraftState<T> | null): T | null {
  return draft?.phase === 'frozen' && draft.candidate?.valid ? draft.candidate : null
}

export interface CoralInventoryTrayProps {
  readonly inventory: readonly CoralInventoryItem[]
  readonly activeId: number | null
  readonly candidate: CoralPlacementCandidateState | null
  readonly onArm: (coralId: number) => void
  readonly onPointerArm?: (coralId: number, event: React.PointerEvent<HTMLButtonElement>) => void
  readonly onCancel: () => void
  readonly onLock: () => void
}

export function CoralInventoryTray({
  inventory,
  activeId,
  candidate,
  onArm,
  onPointerArm,
  onCancel,
  onLock,
}: CoralInventoryTrayProps) {
  if (!inventory.length) return null

  const active = inventory.find((coral) => coral.id === activeId)
  const statusState = !active || !candidate ? 'waiting' : candidate.valid ? 'valid' : 'invalid'
  const status = !active
    ? `${inventory.length} unplaced coral${inventory.length === 1 ? '' : 's'} ready.`
    : candidate?.message ?? (candidate?.valid
      ? candidate.frozen ? 'Temporary position selected. Select Lock here to confirm.'
        : 'Valid preview. Select a temporary position in the tank.'
      : candidate ? 'This position is not valid. Choose another surface.' : 'Tap sand or rock to preview a placement.')

  return (
    <aside className="coral-inventory-tray" aria-label="Unplaced coral inventory">
      <details className="coral-tray-disclosure">
        <summary aria-label={`Coral tray, ${inventory.length} unplaced`}>
          <span>Coral tray</span><strong>{inventory.length}</strong>
        </summary>
        <div className="coral-tray-panel">
          <header><div><span>Unplaced corals</span><strong>{inventory.length} waiting</strong></div>
            <small>Drag Place, or tap it then choose sand or rock.</small></header>
          <ul>
            {inventory.map((coral) => {
              const isActive = coral.id === activeId
              return <li key={coral.id} data-active={isActive} data-species={coral.speciesId} data-variant={coral.variantId}>
                <div className="coral-tray-identity">
                  <span>{coral.speciesName}</span><strong>{coral.variantDisplayName}</strong>
                </div>
                <div className="coral-tray-actions">
                  {isActive ? <>
                    <button type="button" onClick={onCancel}>Cancel</button>
                    <button type="button" className="coral-tray-lock" disabled={!candidate?.valid || !candidate.frozen}
                      onClick={onLock}>Lock here</button>
                  </> : <button type="button" className="coral-tray-place" aria-label={`Place ${coral.variantDisplayName}`}
                    onPointerDown={(event) => { if (event.isPrimary && event.button === 0) onPointerArm?.(coral.id, event) }}
                    onClick={() => onArm(coral.id)}>Place</button>}
                </div>
              </li>
            })}
          </ul>
          <p className="coral-tray-status" data-state={statusState} aria-live="polite" aria-atomic="true">
            <span aria-hidden="true" />{status}
          </p>
        </div>
      </details>
    </aside>
  )
}
