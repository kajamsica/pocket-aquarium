# Ticket Pack: Connected-world default entry

## Outcome

The plain Wizard Realms URL should open the newest accepted connected-world entry, rather than silently starting and autosaving the older v5 Greenway game. This is a release-path improvement toward the full single-player game, not a claim that the campaign is complete.

## Safety contract

- Keep an explicit, discoverable v5 legacy route. Its save remains readable and writable only after choosing that route.
- Keep the v7, v8, and v9 query routes. Do not silently import, migrate, resume, reset, or replace any save from the plain URL.
- A player with no save can start at v7, then opt into v8 and v9 through visible, explicit upgrade links. A player with an existing v5, v7, or v8 save can follow the same chain without older bytes changing.
- A player with a valid v9 save sees an explicit Resume action. Corrupt, changed-source, and divergent histories remain blocked with recovery guidance, never auto-selected.
- The development preview routes remain separate and never mount public save owners incidentally.

## Scoped owners and proof

| Lane | Files | Proof |
| --- | --- | --- |
| Entry routing | `main.tsx`, small pure route selector and focused tests if useful | Plain URL selects v9 after acceptance; explicit legacy and existing query routes select the original owners. |
| Upgrade navigation | `PublicWizardApp.tsx`, `PublicV9Entry.tsx`, focused tests | New and older players can find the next explicit entry; no button upgrades or writes until selected. |
| Acceptance | Isolated browser origins only | Empty, v5, v7, v8, v9, corrupt, and changed-source storage; compare all prior bytes before and after navigation, upgrade, reload, and return. |

## Sequencing

Finish the v9 camp and connected-world UI acceptance first. Then promote v9 as the default while preserving every old route. Keep v10 as a later explicit upgrade with its own migration gate; do not make a half-built v10 the plain entry.
