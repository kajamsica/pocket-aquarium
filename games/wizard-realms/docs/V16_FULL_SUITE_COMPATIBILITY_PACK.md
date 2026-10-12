# Full-suite UI compatibility repair

## Goal

Keep the v16 build-confirm and guidance improvements while restoring the two older UI contracts found by the full suite. Do not change authority, saves, gameplay mechanics, or the ongoing independent playtest bundle.

## Observed failures

1. `src/App.test.ts:668` expects `No discovered Highland bridge sites yet. Walk east along Northern Ridge`; `view/WizardMap.tsx` currently says singular `site`.
2. `src/StreamedPreviewApp.test.ts:290` expects `NE · 11 m on map · x -408, z 364`; `view/WizardHud.tsx` currently says `11.31 m`. Near-site precision must remain useful for the v16 placement flow.

## Worker lane

One UI compatibility worker owns only `view/WizardMap.tsx`, `view/WizardHud.tsx`, and directly relevant tests. Restore the plural copy, and use whole-metre guidance at longer distances while retaining finer precision near a work site. Run both identical failing test files, adjacent HUD/map tests, TypeScript, build, and `git diff --check`. Preserve concurrent changes.

## Acceptance

The two reproduced assertions pass without weakening them, v16 near-site guidance still shows precise distance, and no additional full-suite failures remain.
