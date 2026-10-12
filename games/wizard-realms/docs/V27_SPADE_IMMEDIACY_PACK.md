# V27 spade immediacy ticket pack

## Outcome and scope

Equipping the field spade immediately makes a primary click on eligible revealed ground a Dig action. The existing hover outline must remain the visual invitation and the checked writer remains the only authority. Fill stays an explicit alternate mode. Unequipping the spade removes click-to-dig without touching terrain. This is a UI contract, not a new terrain or save schema.

## Interface and ownership

- Owner: `engine/src/view/WizardSurface.tsx` and its focused tests only.
- V27 and V26 both retain the existing `v26.terrain` intent and checked action path. The old V26 route must not lose its Dig/Fill buttons or tested click behavior.
- An initial spade-equipped projection defaults to Dig. When the main-hand item changes from something else to the field spade, select Dig, even if Fill was selected on a prior equipment cycle. While the spade remains equipped, explicit Fill and Off choices persist through ordinary projection renders.
- Never dispatch from a drag, secondary click, map, store, saved-work mode, unavailable writer, unrevealed ground, or an invalid picker result. Existing `pointerV26TerrainTapIntent` is the gate.
- Keep terrain target outline in `WizardScene` driven by the equipped spade. No renderer edits or extra browser tab for this lane.
- Preserve non-V26 controls and historical tests. Update the compact hint to make the auto-Dig state clear.

## Proof

Focused tests cover an initially equipped spade, equip transition, Fill override, unequip/re-equip, and old pointer guards. Run the WizardSurface focused test and TypeScript. Report touched paths, diff size, test results, and any tripwire. No GitHub or browser action.

## Tripwires

Stop and report if the projection lacks a reliable main-hand item signal or the fix requires rewriting the 3D picker, changing a saved action schema, or editing the V27 integration owner's controller/entry files.
