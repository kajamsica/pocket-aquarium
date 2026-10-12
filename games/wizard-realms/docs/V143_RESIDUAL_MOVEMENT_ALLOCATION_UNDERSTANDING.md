# V143 residual movement allocation understanding

## Original Ask

The full-game goal requires a sustained playable Wizard Realms campaign. The user asked for a one-renderer RAM discipline and useful quests. Fresh normal-control UI now proves the first quest, but three extended sessions reached the early renderer RAM guard before the second quest finished.

## Input PRD / Spec

V140 removed one duplicate V27 replay validation and cut sampled no-Canvas movement allocation by about 30%, from 347.4 to 243.8 MiB per 16 frames. V141-B claimed the River Works reward and built the Ledger ladder without a diagnostic GC, then stopped at 874912 KiB renderer RSS. V141-C and E resumed the genuine save, gathered eight logs and explored west, but stopped at 872544 and 872528 KiB. V142-C showed browser RSS can recover while idle and after a labeled GC, with sampled GPU RSS approximately stable. V142-E found that fake IndexedDB retains overwritten roots in test-only transaction rollback closures, so the no-Canvas long-save settled heap slope is not proof of a production leak. A unique browser memory owner remains unresolved.

## Aligned Problem Statement

Find and remove one measured, redundant residual movement allocation that is safe to eliminate without weakening authoritative frame validation, atomic saves, migration, or world rendering. Then retry the same persisted Ledger journey under the unchanged guard. If no such owner is proven, do not patch speculatively.

## Goals

- Re-profile the current V140 code's 16-frame movement and movement-plus-view path with source stacks and exact-PID memory bounds.
- Identify a single duplicated copy or validation path whose removal preserves fail-closed checks and replay parity.
- Verify focused adversarial tests, TypeScript, the before/after allocation benchmark and one guarded 5195 Ledger continuation.

## Non-Goals

No visual downgrade, guard increase, storage-format or schema rewrite, new quest feature, PR, commit, or GitHub action. The west-bank route guidance is a separate question until an organic player route proves a defect.

## Constraints

One test process at a time, 512 MiB V8 old-space and 450 MiB process RSS stop. No browser while the Node profiler runs. Preserve the 5194 preview. The 5195 persistent test profile at `/private/tmp/v141b-wizard-profile-20261011` is genuine player save data, never reset or edited directly. The browser guard stays at early 870400 KiB and hard 1024000 KiB. Existing dirty files are user-owned.

## Success Criteria

Source stacks and line-level safety proof identify one owner; the minimal change reduces measured allocations without changing accepted/rejected frames, saves or migrations; an independent reviewer approves integrity; and the same guarded Ledger UI journey progresses farther, ideally to bridge/claim. A UI guard stop is reported honestly, not disguised by a diagnostic GC or fixture.

## Open Questions

Which post-V140 validation/copy dominates movement allocations? Is it redundant at an already checked seam? Will a reduced no-Canvas allocation rate lower browser RSS enough for Ledger completion, or is native scene churn still material?

## Implementation Risks

Moving checks across authority boundaries can silently accept malformed input or break replay. Inspector sampling can distort memory; use it comparatively, not as retained heap proof. A better benchmark alone does not prove long-session browser safety.

## System Translation Routing

`not_qualified`; this is a bounded repair in the existing game. System Translation Receipt: `not_applicable`.
