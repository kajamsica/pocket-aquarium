# V26 first-time valley exits, one-renderer playtest

## Why this is the next decision

The Dig and Fill repair passed an exact browser retry. That does not establish
the user's larger claim: walking should feel fluid, visible dry ground should
not hide an unexplained collision, and the river and cliff should make the
bridge and ladder solutions inferable from play. The code audit found a
generic V26 stop on >0.55 m floor changes that can occur outside the named
river and cliff gates. The bridge has UI crossing proof, but the cliff ladder
does not. This probe stops at the first decision-bearing failure and gathers
evidence for the smallest owner repair.

## Read-only tester contract

Use one isolated browser renderer with the running Vite preview at
`http://127.0.0.1:5193/?publicWorld=v26`. Start a fresh world from the UI,
without local-storage edits, console actions, controller calls, or source
patches. Do not rely on the existing tester's learned route unless the UI
itself communicates it. Walk with the game controls and record:

1. What appears reachable at the first attempted north, east, west, and river
   approaches, and the exact visible cue, if movement stops. In particular,
   capture a generic dry-slope stop separately from the river or cliff cue.
2. Can a new player infer how trees yield the 8 bridge logs and 4 ladder logs,
   and can they identify where each structure can be built? Do not count a
   coordinate in developer text as a natural affordance.
3. Can the bridge be built and crossed into a persistent far-bank area, with
   no prior scene disappearing? Can a ladder be built at the north cliff and
   climbed, with the shape and interaction reading as a ladder rather than a
   bridge?
4. Do boots from the store visibly and mechanically change travel pace? Are
   movement and camera controls stable during these steps?
5. On reload, do saved route works and player pose persist? Are any cues stale
   or misleading after progression?

At first blocker, capture screenshot, exact movement/action sequence, visible
status text, console and network errors, map coordinate if displayed, and
whether the stop is likely authority, projection, or scene geometry. Close the
browser renderer, leave the preview server running, and report `GO` or
`NO-GO` only for the observed path. Do not silently work around a failed
route with prior code knowledge.

## Acceptance and follow-up boundary

A successful path proves both built exits, store boots, contextual cues,
continuous discovery, and save/resume from a fresh first-time perspective. A
failure becomes a bounded observed-error repair: smallest responsible owner,
one affected-component restart, identical input retry. Two failed grounded
repairs or a changed authoritative movement rule trigger replanning into a
source-pinned V27 action/root rather than editing V26 replay facts in place.
No PR, push, commit, or GitHub action is authorized by this probe.
