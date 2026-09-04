import { describe, expect, it, vi } from 'vitest'

import { advanceCoralDraft, beginCoralDraft, lockableCoralDraft } from './CoralInventoryTray'

interface Candidate { readonly valid: boolean; readonly pose: string }
const valid = (pose: string): Candidate => ({ valid: true, pose })

describe('transient coral draft state', () => {
  it('follows until clicked, then freezes through movement and relocates only on another valid click', () => {
    const armed = beginCoralDraft<Candidate>()
    const following = advanceCoralDraft(armed, valid('moving'), 'follow')
    const frozen = advanceCoralDraft(following, valid('first-click'), 'freeze')

    expect(armed).toEqual({ phase: 'armed', candidate: null })
    expect(following).toMatchObject({ phase: 'following', candidate: { pose: 'moving' } })
    expect(advanceCoralDraft(frozen, valid('pointer-moved'), 'follow')).toBe(frozen)
    expect(advanceCoralDraft(frozen, { valid: false, pose: 'invalid-click' }, 'freeze')).toBe(frozen)
    expect(advanceCoralDraft(frozen, valid('relocated'), 'freeze'))
      .toMatchObject({ phase: 'frozen', candidate: { pose: 'relocated' } })
  })

  it('exposes a candidate to the sole lock action only after a valid freeze and clears on cancel', () => {
    const dispatchLock = vi.fn()
    const following = advanceCoralDraft(beginCoralDraft<Candidate>(), valid('preview'), 'follow')
    const frozen = advanceCoralDraft(following, valid('selected'), 'freeze')
    const lock = (draft: typeof frozen | null) => {
      const candidate = lockableCoralDraft(draft)
      if (candidate) dispatchLock(candidate)
    }

    lock(following)
    lock(null)
    expect(dispatchLock).not.toHaveBeenCalled()
    lock(frozen)
    expect(dispatchLock).toHaveBeenCalledOnce()
    expect(dispatchLock).toHaveBeenCalledWith({ valid: true, pose: 'selected' })
  })
})
