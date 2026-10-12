# Ticket Pack: V40 South creek deck crossing and same-tab reload

## Summary

V38-R2 real UI proved eight-log South creek Bridge discovery, Ready preview, checked saved build, XP/log spend, and visible wooden deck. It stopped before physical traversal or reload. This read-only acceptance pack asks whether a player can actually walk over the saved deck into continuous far-bank terrain and whether a normal same-tab reload restores it. The standing full-game goal remains active.

## Fixed interface

Entry `http://127.0.0.1:5193/?publicWorld=v29`, branch `ben/wizard-playable-v2`, one isolated browser renderer. Use ordinary visible UI only. Reproduce the now-known fresh route: Start new, equip axe, chop two nearby oaks twice each, Works Bridge, follow the new south-creek cue, select Nearest, move until Ready, Confirm. Then approach and walk the visible deck. Stop at one far-bank success or first reproducible blocked movement. If crossing succeeds, Save now or use the existing acknowledged save, reload the **same tab within the same browser profile**, Resume, and confirm bridge and player location persist. Close browser after receipt. No state injection, source coordinates, direct action calls, second renderer, code/Git writes, or profile teardown before reload.

## Evidence and lane graph

One UI reviewer lane is sufficient. Source already explains checked site/bridge support and IndexedDB saves, and a second source lane would add no decision-bearing information before UI. Primary synthesis follows the receipt. Maximum productive width one due one renderer. Existing V38-R2 screenshots are baseline; new output must include saved deck, crossing or first obstacle cue, and post-reload if reached, plus exact visible inputs, console/network, browser-closed confirmation.

Unknown and closure: can a player traverse the deck and retain it on same-tab reload? The first exact blocking cue or far-bank/reload observation decides. Surprise: a saved deck visually exists but movement rejects it, or Resume loses it in the same browser profile. A misaligned manual approach is not automatically an authority defect; capture camera/player/deck relation and one bounded correction before stopping. Do not coordinate-hunt beyond a short novice attempt.

## Smallest viable diff

No production/test changes authorized by this pack. Only this evidence doc may be amended. A reproducible failure triggers a separate repair contract after exact owner identification. Preserve the checked bridge geometry and save schema unless a concrete contradiction proves they own the failure. Validation is a real UI traversal and same-tab reload if possible. The browser remains visible to the tester only; Vite preview remains available to the user throughout.

## V40-A reviewer ticket

Read applicable auto-planner-ticket-pack, smallest-viable-diff, test-from-ui, and Playwright skills completely, then this pack and V38-R2 receipt. Role lock: read-only UI reviewer. Worktree `/private/tmp/pa-wizard-playable-v2`; preserve dirty files. Fresh isolated session, single renderer. Follow the exact fixed interface and stop at one decision-bearing obstacle or saved far-bank plus same-tab reload. Return `observed error | change none | restart reload only if healthy | result | next action`, screenshots, console/network and browser-closed receipt. Transport native continued recently capable `/root/v26_first_loop_probe`, inherited model, no durable task, no Cursor, no nested worker.

## Status

V40-A rebuilt a saved creek deck in a fresh ordinary UI run. The player approached from the dry near bank, entered the deck, and advanced without movement rejection to approximately x -0.1, z 10.2, still on the visibly supported span. Screenshots: saved deck `/private/tmp/wizard-v40a.iBH9Xi/.playwright-cli/page-2026-10-10T06-25-41-076Z.png`; on deck `/private/tmp/wizard-v40a.iBH9Xi/.playwright-cli/page-2026-10-10T06-30-21-495Z.png`; near far end `/private/tmp/wizard-v40a.iBH9Xi/.playwright-cli/page-2026-10-10T06-31-13-375Z.png`. The map changed to a far-bank instruction near z 10.2, which may be early while the avatar is still on the deck. At the primary agent's stop instruction, the reviewer closed the browser before the final step off to dry far-bank ground or same-tab reload. Those two requirements remain **untested**, not passed or failed. Console contained only favicon 404 and Three.js Clock deprecation; no non-static requests. No files/Git/storage changed by reviewer, single renderer closed.

Observed error | change | restart | retry result: none on the saved creek deck | none | none | advanced across most of the supported span without rejection | next action: in one later UI run, allow the final far-bank step and same-tab reload before teardown. Do not claim complete river traversal or persistence from this partial probe.

## V40-R completion retry

The previous run was stopped by the primary agent too early, not by a product blocker. Repeat the same fresh, ordinary visible-control route now that V42's code/test/build has stabilized. Do **not** stop merely because the avatar is on the deck or the map starts to say “far bank.” The acceptance point is a visible dry-ground step beyond the deck, followed by a same-tab reload in the **same still-open browser profile**, Resume, and visible restoration of the built deck/player region. If the final step or reload fails, stop at that exact failure. One or two bounded approach corrections are permitted, not prolonged steering. Close the one renderer after the final receipt. No source coordinates, storage manipulation, code edits, or Git writes. Existing `SURFACE_READY` preview at port 5193 remains available throughout.

## V40-R acceptance receipt

PASS. A fresh V29 visible-controls journey collected eight logs, followed the South creek cue, used Nearest and Ready, and saved the bridge for eight logs and 80 XP. Two short lateral corrections aligned the avatar with the deck lane; W crossed the full wooden deck without rejection and continued onto unmistakable dry far-bank grass. The visible map read x 0.1, z 14.2, elevation 1.2 m, saved works 1 bridge. Far-bank screenshot: `/private/tmp/wizard-v40r.9dzy9x/.playwright-cli/page-2026-10-10T06-54-40-668Z.png`.

In the same tab and same browser profile, reload showed `Validated V29 save #15 is ready` and `Resume V29 world`. Clicking Resume restored the avatar on the same far bank, with the wooden bridge behind, map x 0.1/z 14.2 and saved works 1 bridge. Post-resume screenshot: `/private/tmp/wizard-v40r.9dzy9x/.playwright-cli/page-2026-10-10T06-57-34-927Z.png`. After reload there were zero console errors and one Three.js Clock deprecation warning; requests were static only. The sole isolated browser was closed and the Vite preview left live. No code, Git, or storage state was edited by the reviewer.

Observed error | change | restart | retry result: prior test stopped too early, not a product error | no game change | fresh UI run, then same-tab reload after crossing | passed full far-bank traversal and saved restore | next action: address independent blocked-cue UX and spatial dig/rescue acceptance, not bridge authority.
