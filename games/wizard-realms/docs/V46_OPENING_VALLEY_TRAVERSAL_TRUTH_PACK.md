# V46 opening-valley traversal truth, evidence pack

## Aligned problem and locked design

The continuing goal is a complete ~2 km third-person wizard RPG. This pack addresses the player's specific opening-valley failure report before changing movement authority: land that looks walkable should not silently stop the avatar; a real cliff should visibly imply a ladder; a continuous river should visibly imply a bridge; equipping a spade should reveal a truthful clickable digging candidate. The starter valley is a learnable resource loop, not a permanent boundary. Preserve the V29 save, checked action, discovery, geology, and migration contracts. Do not claim a full campaign from this pack.

## Important repo truth and public interface

- Worktree `/private/tmp/pa-wizard-playable-v2`, branch `ben/wizard-playable-v2`, existing broad dirty/untracked state. Do not commit, push, or discard it.
- User surface `http://127.0.0.1:5193/?publicWorld=v29` is live. Use one isolated browser/WebGL renderer at a time and close that browser after the probe; keep Vite live.
- `PublicV28ControllerRuntime.ts` owns checked blocked-step text, `PublicV23Controller.tsx` displays its centered cue, `TerrainSurfaceLayer.tsx` owns terrain geometry, and `publicWorldV25River.ts` owns the connected river predicate. `publicWorldV29DeepDigAction.ts` owns checked dig eligibility. `WizardScene.tsx`/`WizardSurface.tsx` own visual pointing and controls.
- V45 already proved spade purchase/equip, auto-Dig, first protected target rejection, second target's saved soil/0.4 m divot. V40 proved bridge traversal and reload. Deeper Dig, Fill, and a blocked-step visible-world reconciliation remain unproven.

## Lane graph and topology audit

V46-A UI early smoke and V46-B source truth audit run concurrently. They share no writes. Only A uses a renderer. Primary synthesizes the first reproducible blocker and authors a separate bounded repair pack if one is found. No implementer is authorized by this evidence pack. No reviewer/finisher needed for read-only evidence; primary reconciles receipts. Conditional code repair is deliberately deferred because the exact observed owner is unknown. Topology audit: PASS, two independent read-only lanes, no write collision, one renderer, explicit receipt and stop conditions, no unowned repair.

## Smallest Viable Diff

Behavior delta: none in this evidence pack. Expected diff budget: 1 documentation file only, 0 source/test files, 0 dependencies. Forbidden: production source, tests, save migration, package files, GitHub actions. Reuse scan: blocked cue path, existing terrain meshes, checked movement and dig action, V40/V45 UI proof. Prompt/config alternative: a wording change may be enough only if geometry already honestly presents a physical obstacle; do not assume. Deletion/simplification: not applicable to read-only lanes. Validation: UI screenshot, exact visible message, console/network record; source line references and render-versus-authority comparison. Tripwire: if a source/movement/schema change is needed, stop and author a new pack.

## V46-A: first obstructed visible-land step

Lane role: read-only UI reviewer. Dispatch transport: native_spawned_subagent (continued native child session is allowed). Model: inherited. Cursor runtime: not_applicable. Existing-task routing: not authorized; mission/capability, coordination scope, custody, status, delivery policy and task/thread receipt: not_applicable. No-interruption disposition: no unrelated task contacted. Agent spec: test-from-ui early_smoke plus Playwright. Session policy: initialize_once_then_continue. Worker agent: native child. Final fallback transport: none; activation conditions and CLI/model/actions: not_applicable. Runtime rationale: current child has recent sole-renderer V45 UI proof, and the short visible journey needs live browser observation.

First contact: read applicable test-from-ui and Playwright skills, this pack, and V45 evidence; role lock to read-only. Use fresh isolated browser profile with only one WebGL tab. Start new through visible UI. Without source-derived coordinates, walk toward the first visible apparently walkable area that refuses a checked step. Capture before/after screenshot, exact keys/clicks, visible centered cue (or absence), whether the physical obstacle is visible, console/network and app URL. Stop at the first decision-bearing block. If no such block occurs on the obvious first-valley path, report the traversed route and one representative cliff/river block, not a prolonged search. Do not inspect source, inject state, modify files, or open a second renderer. Close the isolated browser at end. Acceptance: reproducible browser observation, screenshot path(s), exact cue and geometry description, browser health, renderer-closed receipt. This is early smoke, not final acceptance.

## V46-B: render-versus-reachability trace

Lane role: read-only source reviewer. Dispatch transport: native_spawned_subagent (continued native child session is allowed). Model: inherited. Cursor runtime: not_applicable. Existing-task routing: not authorized; mission/capability, coordination scope, custody, status, delivery policy and task/thread receipt: not_applicable. No-interruption disposition: no unrelated task contacted. Agent spec: findings-first source review. Session policy: initialize_once_then_continue. Worker agent: native child. Final fallback transport: none; activation conditions and CLI/model/actions: not_applicable. Runtime rationale: current child recently traced the cue owner and can independently inspect render and authority without RAM-intensive UI.

First contact: read this pack and smallest-viable-diff; role lock to read-only reviewer. Trace V29 beginning geography and finite bound, the rock return/cliff/river collision vs rendered geometry, and the hover Dig outline vs actual checked eligibility. Return a source-proven contradiction only with file/line and conditions; distinguish otherwise untested visual ambiguity. Name the smallest existing owner for any concrete fix, but do not edit. No browser, tests, Git writes, or messages to A before its first observation. Acceptance: exact source references, one concise render/authority matrix, any finding ordered by severity, candidate single-owner repair, and explicit no-change receipt.

## Primary synthesis gate

Do not modify movement rules merely because the player reported clunkiness. Join A's exact observed step with B's source trace. If one owner is demonstrated, author a separate repair pack with changed files, saved-compatibility guard, targeted tests, and identical UI retry. If the current UI already gives clear cues, report that plus remaining feel/presentation gap without claiming it feels polished. Preserve the live user preview throughout.

## Receipts and decision

V46-A used one fresh isolated browser, Start new V29, then held W for 2,000 ms toward the north ledge. The avatar stopped at a clearly raised pale cliff with an upward arrow marker. The checked message was `The cliff needs a ladder. Follow the lower face to a marked ladder site.` Initial screenshot: `/private/tmp/wizard-v46a.qnTXwG/.playwright-cli/page-2026-10-10T07-28-14-285Z.png`. Blocked screenshot: `/private/tmp/wizard-v46a.qnTXwG/.playwright-cli/page-2026-10-10T07-30-43-331Z.png`. The persistent lower-left message was partly covered by the closed `First steps` guide. No centered cue was observed after the hold; a transient cue during the hold was not captured. Console had only favicon 404 and THREE.Clock deprecation, with no non-static requests. Sole browser closed, Vite stayed live. This is early smoke, not proof of every boundary.

V46-B traced the canonical north/side rock segments, connected river predicate, dry-terrain fascia, and Dig outline against checked authority. It found no source-proven opening-valley mesh/collision contradiction. It found a separate, known Dig affordance limitation: geometric outlined targets can still be protected, out of three-dimensional reach, tool/skill/capacity blocked, or unsafe in the checked action. The finite 2.048 km world's player-following underlay could visually extend beyond the legal edge, but this is not the near-spawn cliff and remains untested.

Decision: do not alter movement authority. V47 is a bounded presentation repair for the observed overlapping lasting cliff guidance, followed by an identical fresh UI retry. Geometric Dig validity, flexible route placement, freeform soil placement, broader visual hierarchy, and any far-world perimeter mismatch remain separate full-game work, not falsely closed by this repair.
