# First region systems contract

This is an implementation contract for the next Greenway expedition increment, not the full-game finish. The full single-player acceptance gate remains in [Game Design](GAME_DESIGN.md).

## Authoritative state and compatibility

- New saves use `wizard-world/v4` and `greenway-region-v2`. The classic and expanded profiles stay separate.
- The v4 player records nonnegative integer XP for `woodcutting`, `construction`, `wayfinding`, `spellcraft`, and `excavation`, plus learned spell IDs. Skill level is `1 + floor(xp / 30)`.
- The world records studied inscription IDs, revealed dig-site IDs, and excavated dig-site IDs. Generated inscription and dig-site definitions have stable IDs and positions. IDs, not meshes, are saved as progress.
- Restore v1, v2, and pinned v3 progress into v4 without rewriting old storage bytes. A v3 save only accepts `greenway-region-v1`; v4 only accepts `greenway-region-v2`. Unknown versions, profiles, revisions, and structurally incomplete saves fail closed.
- New classic storage key is `wizard-realms:world:v4`, falling back through v3/v2/v1. New expanded key is `wizard-realms:world:expanded:v3`, falling back through expanded v2/v1. A present incompatible newest save prevents fallback and autosave.
- Replay and save/reload must preserve every new discovery, skill gain, and excavation. All changes originate in typed intents and events.

## Content and interaction

- `wayfinder_glow` is initially unknown. Study the Greenway waystone near `(3, 3)` within 3 m to learn it. The waystone must remain clear of both current and migrated legacy shop footprints. It is a discoverable world object, not a menu grant.
- Casting the learned spell reveals hidden map tiles and dig sites within an 8 m radius. Only newly revealed content awards spellcraft and wayfinding XP. An unlearned spell is rejected. Casting without a new reveal may animate but must not farm XP.
- Greenway Outfitters sells a `field_spade` for 18 coins, stock 3. It uses the main-hand slot. An unequipped or unowned spade cannot excavate.
- A practice mound near `(7, 3)` is visible from the start, clear of the authentic v1 Highland shop and ring anchors, requires excavation level 1, yields 2 stone and 30 excavation XP. A buried ridge cache near `(-6, -9)` starts hidden, can be revealed by spell, requires excavation level 2, yields one `ancient_relic` and 40 excavation XP. Both require range 3 m, compatible ground, pack capacity, and an equipped spade.
- Generation reserves the inscription and dig-site footprints before placing resources, so neither appears inside a tree, shop, or route anchor, including for old migrated saves.
- Excavation is single-use, changes the site to a visible dug state, and persists. The ground at the site should visibly read as disturbed, with the authoritative site state driving that appearance.
- Greenway buys a relic for 25 coins, Highland buys it for 50. Existing regional buying behavior remains. Woodcutting one tree yields 4 logs so one tree funds the first 4-log ladder; harvest is still two hits.
- Interaction priority should not make the waystone or dig sites inaccessible when trees, route endpoints, or stores are nearby. A touch-accessible cast control and clear learn/dig feedback are required.

## Acceptance journey

Fresh expedition: learn the spell, walk toward the northern fog, cast to reveal hidden terrain or the ridge cache, buy and equip the spade, excavate the practice mound, grow excavation to level 2, equip the axe and gather logs, build and cross the ladder, re-equip the spade and excavate the revealed ridge cache, return to a store, sell the relic, then reload. The save must retain learned magic, skill XP, completed route, dig-site states, inventory, and coin balance. Compact landscape and phone controls must not hide the required actions.
