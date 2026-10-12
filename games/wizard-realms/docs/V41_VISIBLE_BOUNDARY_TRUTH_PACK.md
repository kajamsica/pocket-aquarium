# Ticket Pack: V41 visible boundary truth audit

## Summary

The player reports that some visible land stops movement without a clear reason. The target is continuous exploration: if a location is visible and ordinary ground, the player should reach it; a river or cliff may block, but the obstacle should be visually legible and immediately explain its bridge or ladder route. This pack is a read-only source audit that runs beside V40's sole UI renderer. It is not permission to broaden the map, change collision, or alter discovery opacity.

## Fixed interface and output

Inspect only current `games/wizard-realms/engine/src` on `/private/tmp/pa-wizard-playable-v2`, branch `ben/wizard-playable-v2`. Trace V29's rendered terrain/fog extent, finite world bound, discovery reveal, blocked movement cause, and display of temporary obstacle cues for river, cliff, side rock return, unsupported ground and world edge. Identify whether any *source-proven* state renders apparently walkable ground outside valid movement or emits the generic unsupported-route cue for a specific obstacle. Distinguish source-proven contradictions from UI-untested presentation. Return exact file/function/line refs and one smallest prospective owner if concrete. No code/browser/Git writes.

## Lane graph and certainty

One read-only source reviewer lane V41-A is independent of V40-A's real deck traversal and uses no renderer. Primary synthesis waits for both only if a shared repair is proposed. V41-A stops at a decision-sufficient trace, not a broad visual redesign. Surprise: terrain render extends past movement authority, or a checked rejection has no human-visible explanation. No productive test lane before a concrete failure contract. Maximum safe concurrent width across active work is two, with only V40-A using the browser.

## Smallest viable diff

Zero production/test changes in this pack. A grounded later repair should reuse existing renderer and blocked-step cue path and preserve saved route/movement authority. World size or schema changes require separate migration planning. Do not add a vague signpost or rewrite the starter valley on source speculation. `git diff --check` is not relevant to a read-only lane.

## V41-A reviewer ticket

Read applicable auto-planner-ticket-pack and smallest-viable-diff skills completely, then this pack. Role lock: reviewer only. Trace rendered-vs-reachable V29 world and all obstacle-cue branches, including display timing. Report exact evidence, potential specific visual-truth contradiction, and one smallest bounded repair candidate if warranted. Do not open a browser, run a renderer, modify files, commit, push, or send source hints to V40-A. Transport native continued recently capable `/root/truth_blocked_cues`, inherited model, no durable task/Cursor/nested worker. Receipt required.

## Status

Ready to dispatch beside V40-A.
