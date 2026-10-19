# Ticket pack: V27 travel truth and starter affordances

## Understanding and scope

The player reports that visible land sometimes stops movement without an intelligible reason, while the starter river, cliff, trees, boots, spade, and rescue do not yet feel like one learned-by-play loop. The accepted full-game goal and `STARTER_VALLEY_WORLD_LOOP_UNDERSTANDING.md` remain in force. This pack is a bounded V27 preview repair, not the completion of the RPG or a rewrite of saved V26 behavior.

Source audit found a concrete contradiction: V27 allows ordinary dry rises up to 0.8 m and draws them as walkable, but Greenway/streamed owner handoff still calls the V14 starter mover with its 0.55 m limit. Both crossing directions can therefore reject a visibly smoothed dry lip. The controller then compresses several failures to a generic terrain message. The river and north/side rim are already canonical collision/render obstacles; V27 must not relax either, open an excavated pit, or create new traversal outside the finite grid.

Equipping a spade already auto-selects Dig; the checked writer addresses a clicked, discovered dry 4 m column and saves its divot and deterministic place/depth stratum. Existing stone/ore/diamond tiers are not all mineable by a spade. The 30-minute stuck-only return is checked and saved. These systems must be explained accurately, not reimplemented here.

One larger gap is deliberately separate: the canonical V25 river spans the 2 km map, while existing buildable bridge sites and support remain tied to the old starter creek or Mireglass fen. A subsequent versioned bridge-placement pack must make valid river crossings constructible along the canonical watercourse. This pack must not falsely claim that all visible river banks are presently bridgeable.

## Acceptance contract

1. V27 crosses an ordinary dry 0.55–0.8 m lip at the Greenway/streamed owner boundary in both directions when receiving support is valid. V26 and earlier results stay unchanged.
2. River, authored north cliff, side rock return, open pit, unsupported wetland, and finite world edge remain blocked under the existing checked rules. The source-pinned V27 save and replay path still validates after save/reload.
3. A blocked V27 movement attempt gives a concise cause and actionable direction for the actual obstacle, rather than `checked V27 terrain`, and held input does not spam messages. Do not promise a bridge at an unbuildable site.
4. The first-session UI presents trees as materials for either river bridge or cliff ladder, boots as the run upgrade, and spade as click-to-dig. It updates after construction and when the pack is full. Avoid an always-closed, coordinate-heavy instruction wall.
5. At least one real UI retry on the existing V27 URL covers starting guidance, a dry owner crossing, river/cliff stop cues, and save/reload. Use one isolated renderer, close it afterward, and keep the preview running. Build and focused tests pass. No GitHub action.

## Interface and ownership

The new movement policy is an optional trailing `PublicV17GroundStepPolicy` through `starterCliffAdvanceMove`, `advancePublicV14BoundaryFrame`, and `createPublicV14ContinuousSession`. Omitted policy retains the exact 0.55 m historical default. `createPublicV17ContinuousSession` passes its existing optional policy into both boundary directions and its nested V14 session. V27 supplies `{ maxOrdinaryGroundStepMeters: 0.8 }` through its existing frame replay. The special authored cliff seam is always capped at 0.55 m and still requires ladder support. No save schema or witness shape changes.

For blocked V27 movement, use pre-commit source facts to distinguish river, rim/cliff, side rock, dry step, wetland, and world edge. Keep V26 output unchanged. A cue must describe an available response; when no legal crossing exists at the touched bank, say to follow the bank to a marked crossing. UI guidance derives from current authoritative projection and does not award items or alter progress.

## Lane graph and smallest viable diff

`TRUTH-A` owner handoff policy and focused domain tests runs in parallel with `TRUTH-B` V27 rejection classification and runtime tests and `TRUTH-C` starter guidance and component tests. Their production files do not overlap. `TRUTH-I` integrates/test-runs after all three. `TRUTH-Q` independently reviews source and performs the single-renderer UI acceptance. The source-pinned V27 authoring is a bounded policy bug fix: prior accepted V27 frames replay identically, and no V26 call opts in. If a historical accepted witness changes or migration proof fails, stop and replan as a V28 root.

The normal small-diff target is one owner seam per lane, with no new dependency, asset, broad refactor, or unrelated world change. The crossing seam justifies several linked production files because both owner directions must agree. The river-wide bridge system is a separate merge unit and must not be slipped into this patch.

## Tickets

### TRUTH-A: checked dry owner seam

- Role: implementer. Files owned: `domain/starterCliffMovement.ts`, `domain/publicWorldV14Boundary.ts`, `domain/publicWorldV14ContinuousSession.ts`, `domain/publicWorldV17ContinuousSession.ts`, and nearest tests, including a new V27 boundary regression. No UI files.
- Implement the optional policy above. Test both directions at a verified 0.55–0.8 m dry owner join; test no-policy V14/V26 parity and unchanged cliff, wetland, world-edge, and river restrictions. Existing policy cannot bypass the authored north seam or a physical connector.
- Validate focused Vitest and TypeScript. No browser/GitHub. Tripwire: accepted historical witness changes, new save fields, or streamed ownership validating a pose with a different floor.

### TRUTH-B: honest V27 blocked reason

- Role: implementer. Files owned: `PublicV26ControllerRuntime.ts` and its tests only. No movement-domain policy or UI component edits.
- For V27 only, classify the actual attempted segment before a generic fallback. Preserve V26 messages. A saved ladder/bridge changes guidance. Side rock return and world edge need distinct language. Do not suggest a bridge at arbitrary river banks as though placement is available there.
- Validate focused runtime tests and TypeScript. No browser/GitHub. Tripwire: changing authority, event sequence, or witness shape.

### TRUTH-C: starter loop coaching

- Role: implementer. Files owned: `PublicV23Controller.tsx`, `view/WizardHud.tsx`, and their nearest tests only. No domain or renderer edits.
- Make the starter help discoverable and concise: tree logs can build an 8-log bridge or 4-log ladder, with useful store/boots/spade next steps; full pack prompts use or sale of carried materials. Preserve adaptive route-built text and don't present rare ores as spade rewards. Keep cues deduplicated and touch-accessible.
- Validate focused component tests and TypeScript. No browser/GitHub. Tripwire: claiming an unavailable build site, route, or sale for terrain-bag contents.

### TRUTH-I and TRUTH-Q

- Integration owner: main. Check merged source, focused tests, `tsc`, production build, V26/V27 route availability, and `git diff --check` without altering unrelated dirty files. Resolve only lane interface conflicts; do not use a broad reset.
- Reviewer/UI tester: one isolated Playwright CLI renderer using `test-from-ui` in `early_smoke` then `final_proof`. Reproduce one dry boundary crossing, one river and cliff cue, and save/reload on `?publicWorld=v27`. Capture screenshot and console/network evidence, then close the browser. A failure must return the exact entrypoint and action for a short causal retry.

## Routing and status

Transport: native ephemeral subagents, inherited model. No durable Codex task, GitHub action, or account switch is authorized. System translation: not qualified. Product agent runtime: not required. Main owns dispatch receipts, integration, deadline, user surface, and final report. User access to the live preview is a milestone, not completion.
