import { describe, expect, it } from 'vitest'
import { createPublicSaveNoticeTracker as legacyNotices,
  createPublicSaveScheduler as legacyScheduler } from './PublicWizardApp'
import type { PublicSaveRequest as LegacyPublicSaveRequest } from './PublicWizardApp'
import { createPublicSaveNoticeTracker, createPublicSaveScheduler } from './publicSaveScheduler'
import type { PublicSaveRequest } from './publicSaveScheduler'

describe('extracted public save scheduler compatibility', () => {
  it('keeps the legacy exports identical to the direct module exports', () => {
    expect(legacyNotices).toBe(createPublicSaveNoticeTracker)
    expect(legacyScheduler).toBe(createPublicSaveScheduler)
  })

  it('preserves manual notice and queued write behavior through the direct module', async () => {
    const notices = createPublicSaveNoticeTracker()
    const written: number[] = []
    const request: PublicSaveRequest<{ tick: number }> = {
      snapshot: { tick: 7 }, manual: true, queuedDuringManual: false, savedTravelVersion: 7,
    }
    const legacyRequest: LegacyPublicSaveRequest<{ tick: number }> = request
    expect(notices.queueManual(7)).toContain('Manual save queued at tick 7')
    const scheduler = createPublicSaveScheduler<{ tick: number }>(async ({ snapshot }) => {
      written.push(snapshot.tick)
      return true
    })
    scheduler.enqueue(legacyRequest)
    await scheduler.whenIdle()
    expect(written).toEqual([7])
    expect(notices.completed(true, 'v11', 3, 7))
      .toBe('Manual v11 save #3 completed at tick 7 on this device.')
  })
})
