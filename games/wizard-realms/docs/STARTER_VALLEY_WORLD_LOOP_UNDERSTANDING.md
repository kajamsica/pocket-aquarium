# Starter valley world loop: aligned understanding

## Original Ask

The opening world feels clunky and visually traversable ground sometimes stops
the player without a reason. The player should learn by acting in a starter
valley: chop trees, buy/equip boots and a spade, build a bridge over a
continuous river and a ladder up a cliff, dig where ground allows, discover
different materials by place and depth, reshape ground, and have a limited
return-home rescue if trapped. The first obstacles should teach their routes
without turning the game into a tutorial wall.

## Aligned Problem Statement

The public V24 baseline already had a connected approximately 2 km square
streamed world, an 8-log starter bridge, 4-log cliff ladder, gear, and saved
dig work. The opening creek was only a five-cell, 20 m strip, however. Several
systems are technically present but mediated through Work mode and exact
sites. Rejections enter a low-salience recent-events list, and an equipped
spade does not make terrain visibly or directly diggable. This produces
unexplained stops and a level that reads less connected than its authority.

The design target is a geography-led opening, not an invisible fence: the
river and cliff are legible continuous obstacles with physical bridge and
ladder solutions, while ordinary visible land remains traversable. Mining is
one authoritative, saved excavation system driven by the clicked ground and
geology, not a fake animation or a one-off reward tile. Home rescue is a
bounded recovery mechanism, not a way to bypass discovery or route costs.

## Goal and terminal condition

Goal: a first-time player can explore the starter valley, infer the tree to
bridge or ladder resource loop, cross both obstacles by building, equip a
spade and click visible diggable ground for a place/depth-specific resource,
observe the persistent divot, and recover from a truly trapped hole with a
clearly stated 30-minute cooldown.

Done for this subgoal when a fresh public UI journey proves the above, save
and reload preserve the works/terrain/cooldown, and the player never hits an
unexplained boundary or sees ordinary land that appears enterable but is not.
This is one milestone inside the active full-game goal, not goal completion.

## Goals

- Make physical obstacle cause and remedy immediately legible at the attempted
  location, while keeping free walking and camera controls fluid.
- Establish a hydrologically connected starter river, extending across the
  region or terminating visibly in lakes/other water, with collision and
  rendering derived from the same canonical cells.
- Make the valley economy consequential: trees supply route materials, boots
  change gait, spade equipment exposes eligible digging, and digging yields
  deterministic terrain-specific material.
- Persist changed terrain, depth, placed fill/support, and a rate-limited
  rescue without weakening checked save/replay or older roots.

## Constraints and non-goals

- Preserve V17/V23/V24 save integrity and source pinning. Any changed
  authoritative terrain or action grammar requires a new versioned root and
  explicit migration, not an in-place rewrite of old replay facts.
- The 2 km world remains finite; the outer edge must be visually honest and
  geographically legible. It is not an invitation to render reachable-looking
  land beyond authority.
- Do not spawn extra browser renderers given the RAM history. The CUA
  browser-control bridge returns `unsupported Codex auth method: apikey`.
  Playwright CLI can drive one isolated renderer, so UI proof is possible.
  HTTP and unit tests are not UI proof. Keep the preview available and close
  the test renderer when done.
- No MMO, unrestricted voxel storage, complex fluid simulation, combat
  mining, or production deployment is part of this milestone.
- No GitHub action, PR, commit, or account switch was requested.

## Success criteria

1. On a dry obstacle approach, a concise contextual cue explains the exact
   reason and next physical action. Repeated held movement does not spam it.
2. A topological test traces the canonical river to a map edge or joined
   waterbody, and collision/rendering use the same cell source.
3. In a new versioned world, clicking supported diggable ground with equipped
   spade lowers one addressed column, gives its deterministic material, and
   reload shows the same terrain. Non-diggable, remote, undiscovered, and
   unsupported clicks are rejected explicitly.
4. Dig depth has a deterministic safe limit or bedrock rule; fill/ladder escape
   and return-home cooldown are save-backed, with no route or economy bypass.
5. A new-player UI session can complete bridge, ladder, dig, rescue, and
   save/resume without unexplained dead ends or misleading visual affordances.

## Open questions and implementation risks

- The user's exact observed stop location is pending an optional screenshot or
  map coordinate. Source evidence already confirms creek/cliff/world-edge
  rejection paths and a short creek, so work can proceed without it.
- Dig column size/depth and mineral probabilities are execution-local design
  decisions, but must be fixed before a saved schema is authored. Rare ores
  must not trivialize route/trade progression.
