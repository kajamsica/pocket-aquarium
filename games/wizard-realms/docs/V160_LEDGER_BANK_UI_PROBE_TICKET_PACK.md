# Ticket Pack: V160 Ledger bank UI probe

## Summary and topology

Run one `early_smoke` browser journey of Outfitters' Ledger, from the existing DEV boots-equipped profile to the connected-river Ready bank and, if safely reachable, build and cross. The player preview stays available. This pack changes no game source or save contract and requests no PR.

Only one productive lane is safe: the user asked for one game renderer, and a second browser worker would contend for the same profile and memory budget. An independent code reviewer before any observed block would be artificial parallelism. The primary planner reviews the receipt and, only if warranted, issues a separate narrow repair pack. Dispatch verdict: **PASS at width one**.

## Interfaces and smallest viable diff

- Entry: `http://127.0.0.1:5195/?publicWorld=v36`, same origin as the dedicated DEV tester profile. Port 5194 remains the player surface.
- Input: visible Continue, game movement/map/Works controls, currently saved boots and quest state. No direct action calls, IndexedDB writes, save fixture injection, coordinate teleport, or game-source evaluation.
- Output: screenshots and one external event trace under a new `/private/tmp/v160-ledger-ui-*` directory, plus a findings-first receipt. No repository file edits from the worker.
- Expected source diff: zero production, zero tests, zero dependencies. An external harness may be reused from V157/V158 if already available, but never import or mutate game logic. Tripwire: any proposed game edit or new browser renderer requires replanning.

## Ticket V160-A: browser journey reviewer

Role `reviewer` ONLY. Transport `native_spawned_subagent`, inherited model, no Cursor, no durable task, no nested agent. Required skills: `test-from-ui`, `playwright`; read both fully and the generic UI reference before acting. This is a validation lane, not an implementation lane. Existing-task routing and provider fallback are not authorized. The primary owner integrates the result.

1. Confirm `npx`, ports 5194 and 5195 HTTP 200, system memory headroom, the dedicated profile exists and is not open, and no owned game renderer remains. Do not close unrelated browser processes or user tabs.
2. Self-test an independent exact-PID Chrome renderer RSS guard before navigation. Sample at nominal 50 ms. Early stop at 870,400 KiB, hard ceiling 1,024,000 KiB. Keep the browser profile as the dedicated reusable tester state. Preserve the authentic profile entirely.
3. Open one isolated browser at 1280 by 720. Use visible Continue. Capture entry screenshot and text: quest stage, logs, gear, current map, guide, save revision if shown. Do not assume V157's last unsaved movement persisted.
4. From visible cues and map, follow the saved upper-shelf/west-return/dry-bank route in short key holds. Inspect after each meaningful turn or blocked step; do not blindly hold movement into a wall. Close optional panels if they obscure movement. Use Works only at a visibly marked Ready site. If reached safely, build the connected-river bridge and cross the saved deck. Claim Ledger only if the visible route and RAM headroom permit. Stop at the first decision-bearing product block or guard.
5. At entry, upper shelf, descent, bank, build/cross or stop, record exact visible state, screenshot, renderer/GPU RSS and browser JS heap. If a WebGL resource counter is available from the already external V158 probe, capture live buffer/VAO/texture/program counts without changing game source; otherwise mark unavailable. Capture console errors and failed network requests.
6. On a product blocker, preserve URL/profile/input sequence, and return the exact error/cue with source-agnostic evidence. Do not repair. On guard, close immediately and classify as safety stop. Close only owned browser and guard, prove no owned PIDs remain, and verify port 5194 remains HTTP 200.

Return `observed error | change: none | restart: none | retry result: not attempted | next action`, or a passed journey with screenshots and quest state. Distinguish observed route failure, renderer guard, and incomplete proof. Report exact commands, artifacts, profile/preview isolation, peak memory and cleanup. Do not claim the full Ledger quest or production RAM is proven if only the bank is reached.

## Primary owner decision

If the journey reaches Ready, continue toward the first-region claim in a later guarded proof. If a small reproducible route or cue owner appears, write one repair ticket and use the identical journey as retry. If the guard fires first, do not guess at the game owner: compare phase-local JS heap and live scene resource counts against the exact save cadence, then choose one bounded memory discriminator. Keep the full-game goal active.

## Receipt and decision

The guarded UI journey loaded checked save #195 with eight logs, equipped leather boots, one saved ladder and the Ledger quest. Short normal-control movement traversed revealed upper ground and forest. The normal north-up map grid was visible; no Ready marker, obstacle cue or Works site appeared before the safety stop. During the final short forward step, the exact-PID guard stopped the sole game renderer at 883,536 KiB, above its 870,400 KiB early threshold and below the 1,024,000 KiB hard ceiling. The last visible browser JS heap was 315,922,787 bytes, versus 66,071,054 at Continue. Live instrumented WebGL buffers, textures and programs stayed near 247, 7 and 21 throughout; these are counts, not bytes. A prior map opening saw heap fall from roughly 221 MB to 118 MB, consistent with transient allocation or collection, not proof of a retained leak.

This is a **RAM safety stop**, not a reproduced river-route defect. The Ready bank, bridge build, crossing and Ledger claim remain unproven. The reviewer made no source/profile/GitHub edits, closed only its owned browser and guard, verified those PIDs absent, and left 5194 and 5195 HTTP 200. Evidence: `/private/tmp/v160-ledger-ui-NruZ6d/event-trace.md` and screenshots there, especially `entry-map.png` and `green-descent4.png`. The profile remains the reusable dedicated tester state.

Decision: no blind route or renderer fix. Next discriminate which browser allocation stacks dominate a short movement/checkpoint interval under the identical guard, and compare those stacks with source-only ownership. Do not lower the cap or assume fake IndexedDB's Node retention is the browser cause.
