# V138 movement-memory understanding

## Original Ask

The active full-game goal requires a long-playable Wizard Realms campaign. The user specifically warned about RAM, asked for one renderer, and wants quest progression, coin, XP, armor and drops that can be played rather than merely planned.

## Input PRD / Spec

`V136_EXPLORATION_MEMORY_INVESTIGATION_PACK.md` and the V137 quest probe are the current evidence. V136 saw a paced first-quest run peak at 727120 KiB and naturally recover. V137's organic run stopped at 872640 KiB renderer RSS before any log was chopped, with one post-movement JS heap sample of 149594 KiB and GPU peak 155872 KiB. No gameplay exception appeared. The source owner remains unproven.

## Aligned Problem Statement

Find which action phase and allocation stack causes excessive transient renderer memory on the short fresh movement route, then make only a measured bounded repair and repeat the identical protected UI entrypoint. Do not lower visual fidelity, checked save safety, or the guard to manufacture a pass.

## Goals

- Attribute the short route's peak to controller/checked state, render/scene, or mixed allocation with paired browser and no-Canvas evidence.
- Name the smallest actionable source owner with a measurable before/after acceptance, or state that ownership remains unresolved.
- Preserve the 5194 preview and one-renderer cap.

## Non-Goals

No new quest, schema migration, content removal, renderer-distance reduction, production deployment, PR, or GitHub action in the attribution pack. It cannot establish full long-session safety by itself.

## Constraints

One disposable 5195 browser, pre-render self-tested 50 ms RSS guard, 870400 KiB early stop, hard below 1024000 KiB. No second visual test while it is open. Read-only source/measurement lanes until the owner is known. Existing dirty changes are user-owned.

## Success Criteria

A paired trace contains exact action phases, renderer RSS, GPU RSS, JS heap and bounded allocation-stack evidence, plus a no-Canvas V36 runtime comparison of `advanceFrame`, `view`, and save with peak/settled memory. The decision receipt separates measured owner from speculation and either authorizes one small repair or declares the next discriminating measurement. Any repair must get an identical guarded UI retry.

## Open Questions

Does movement allocate through checked V36 frame replay and defensive view cloning, or through scene mesh reconstruction, or both? Does the peak recover after idle without the extra diagnostic load? What is the narrowest code owner that can reduce the observed peak while preserving output?

## Implementation Risks

Profiling itself can raise memory. Browser and Node results are not automatically comparable. A no-Canvas profile cannot prove WebGL behavior; a browser RSS peak alone cannot identify a JavaScript source. The guard stops the probe when unsafe, even if that limits the trace.

## System Translation Routing

`not_qualified`: this is a performance diagnosis inside one existing game engine. System Translation Receipt: `not_applicable`.