- A 30-minute cooldown cannot simply be converted to ticks while idle frames
  are suppressed; the timing and replay contract must be explicitly designed.
- Extending the creek or cliff within old profiles could invalidate saved poses
  and witness replay. Keep old terrain definitions intact.

## Source audit and staged decision

The current creek is exactly five contiguous 4 m cells, centered at x =
-8, -4, 0, 4, and 8 m on z = 8 m. It can be walked around. The broader world
has 512 columns per axis, approximately 2.048 km square. Some dry-looking
terrain also stops travel because Greenway refuses height rises over 0.55 m,
and the Greenway-to-streamed handoff can reject old-floor or receiving-owner
support. Those are separate from river collision and must not be presented as
river stops.

First, preserve exact V17/streamed movement rejections through the V23/V24
controller and display a short, prominent, deduplicated cue. This does not
change saved authority. It is the immediate affordance milestone documented in
`STARTER_VALLEY_AFFORDANCE_PACK.md`.

Second, introduce a V25 source-pinned migration rather than edit V24 terrain.
The V25 river should be one seed-deterministic, cardinally connected graph of
4 m cells from the west world edge to the east world edge, preserving the
present five central cells. One canonical predicate/overlay must serve
collision, water rendering, bridge support, and both movement owners. Migration
must explicitly settle old poses that become wet, recording a nearby dry-bank
relocation or preserving support on an existing deck. The render and collision
boundaries must agree. Ordinary visible dry land should be reachable, or have
a visible and accurately explained physical obstruction; the finite outer edge
should not show apparently enterable continuation.

Third, add a sparse V25 excavation ledger keyed by 4 m tile ID. An equipped
spade reveals eligible ground, and a click submits that canonical tile ID to a
checked writer. The writer verifies reach, discovery, dry/support conditions,
occupancy, capacity, skill, and depth. Material comes from seed + tile + depth,
with common soil/stone at shallow layers and deeper ore gates. Track the
deepest rewarded layer so filling and re-digging cannot print resources. The
same lowered surface must feed mesh, collision, and pose proof; soil fill and
pit ladders provide ordinary recovery. Diamond requires a later deep-tool
milestone, not a starter spade reward.

Finally, add a checked return-home action that leaves pits intact and records
its accepted wall time plus a 1,800,000 ms next-eligible deadline in the V25
root. The writer samples time under its save lock, and replay uses the recorded
timestamp. Reload and backward local-clock changes cannot reset the deadline.
A local/offline clock cannot resist deliberate forward-clock changes or old
database restoration; server time would be required for anti-cheat guarantees.

The first V25 playable slice should also prove at least 12 accessible logs
before the river/cliff gates, discoverable bridge/ladder placement, store access,
and save/reload of crossing and excavation. This is a target budget, not a
claim about current tree placement. The opening guidance should explain the
next physical affordance in plain language rather than rely on coordinate-heavy
Work mode text.

The intended first-hour loop is a bounded but visibly connected valley. Trees
are useful because logs buy the first two permanent exits: a bridge across the
continuous river and a ladder up the cliff. Both obstacles must look like real
terrain, show the missing route at the attempted crossing, and keep the opened
area visible after passage. Boots enable running. Equipping an owned spade
should highlight reachable, discovered dry ground; clicking a specific column
starts digging there rather than opening a fixed dig-site menu. A divot, depth,
and material from that location must survive reload. The starter spade can
extract common shallow material, while stone, metal, gold, and diamond require
later tools and skill, so the opening economy cannot be short-circuited.

The initial river should be one unbroken west-to-east watercourse at the world
edges, not a five-cell obstacle with a dry bypass. A bridge is the early route;
boats are a later route. The early cliff requires a built ladder. If digging
traps the player, fill/support or a limited home return should be available,
with the 30-minute eligibility deadline persisted and enforced by the checked
writer. None of this implies that every visible 2 km world edge is traversable:
the finite edge must be depicted honestly rather than as inviting land.

## System routing

System translation: `not_qualified`, this is new gameplay inside the existing
engine, not a whole-system port. Receipt: `not_applicable`.
Product agent runtime: `not_required`, the shipped game adds no durable model
or agent execution. Planner handoff: `auto-planner-ticket-pack`, aligned.

## Current V26 planning checkpoint, 2026-10-09

`?publicWorld=v26` is an opt-in, separate checked save rooted in V25. The
source-pinned writer and UI now expose the continuous river, north rock rim,
bridge and ladder Works choices, spade Dig/Fill terrain controls, visible pits,
saved pit ladders, and trapped-only return home with a saved 30-minute delay.
The focused integration run passed 262 tests and a production build. A single
Playwright renderer proved fresh start, axe equip, four-log chopping, the
bridge objective, and the Works menu. It has **not** yet proved placement and
crossing, buying/equipping the spade, click-to-dig and fill, return trade, or
save/resume through the UI. This is the next decision-bearing gap. V26 is a
milestone inside the full-game goal, not a completed RPG.

