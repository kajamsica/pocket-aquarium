# Ticket Pack: Recover the first-session store journey

## Observed failure

Independent Grok Bot playtested commit `6b1eef4` on its own fresh `127.0.0.1:4181` origin. After learning Wayfinder Glow and revealing fog, the next step said "Buy a field spade from Greenway Outfitters" with no bearing or distance. The local map displayed two `S` markers, and the tester reached the wrong shop, Highland Arcanum. They stopped at x -7.2, z 8.3 after searching. This is a real first-session blocker. Earlier waystone guidance already demonstrates a directional wording pattern in `App.tsx`.

## Smallest repair and interface

Owner: `engine/src/App.tsx` and `engine/src/App.test.ts` only. Reuse `objectiveFor` and the authoritative `state.stores` positions. Add a small store guidance helper that identifies Greenway Outfitters by its stable store identity, gives bearing plus rounded distance while out of reach, and states the appropriate action when in reach. Apply it to the field-spade step and other current Greenway Outfitters objectives that can send a new player back there, such as axe purchase and relic sale. Do not change store reach, prices, inventory, map fog, world generation, or persistence. Keep the text short enough for the collapsed Next banner where possible; banner layout is a separate issue.

## Proof

- `objectiveFor` names the correct store and gives a cardinal bearing with distance from a player outside reach. The guidance updates as the player moves and changes to a local action once they arrive.
- Greenway Outfitters and Highland Arcanum remain distinct even when the latter is nearer.
- Existing waystone, gathering, route, and store assertions continue to pass.
- Focused Vitest, low-RAM full suite, typecheck, build, diff check, and the same first-session UI step are the integration gate. Grok will be asked to retry the exact step from a fresh build after a verified commit is pushed. The earlier report's oak priority and clipped text remain separately recorded, not silently claimed fixed.

## Dispatch

One bounded implementer lane WZ-G2-STORE-A. Model routing: planner-selected live native `gpt-6.1-sol`, required repository access, tests, and no browser or GitHub write. File ownership is disjoint from in-flight v9 domain, codec, migration, and view lanes. Primary agent owns observed-loop retry, integration, and Bioscopics identity. No artificial second coding lane.
