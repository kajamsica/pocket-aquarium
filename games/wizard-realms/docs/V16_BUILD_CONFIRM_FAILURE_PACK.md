# V16 build confirmation failure pack

## Observed failure and outcome

Independent Grok Bot UI run T144, on the frozen v16 archive `89ac471f5ae520f6ab329c58bac8d180ec4d9dc85b0`, reached a Ready ladder at about 1.76 m with 4 logs and a Ready bridge at about 1.71 m with 8 logs. Neither showed Confirm, and F did nothing. Crossing, far-bank dig, and sale were therefore unreachable in that run. The same report observed repeated 2 to 5 second save pauses. It did successfully buy boots, toggle pace, and reload saved inventory/map state. This is an observed UI failure, not merely a design request. Current checkout has newer route guidance, but its control code still requires `preview.selected` for both Confirm and F.

Source correlation: `PublicV16WorldView.ts` fills `preview.nearby` and displays the nearest ready candidate, but only sets `preview.selected` when its aim angle is within 30 degrees. `WizardHud.tsx` can therefore say Ready from `nearby` while hiding Confirm, and `WizardSurface.tsx` maps F only from `selected`. `PublicV16Controller.tsx` rechecks the selected site under the checked writer. This mismatch is the primary narrow repair. The save latency is a separate hypothesis that needs timing evidence.

## Interface contract and tickets

- For v16 Greenway only, an eligible discovered work site within the authoritative interaction range must become the same selected site used by visible Ready status, ghost, Confirm, and F, even when the player's heading is marginally off it. Prefer a currently aimed eligible site; otherwise choose a stable nearest eligible candidate. If all candidates are unready, keep the current aimed blocked preview or nearest blocked guidance. Selection remains advisory; checked writer still re-evaluates ID, position, materials, and occupancy. Do not enable confirmation of an undiscovered or rejected site.
- Do not alter v14/v15, persisted work IDs, construction costs, support/collision, or save format. A candidate switch must be explicitly named in the UI so the player knows which structure F will build. Works mode must remain open across routine successful checkpoints.
- **Ticket A, ready selection:** own `PublicV16WorldView.ts` and focused tests; if necessary `WizardHud.tsx` and its focused test after the magic view worker has finished. A minimal `WizardMap.tsx` copy clarification is also authorized because the playtest confused the fixed centered starter ladder with off-center Works ladders. Reproduce the Ready-but-no-selected state in a focused test before the change, then make preview selection/Ready/Confirm/F refer to one candidate. Test both bridge and ladder, blocked and undiscovered cases, and a switch between adjacent sites.
- **Ticket B, save-pause diagnosis:** read only first. Inspect exact `PublicV16Controller.tsx` checkpoint cadence and time the 64-frame checked save on current source if feasible. Identify whether idle Works saves and/or threshold saves cause repeated barriers. Implement a bounded smallest repair only if evidence is clear, within `PublicV16Controller.tsx` plus focused tests, preserving crash-safe saves and the 128-frame cap. Do not disable all autosaves merely to keep input responsive. Report timing before/after and residual risk. If evidence is insufficient, return diagnosis without code.

## Retry and validation

Observed error | Ready site without Confirm, F no-op | change narrow projection/selection | restart only the affected local preview if needed (HMR may suffice) | identical retry: fresh disposable v16 build on an allowed UI surface or Grok's next frozen artifact | result: advanced, same error, new error, or passed | next action.

Run focused tests for projection/HUD/Surface/controller/authority and production build, then hand the exact new bundle to Grok for the ladder, creek, dig, sale, reload journey. The Grok report on the old hash cannot prove the new build. Local browser UI control was denied by policy in the prior turn; do not bypass it. Keep one renderer.

## Follow-up evidence

Grok T145 reviewed the T144 screenshots without another gameplay attempt. They show Works On, a nearby Ready message, no highlighted ghost or Confirm, and the player facing the store or open ground rather than the reported site. None of those particular failure frames shows a save pause, so selection mismatch is directly observed while save timing remains a separate uncertainty. A renderer-free real checked-writer timing probe took roughly 260 to 314 ms for 64-frame saves and 269 to 294 ms for one-frame saves with in-memory IndexedDB. It did not reproduce the reported 2 to 5 seconds in the browser. Ticket B therefore retained no cadence change and requires a browser-specific timing trace in the next UI run.

## Smallest viable diff

Reuse `preview.nearby`, `preview.selected`, `savedWorkKeyboardIntent`, and checked `publicV16WorkRouteForView`. Expected one production file for A, one for B if justified; no new state version, dependency, shared component, or broad visual rewrite. Tripwire: more than five production files or 300 changed lines per ticket requires a new contract.
