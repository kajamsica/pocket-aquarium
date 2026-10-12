# Ticket Pack: V104 cache excavation pose parity

## Evidence and first gate

The full Wizard Realms goal remains active. A read-only source probe using valid synthetic `greenway-alpha` progress found that checked Glow can reveal the seal cache, but checked excavation while standing on its cell returns `invalid-destination`. Excavation lowers that cell from y2.40 to y1.65; the action retains the pre-dig player y, and strict final progress validation rejects the unsupported pose. The UI projection can offer the action while on that cell. The existing adjacent-position test succeeds. This is a proven source-level mismatch, not yet a live UI failure. No private browser checkpoint was inspected.

## Frozen repair contract

- Make checked excavation produce valid, grounded progress when a player stands on the excavated cell, consistent with the lower terrain after digging. Preserve the action's range, spade, skill, pack, discovery, and authority checks. Keep the existing adjacent-position behavior unchanged.
- Change only the smallest domain action owner and focused tests. Do not edit V103 controller/test files or the source of the public cache coordinates, renderer, terrain geometry, save schema, or unrelated actions. Do not use a hidden cache location to give player-facing guidance.
- Red test reproduces `invalid-destination` at a valid pre-dig center pose. Green tests assert checked success, canonical post-dig grounded y, decoder acceptance, no duplicate reward, adjacent-footing parity, save/snapshot round trip, and no effect on unrelated actions or seeds. Run focused tests, TypeScript, and whitespace.
- Independent review must confirm that the returned player pose is canonical and supported after the terrain changes, with no permissive decoder workaround or unexpected teleport. UI testing should follow after the V103 guided journey reaches a revealed cache.

## Lanes and gate

1. V104-A source implementer, domain action and focused tests only, no browser/private checkpoint/Git.
2. V104-B independent read-only review before any live UI retry involving the cache.
3. V104-C authentic browser journey from saved progress only after V103 succeeds. First test the checked cache marker/action from adjacent footing, then verify the on-cell case if safely reachable. Stop at the first concrete refusal and capture evidence.

## Source receipts

V104-A reproduced the pre-fix `invalid-destination` for valid on-cell excavation on both `greenway-alpha` and `wizard-realms`. The two-file repair resolves the post-dig canonical surface from the resulting region and lowers only player y to its floor, preserving x/z and grounded velocity. Adjacent footing remains unchanged. Focused action, snapshot, and expedition tests passed 25/25, TypeScript passed, and whitespace was clean. No browser or private checkpoint was used.

V104-B independently reviewed the change and returned GO with no blocking findings. It confirmed retained pre-action authority checks and strict final decoder, both-seed y1.65 regression, one-seal/no-repeat reward, adjacent parity, witness replay, and V24 snapshot acceptance. Its independent focused Vitest run passed 8/8 and TypeScript passed. Browser proof remains V104-C, after the V103 guided journey reaches a revealed cache.
