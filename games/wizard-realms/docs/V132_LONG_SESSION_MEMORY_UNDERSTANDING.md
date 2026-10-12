# Wizard Realms V132: long-session V35 memory understanding

## Original Ask

The durable goal is a complete, sustained third-person wizard RPG. The user has also asked that testing use one renderer, watch RAM, close unnecessary tabs, and give the tester a fast development setup with boots. V131 completed the second quest, but a likely game renderer was observed near 1.34 GiB late in its long browser journey. A short later fixture was much lower. The full-game performance gate remains unresolved.

## Input PRD / Spec

The active full-game goal, V127 through V129 memory receipts, V131 validation receipt, and the user's one-renderer/RAM instructions are the supporting contract. V127 identified transient renderer allocation during checked saves. V128 and V129 reduced one redundant clone and one repeat decode but did not prove a sustained-memory improvement. V131's 1.34 GiB reading lacks exact tab attribution and a same-profile repeat.

## Aligned Problem Statement

Before another speculative performance edit, measure a repeatable V35 movement/save/idle/reload loop in one owned browser renderer and compare the same process across phases. Independently map V35-only runtime projection and checked-save owners so the measurement can distinguish retained application state, transient JS/native allocation, GPU turnover, or uncertain process attribution. Preserve the existing user preview and game graphics. This is a diagnostic milestone, not a lower visual-quality setting or a substitute for full-game development.

## Goals

- Reuse the existing isolated V35 test origin on port 5195 and the last visual tester's checked disposable fixture recipe. Give it owned/equipped boots so traversal is efficient. Do not touch the user's 5194 browser save.
- Drive movement through the visible game UI in one tab. Capture settled baseline, first out-and-back, second identical out-and-back, idle, and same-tab reload. Use an exact owned renderer PID if the browser transport exposes it; otherwise identify the process-attribution limit explicitly.
- Record RSS, JS heap and separate GPU process where available, plus scene resource counts only if already exposed safely. Arm the prior early safety stop at 870,400 KiB RSS and hard stop before 1,024,000 KiB for an attributed game renderer. Stop on a suspected over-cap process if attribution is weaker.
- Compare current V35 projection/save code with prior V127 through V129 source evidence and name the smallest observed owner for any growth. Do not infer a leak from one peak or claim an under-1 GiB pass from a short fixture.

## Non-Goals

No production code, tests, config, save-schema, graphics, dev-server, browser-infrastructure, Git, GitHub, or PR change in this diagnostic pack. No authentic user profile read/write. No new alternative app identity or port. No claim that the full game is complete.

## Constraints

- Current checkout `/private/tmp/pa-wizard-playable-v2` on `ben/wizard-playable-v2` has hundreds of pre-existing dirty files. Preserve them.
- Port 5194 user preview and port 5195 isolated V35 test server are both HTTP 200 at intake. Leave 5194 available. Test browser is closed at intake.
- One owned browser tab/renderer for the empirical lane, close it afterward. Source audit opens no browser. Keep screenshots and metrics private and avoid raw save export.
- The checked V35 visual fixture is test setup, not a second complete quest journey. Prove that the UI resumed a valid V35 save before measuring movement. If the fixture is unavailable or invalid, report an environment/setup blocker after one bounded confirmation; do not invent infrastructure.

## Success Criteria

1. A same-session, phase-labeled measurement includes an actual UI-controlled movement and visible checked save, with exact process ownership where possible or an explicit attribution limit.
2. The result says whether RSS and used JS heap stabilize, recover, or grow across the two matched traversals and reload, and whether any safety stop fired.
3. A separate V35 source map identifies per-frame and save/reload allocation/retention candidates with path/line evidence, without guessing magnitude.
4. The combined decision either closes this bounded concern at the measured scope, names one causal repair owner and its required proof, or preserves the uncertainty. It never upgrades a short run to long-session release proof.

## Open Questions

- Can the existing browser transport bind the V35 tab to one exact renderer PID without changing app infrastructure?
- Was the late V131 high RSS transient allocation, retained game state, GPU/native residency, or another Chrome renderer?
- Does the checked test fixture support a repeatable unobstructed short route with the same player position and direction on each loop?

## Implementation Risks

- A movement route can be blocked by trees, cliffs or water. The tester must record actual position delta and reject a no-op as performance proof.
- HMR or a second browser would invalidate same-PID comparison and may disturb the checked save. Do not edit source while the empirical lane runs.
- The safety cap is an early stop for the user's machine, not an instruction to degrade graphics or weaken validation.

## System Translation Routing

`not_qualified`: this is a diagnostic of the existing TypeScript/WebGL game, not a whole-system translation. Receipt: `not_applicable`. Product agent runtime: `not_required`; the shipped game behavior under test is deterministic. The current durable goal is already aligned and remains active.
