# V21 Mireglass route proof pack

## Goal

Prove that the material-driven bridge and ladder loop works in a second region of the connected world. Mireglass Reach already has multiple canonical route sites, checked Terrain Works, persisted structures, and traversal support. Reuse those before adding a new landform or changing saved world geometry.

## Scope lock

- Keep the pinned Mireglass terrain profile and existing V17 saves intact. Do not migrate, rewrite, or reset a save for this increment.
- Select one seed-stable Mireglass bridge and ladder. Validate their canonical IDs, material costs, preview, checked write, support geometry, and crossing in both directions.
- Expose only discovered and visible nearby sites in the V17 streamed view. A pointer aim may select a bounded canonical site ID, but must not invent geometry or confirm a build. Keep keyboard, heading, and touch alternatives.
- Show a clear unbuilt ghost, built structure, usable route, and reason when placement is rejected. Persist and restore both works without bypassing creek or cliff collision.
- Mireglass sites remain anchored to their existing 4 m grid. Greenway's 0.1 m placement freedom does not automatically apply here.
- Do not route Mireglass taps through Greenway's `saved-work.aim` X value. Its transient selection is a canonical site ID, revalidated against the bounded, discovered, matching-kind nearby candidate list before preview. Extend the streamed read model and presentation context without changing the existing checked action gate.

## Dependency order

1. Domain proof: canonical bridge and ladder, old-save load, checked cost and duplicate rejection, two-way traversals, diagonal/off-side bypass rejection.
2. Read-only view projection: discovered-only and fog-visible candidates through the V17 streamed Mireglass path.
3. Scene/HUD selection: tap or click the visible candidate to aim, retain orbit-drag and keyboard access, then confirm separately through the existing checked writer.
4. One hash-bound UI journey: reach each barrier, gather enough material, aim, build, cross, reload, and cross again. Keep one renderer.

## Stop and replan conditions

If a literal new creek or cliff or a change to canonical Mireglass geometry is needed, do not edit V17 in place. Introduce a versioned content/rules root with explicit migration from validated V17, a safe-pose plan for occupied footprints, rollback to the old database, and paired resolver, writer, movement, and projection tests. Multiplayer and arbitrary global building remain outside this pack.
