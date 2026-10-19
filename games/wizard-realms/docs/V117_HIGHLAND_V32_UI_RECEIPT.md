# V117: checked Highland entry and Crown UI receipt

## Proven in the current build

- A genuine V31 save was copied non-destructively into V32. Its saved north ladder, equipment, coins, and position remained available. V32 save/reload preserved later travel and the Crown study.
- The east Greenway rock return is a real wall. The player climbed the saved north ladder, passed the wall on its upper side, descended east of it, and entered the connected wilderness. V26 collision was not relaxed.
- The old Highland corridor crossed V25 river water near x96 for the default seed. V32-only displayed trail and guidance now use the dry north bank; historical route IDs, old versions, and river collision remain unchanged. The real UI passed the prior x94 refusal and continued through the quarry approach.
- The expanded map now shows current route guidance and the map before longer reference notes. Backpack, Works, and collapsed objective use the Highland direction instead of a stale eight-log west-bridge instruction.
- The real UI reached Quarry Crown around x462, z-428. The grounded, nearby checked interaction appeared, one click studied the Crown, and save/reload retained that state (V32 save revision 118). The browser was closed after the evidence export to respect the renderer memory limit.

## Not yet proven

This was a Crown study, **not** the complete Highland stone-to-store loop. The played save has an axe, but no field spade or Excavation Lv2. A short nearby survey did not reveal a stone shelf. The next UI proof must reveal one canonical shelf, show its actual locked reason, acquire and equip the spade, meet the skill gate through checked digging, extract stone, save/reload, return on discovered ground, and sell at Greenway Outfitters. Domain tests cover these transitions, but they do not substitute for that played journey.

One local replay test is intentionally not repeated here: a combined V32 snapshot suite spawned a heavy worker, so it was stopped to protect memory. Its focused implementation-lane tests had passed earlier. The current projection, controller, map, and HUD focused suites passed 73 tests, and the production build passed. Browser storage remains locally editable; V32's structural checks are not online anti-cheat.
