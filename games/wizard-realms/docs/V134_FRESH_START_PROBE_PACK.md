# Ticket Pack: V134 Fresh-Start UI Probe

## Summary

Run one early, isolated real-browser journey from empty storage through the current Wizard Realms entrypoint. The result decides the next production change; this probe itself changes no game code. Aligned understanding: `V134_FRESH_START_UNDERSTANDING.md`.

Locked design: preserve the 5194 user save, preserve historical checked roots, use one renderer, do not seed storage or claim an organic quest pass from a fixture. Important repo truth: V36 entry source requires V35, which itself requires V34, while V33 exposes New Game.

Delivery phase: `user_flow_probe`. Delivery milestone: `pre_surface`; existing 5194 V36 is already a limited preview, not a fresh-start-ready surface. Shortest complete user flow: load current V36 URL from an empty profile and attempt to start a new adventure through visible choices. First-feedback evidence: screenshot of earliest missing or working choice, URL/action trace, console/network. Test-writing policy: `prohibited_until_pr_hardening`. Review blocking class: fresh-start blocker. Validation environment: existing isolated 5195 server. Environment repair authority: none; one bounded confirmation retry if setup fails. Surface availability: 5194 stays untouched. Optional-feedback wait: never.

## Lane Graph

```mermaid
flowchart LR
  P["P1 Empty-profile visible journey"] --> D["D Planner blocker classification"]
```

## Topology Audit

This is the explicitly bounded `user_flow_probe` exemption from the substantive non-linear productive-work invariant. It has one read-only browser lane because a second renderer is forbidden and source inspection already predicts the likely branch. P1 closes the empirical unknown: what a new player actually sees and can do at the current entrypoint. Stop at the first decision-bearing blocker. If the browser unexpectedly allows a fresh V36 start, that surprise triggers a deeper organic journey; otherwise D plans the smallest safe fresh-start repair. There is no artificial second lane and no implementation dispatch before the result. Dispatch verdict: PASS for a user-flow probe only.

## Tickets

Paste now to: UI Reviewer
Ticket: V134-P1
Lane role: `reviewer` ONLY. Read `auto-planner-ticket-pack`, `test-from-ui` and its generic reference, and `playwright` completely. Dispatch transport: `native_spawned_subagent`, inherited model, local runtime, no fallback. Existing-task routing: not_authorized for durable tasks; a completed ephemeral UI tester with current Wizard capability may be reused if safe, otherwise spawn fresh. No interruption or overlapping ownership. One renderer only.

Use a fresh disposable browser profile at `http://127.0.0.1:5195/?publicWorld=v36`, viewport 390 by 844. Begin with no Wizard IndexedDB/local storage. Record the first visible V36 state, then follow only its offered link(s) until the first actual New Game choice appears; do not create a save if the missing current-version choice is already established, unless one click is needed to disambiguate. Do not seed storage, call domain code to bypass UI, touch 5194, modify files, or start a second browser. Start the RSS guard before game rendering, stop at 870400 KiB candidate page RSS and hard stop before 1024000 KiB. Capture screenshots, console errors, failed requests, exact URL/action trace, process peak, and close browser/guard. Return `pass | product_blocker | environment_blocked`, exact earliest blocker and probable owner, plus what remains unproven. Transport receipt must include child ID, inherited model, no fallback and completed session.

## Assumptions

The 5195 server remains reachable. This probe is intentionally narrower than the full fresh-player Old Marker quest journey. It neither creates a PR nor decides the implementation contract before seeing the UI.