The subsequent one-renderer browser probe did prove the bridge route: the
player gathered logs, cleared the marked-tree gate, built the creek bridge,
crossed to the far bank, and resumed a validated V26 save at x 3.9, z 13.9 m
with the bridge still built. The tester needed repeated map checks to align
with the narrow deck, and the starter prompt still said to chop trees after
crossing. Spade acquisition, terrain changes, return trade, and the cliff
ladder remain the next UI proof boundaries. The preview was left running and
the test browser was closed.

## Player-directed valley contract, 2026-10-09

The player should begin in a legible pocket of a continuous world, not a
separate room or a set of swapped map squares. The starting valley contains
trees, a store, a river spanning its crossing edge, and a climbable cliff at
another exit. Ordinary visible dry ground is traversable. Water and rock are
real obstacles with a visible cause and route: a bridge or later boat crosses
the river; a correctly placed ladder climbs the cliff. A first-time approach
can show one concise contextual cue, without repeatedly halting movement with
the same message. The river cannot fade out or end in dry land; it connects to
another waterbody, river, or an honest map edge.

The opening resource loop is action-led. Trees provide logs for routes and
trade. Store gear matters: boots unlock running and an equipped spade exposes
specific nearby diggable ground. Clicking a revealed, clear ground column digs
that column, lowers it visibly, and awards geology- and depth-specific
material. Digging, filling, placing soil, and putting a ladder in a pit must
all act on the same saved terrain columns. Rare metal, gold, and diamond are
later tool/skill gates, not starter-spade jackpots. Materials earned from
ground must be visible in a truthful pack/satchel and eventually usable in a
checked trade or craft path. A fully trapped character can return home, but
the saved 30-minute cooldown must prevent using rescue as a routine shortcut.

The intended progression is to infer two permanent exits from the valley,
not simply find a way around a short creek. The first bridge opens the
far-bank region, while the first ladder opens the high ledge. These exits
connect to persistent discoverable terrain, with no scene teleport or
disappearing old landscape. On-screen route previews must look and behave
like a bridge or a ladder respectively. This is a target for playtest proof,
not a claim that V26 already feels this way.

## Current UI evidence and next repair gate

In a fresh V26 UI run, the tester bought the field spade at Greenway
Outfitters for 18 gold, equipped it, selected Dig, clicked nearby revealed
ground, and saw a persistent pit. After selecting Fill, three clicks on the
visible pit produced no fill, no error, and no terrain change. The local
picker only accepts a first hit named `Continuous terrain surface`; the pit's
visible fascia is a different frontmost mesh, which plausibly explains the
silent click. The V26 terrain ledger awards material into a separate saved
bag, but the HUD shows only ordinary inventory stacks and trade listings.
That makes the resource result invisible and the displayed capacity
misleading. The next bounded repair should make the intended pit click
address the saved column without clicking through unrelated blockers, and
surface the terrain bag without pretending its contents are ordinary saleable
inventory. The same first-time UI journey must then be retried.

The bounded repair has now passed that exact retry. A fresh V26 browser run
bought and equipped a spade, dug column -3,0 for one soil, showed the soil and
3/20 capacity, filled by clicking its exposed wall, and returned to 2/20.
Reload validated the saved V26 state with the pit filled, soil consumed,
spade still equipped, and excavation progress preserved. The Dig/Fill targeted
tests, a 201-file/2,285-test regression run, and production build passed. This is
proof of Dig/Fill and truthful material feedback, not proof that terrain-bag
materials can be traded or that the entire valley feels natural.

The subsequent first-time exit probe exposed a second, separate cliff UX
failure. The player chopped four logs, built the north Works ladder centered
at x 1.1, then walked into the cliff at x 0 beside its visible rungs. The
old blocked cue said to build a ladder again. A bounded V26 cue repair, with
its own 13-test focused run and a post-change production build, now
recognizes a saved ladder and says to approach its rungs from the lower face;
the exact browser retry confirmed this changed cue. The tester still could
not naturally align and climb with the current A/D pivot controls, so
successful ladder traversal remains unproved. The screenshot also shows a
stale, closed `First steps: chop trees for logs` panel after the ladder was
built. Do not mark the first-hour valley loop complete until a new-player UI
journey actually climbs, crosses the river, and reaches persistent new land.
