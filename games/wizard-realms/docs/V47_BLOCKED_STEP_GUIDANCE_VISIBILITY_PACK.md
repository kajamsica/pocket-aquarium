# V47 blocked-step guidance visibility repair

## Summary and observed error

Fresh V29 UI, Start new, hold W 2,000 ms toward the obvious north cliff: checked movement correctly rejects with `The cliff needs a ladder. Follow the lower face to a marked ladder site.` The screenshot `/private/tmp/wizard-v46a.qnTXwG/.playwright-cli/page-2026-10-10T07-30-43-331Z.png` shows the persistent event text partially hidden behind the closed `First steps` guide at the lower left. No centered cue was observed after the hold; whether it appeared transiently during the hold is unproven. The immediate repair is to keep the lasting event text visibly clear of the guide on the desktop V29 surface. Do not alter the checked cliff, river, ladder, movement, or save rules.

## Locked interface and repo truth

- Worktree `/private/tmp/pa-wizard-playable-v2`, branch `ben/wizard-playable-v2`, broad dirty/untracked state. Preserve it. No commits, push, or PR.
- Preview `http://127.0.0.1:5193/?publicWorld=v29` remains live. Only one isolated browser renderer for the final retry; close it after proof.
- `PublicV23Controller.tsx` renders the closed `v25-start-guide` at desktop left 166px, bottom 16px, width 280px. `WizardSurface.tsx` renders `.wr-events` at desktop left 186px, bottom 18px, width 340px, so their rectangles overlap. `WizardSurface.test.ts` already asserts CSS/markup conventions.
- V46 source trace found the cliff mesh and collision share canonical geometry. This repair is presentation-only. V46 browser did not prove all other boundaries are clear.

## Topology audit: PASS

Two independent implementer lanes are safe after V46's browser closed: A owns only `WizardSurface.tsx` style rule, B owns only `WizardSurface.test.ts` static style regression. C integrates and validates both. D runs the identical fresh-start W-cliff browser retry after C. No browser while A/B edit. No new files beyond this pack, no dependency/schema changes. A/B are independent and both required for C. D depends on C. Conditional repair is not preauthorized; if CSS cannot avoid the overlap without broader layout changes, return to Planner mode.

## Smallest Viable Diff

Behavior delta: at desktop V29, with the `First steps` guide visible, the persistent `.wr-events` guidance no longer shares its lower-left rectangle, including when the guide is expanded. Keep mobile and older versions unchanged. Expected diff budget: 2 existing source/test files, under 20 net lines, zero new runtime files, zero dependencies. Reuse scan: existing desktop `.wr-events`, guide desktop media rule, `data-public-version`, `details[open]`, existing CSS assertion tests. Prompt/config alternative is insufficient because the issue is rendered CSS overlap. Deletion/simplification: replace a conflicting position with a version-scoped rule, do not add a new overlay or state. Forbidden: controller timing, authoritative movement, route geometry, save, terrain, package files, broad HUD redesign. Tripwire: any third source/test file, mobile layout shift, or new component requires replan. Acceptance: `npx vitest run src/view/WizardSurface.test.ts` from engine, `npx tsc -b --pretty false`, `npm run build`, whitespace check, and identical UI screenshot.

## A: CSS implementer

Role lock: implementation only. Dispatch transport: native_spawned_subagent, continued child session allowed. Model: inherited. Cursor runtime: not_applicable. Existing-task routing, capability/mission evidence, coordination scope, custody, status, delivery policy, task/thread receipt: not_applicable. No-interruption disposition: no unrelated task contacted. Agent spec: auto-planner implementer plus smallest-viable-diff. Session policy: initialize_once_then_continue. Worker agent: native child. Final fallback transport: none; fallback conditions/CLI/model/actions: not_applicable. Runtime rationale: one narrow CSS correction with known owner and visual proof. First contact must read applicable skills and this pack.

Own only `games/wizard-realms/engine/src/view/WizardSurface.tsx`. Add one V29-only rule inside an `@media(min-width:901px) and (min-height:591px)` block: `.wr-events{left:290px;bottom:270px;max-width:340px}`. This puts its bottom 14px above the expanded guide's possible top (`bottom:16px` plus `max-height:240px`) and to the right of the 260px backpack. Preserve existing mobile breakpoint and other versions. Do not edit tests, render a browser, or touch Git. Receipt: exact CSS rule, changed lines, reuse/deletion proof, diff check, no out-of-scope files.

## B: independent test implementer

Role lock: test only. Dispatch transport: native_spawned_subagent, continued child session allowed. Model: inherited. Cursor runtime: not_applicable. Existing-task routing, capability/mission evidence, coordination scope, custody, status, delivery policy, task/thread receipt: not_applicable. No-interruption disposition: no unrelated task contacted. Agent spec: auto-planner independent test plus smallest-viable-diff. Session policy: initialize_once_then_continue. Worker agent: native child. Final fallback transport: none; fallback conditions/CLI/model/actions: not_applicable. Runtime rationale: existing static render/style test can check this exact CSS contract without a new harness. First contact must read applicable skills and this pack.

Own only `games/wizard-realms/engine/src/view/WizardSurface.test.ts`. Add a small regression asserting the exact V29-only desktop rule `@media(min-width:901px) and (min-height:591px){[data-public-version=v29] .wr-events{left:290px;bottom:270px;max-width:340px}}` appears in the rendered surface style. Assert the existing mobile `.wr-events{top:252px;left:8px;...}` rule remains. Keep it narrowly style-specific; do not add a browser harness. No production edit/browser/Git write. The test may start red before A lands. Receipt: exact test, focused test output, scope and diff check.

## C: integration reviewer

Role lock: review and validation only, no edits. Native child inherited model, no fallback. After A+B receipts, examine the combined diff for version scoping, CSS precedence and event visibility. Run focused test, TypeScript, build, whitespace check. Findings-first receipt with GO/NO-GO, exact commands/output and residual risk. No browser.

## D: UI final proof

Role lock: read-only browser tester. Native child inherited model, no fallback. After C GO, in a fresh isolated single-renderer browser start new at the same URL, hold W 2,000 ms into the north cliff, capture the visible lasting instruction and guide together. Inspect console/network; close isolated browser, leave Vite running. This must distinguish event-log legibility from the transient centered cue. Pass only if the persistent instruction is not overlapped and no new blocking UI/runtime error appears. No source/Git edit.

## Integrated receipt

A added one V29 desktop-only CSS rule to `WizardSurface.tsx`; B added eight lines of exact-rule/mobile-preservation regression in `WizardSurface.test.ts`. C reviewed specificity, expanded-guide clearance of at least 14px, backpack clearance, and older/mobile scope, and returned GO. `npx vitest run src/view/WizardSurface.test.ts` passed 77/77, TypeScript passed, build passed with only the existing nonfatal large-chunk warning, and scoped whitespace check passed. No authority, route, save, schema, or dependency changed.

D repeated the exact fresh Start then W held 2,000 ms into the north cliff. Screenshot `/private/tmp/wizard-v47d.lWMkzJ/.playwright-cli/page-2026-10-10T07-42-14-731Z.png` shows the lasting checked cliff instruction at mid-left with clear vertical separation from the closed `First steps` guide. DOM snapshot contained both separately. Console showed only favicon 404 and THREE.Clock deprecation; static requests only. One isolated renderer closed, Vite remains live. Verdict PASS for the observed persistent-guidance overlap, not for every invisible boundary or the transient centered-cue timing. The exact no-change-to-authority condition held. V48 Dig/Fill UI journey is next.
