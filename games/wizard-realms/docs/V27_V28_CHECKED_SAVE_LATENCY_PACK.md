# Ticket pack: checked-save latency and movement continuity

## Observed failure and goal

In a fresh V27 browser journey, four rapid 250 ms backward inputs briefly filled the
16-step (800 ms) input queue while a checked save was running. Movement recovered,
but the interruption contributes to the player's reported clunky feel. A reproduced
in-memory `greenway-alpha` benchmark measured V27 inspect at 2.63 s, resume at
3.04 s, and a valid checkpoint at 5.38 s. Two successive checked reads had zero
validated-cache hits. The strict raw comparator returned false for exact detached
copies of real V26 and V27 roots because its 1 MiB ceiling is smaller than those
records. V28 profiling measured inspect at 2.63 s and a valid CAS at 6.89 s,
mostly in V28/V27/V26 checked reads and candidate root validation; the IDB write
itself was about 22 ms.

The target is uninterrupted normal running through automatic saves, not merely a
larger queue. Preserve strict tamper detection, exact checked replay, source-chain
checks, save compatibility, and bounded memory. Do not expose V28 as playable until
its routine action latency is acceptable and a real UI retry advances without a
queue-full warning.

## Acceptance and safety locks

1. Keep the old comparator's 1 MiB default for untouched callers. Add an explicit,
   finite per-version bound only where measured real roots require it. The limit
   must remain small enough for mobile memory; no unbounded cache, no JSON-only
   equality, and no change to descriptor, prototype, typed-array, cycle, or extra-key
   rejection. Each store keeps at most its existing single validated entry.
2. On actual generated V26/V27 roots, exact detached copies must produce cache hits
   after a first validated read. A one-byte change, extra field, forged typed-array
   brand, root mutation, and source change must miss or block as before. Oversize
   roots must fall back to full validation, not be accepted by a partial compare.
3. Re-measure V27 inspect, resume, checkpoint, and V28 inspect/action on the same
   fixture. State before/after timings and memory cost. If read caching alone leaves
   saves above the 800 ms input buffer, do not claim the stutter is fixed.
4. Any write-path optimization must derive the candidate from a validated prior
   proof and exact versioned witness, then independently verify the result and CAS
   against storage. Forged genesis, tampered ancestry, stale revision, invalid
   witness, and changed source must remain rejected. Do not weaken validation to
   hit a latency number.
5. Repeat the same fresh V27 browser movement sequence after repair on one isolated
   renderer. Confirm ladder/save/reload still pass, no queue-full warning, and no
   console/network regression. Keep the existing preview available to the user.

## Lane graph and ownership

`PERF-A` comparator/cache read repair runs independently of V28 RIVER-D action
integration. `PERF-B` write-path decision follows A and measured results. `PERF-Q`
independent source and one-renderer UI proof follows B or A if A alone meets the
acceptance bar. Main owns integration, measurements, and any replan. No lane edits
the V28 action/snapshot files owned by RIVER-D.

### PERF-A: strict bounded cache admission

Owner: `strictBoundedRaw.ts`, V26/V27/V28 atomic store callsites, and nearest focused
tests. First measure the comparator's estimated bytes for actual generated roots
and choose the smallest explicit cap that admits them within a documented mobile
memory ceiling. Preserve the default cap and all strict equality rules. Prove real
warm hits plus tamper and oversize fail-closed cases. No browser, GitHub, commit,
or unrelated persistence changes.

### PERF-B: remaining write latency

After A, profile phase timings and the input gate. If normal checked save is still
over 800 ms, identify the exact write-path owner and propose the smallest versioned
safe optimization. Implement only with explicit prior-root/witness/CAS equivalence
tests; otherwise return a measured replan. Do not increase queue length as a fake
fix or present slow V28 as ready.

### PERF-Q: independent proof

Review cache memory and tamper contract. Run focused historical save tests, typecheck,
build, then repeat the exact browser input sequence with one renderer and close it.
Report observed error | change | restart | retry result. No GitHub action.

## Status and constraints

This pack is a separate merge unit from V27 travel truth and V28 bridge mechanics.
It may exceed the usual tiny-diff budget only at the shared strict comparator and
its three participating stores. Do not modify any accepted save schema or witness.
The full Wizard RPG goal remains active after this performance milestone.
