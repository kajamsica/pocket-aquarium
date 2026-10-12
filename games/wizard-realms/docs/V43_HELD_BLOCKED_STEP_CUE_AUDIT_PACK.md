# Ticket Pack: V43 held blocked-step cue lifecycle audit

## Summary

The player reports that movement can simply stop. V41 found specific terrain messages, now restored in V42, but also a possible presentation defect: the HUD obstacle cue expires after 3.5 seconds while repeated identical blocked movement is suppressed. This pack only audits whether sustained W against the same obstacle leaves the screen silent and identifies the smallest truthful remedy. It runs without a renderer while V40-R owns the one browser.

## Interface and lane

Read current `games/wizard-realms/engine/src/PublicV23Controller.tsx` and related tests. Trace exact first rejected move, duplicate rejection, cue timer expiry, clear/reset behavior, and whether there is any persistent other source of the explanation. Distinguish source-proven silence from UI-unobserved risk. Recommend the smallest presentation-only change, preserving log spam suppression, movement authority, and V23-V29 version compatibility. One read-only reviewer lane; primary synthesis afterward. No source/test edit, browser, Git write, or deployment. Worktree `/private/tmp/pa-wizard-playable-v2`, branch `ben/wizard-playable-v2`. Transport native continued `/root/truth_blocked_cues`, inherited model, no durable task/Cursor/nested workers. Read applicable auto-planner-ticket-pack and smallest-viable-diff skills completely, then this pack. Return exact file/function/line references and decision-sufficient receipt.

No productive test/code lane is justified before this audit. V40-R browser remains isolated and must not receive HMR. If source confirms a bug, a separate bounded repair pack and independent regression is required after V40-R closes. Expected production diff now zero. Do not change cue duration or add persistent overlays speculatively.

## Status

Ready to dispatch beside V40-R.
