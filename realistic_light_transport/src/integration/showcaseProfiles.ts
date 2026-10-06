export type ReefShowcaseProfileId =
  | 'reef-nano-20'
  | 'reef-standard-40'
  | 'reef-standard-200'
  | 'reef-250'
  | 'reef-500'
  | 'reef-monster-1000'
  | 'reef-cylinder-1500'

export type ReefShowcaseForm = 'rectangular' | 'cylinder'
export type ReefShowcaseSwimBand = 'top' | 'mid' | 'bottom'
export type ReefCoralPigment = 'green_cyan_fp' | 'red_orange_fp' | 'mixed_fp' | 'chromoprotein'

export interface ReefShowcaseRosterRow {
  readonly speciesId: string
  readonly count: number
  readonly swimBand: ReefShowcaseSwimBand
  readonly displayRole: 'pair' | 'school' | 'grazer' | 'benthic' | 'cleanup'
}

export interface ReefShowcaseCoralPresentation {
  readonly colonyScale: number
  readonly fluorescence: Readonly<{
    pigment: ReefCoralPigment
    color: string
    intensity: number
  }>
}

export interface ReefShowcaseCoral {
  readonly key: string
  readonly speciesId: string
  readonly variantId: string
  readonly morphology: string
  readonly placement: Readonly<{
    version: 1
    surface: 'rock'
    surfaceId: string
    position: readonly [number, number, number]
    normal: readonly [number, number, number]
    yaw: number
  }>
  readonly presentation: ReefShowcaseCoralPresentation
}

export interface ReefShowcaseProfile {
  readonly id: ReefShowcaseProfileId
  readonly label: string
  readonly tierId: string
  readonly form: ReefShowcaseForm
  readonly composition: string
  readonly lighting: Readonly<{
    fixture: 'led' | 'pro_led'
    actinicPeakNanometers: 450
    blueFraction: number
    naturalShadowFraction: number
  }>
  readonly fishRoster: readonly ReefShowcaseRosterRow[]
  readonly cleanupRoster: readonly ReefShowcaseRosterRow[]
  readonly coralGarden: readonly ReefShowcaseCoral[]
  readonly performanceCaps: Readonly<{
    maxFish: number
    maxCleanupCrew: number
    maxCorals: number
    maxRenderedResidents: number
  }>
}

const CORAL_LIBRARY = [
  ['acropora_branching', 'bushy_pink', 'branching', 'red_orange_fp'],
  ['acropora_branching', 'hairy_green', 'branching', 'green_cyan_fp'],
  ['acropora_branching', 'staghorn_blue', 'branching', 'chromoprotein'],
  ['acropora_branching', 'staghorn_green_purple_tips', 'branching', 'mixed_fp'],
  ['acropora_branching', 'table_blue', 'table', 'chromoprotein'],
  ['acropora_branching', 'table_green', 'table', 'green_cyan_fp'],
  ['anacropora', 'brown_pink_tips', 'branching', 'red_orange_fp'],
  ['anacropora', 'green', 'branching', 'green_cyan_fp'],
  ['chalice_coral', 'jelly_bean', 'encrusting', 'mixed_fp'],
  ['chalice_coral', 'purple_orange_eyes', 'encrusting', 'red_orange_fp'],
  ['chalice_coral', 'red_green_eyes', 'encrusting', 'mixed_fp'],
  ['goniopora', 'green_pink', 'lps', 'green_cyan_fp'],
  ['goniopora', 'purple_green', 'lps', 'mixed_fp'],
  ['goniopora', 'red_brown', 'lps', 'red_orange_fp'],
  ['millepora', 'blade', 'blade', 'chromoprotein'],
  ['millepora', 'branching', 'branching', 'chromoprotein'],
  ['montipora', 'capricornis_plating', 'plating', 'mixed_fp'],
  ['montipora', 'digitata_branching', 'branching', 'green_cyan_fp'],
  ['montipora', 'encrusting', 'encrusting', 'green_cyan_fp'],
  ['stylophora', 'blueberry', 'branching', 'chromoprotein'],
  ['stylophora', 'pink', 'branching', 'red_orange_fp'],
  ['torch_coral', 'gold_white_tips', 'lps', 'red_orange_fp'],
  ['torch_coral', 'green_pink_tips', 'lps', 'green_cyan_fp'],
  ['zoanthid', 'blue_green', 'soft_colony', 'green_cyan_fp'],
  ['zoanthid', 'orange_red', 'soft_colony', 'red_orange_fp'],
] as const

const ROCK_ANCHORS = [
  [.31, .43, .04], [.16, .34, .18], [-.02, .34, .53], [-.21, .43, .48],
  [-.45, .34, .55], [-.64, .40, .35], [-.65, .42, -.03], [-.14, .40, .03],
  [-.06, .31, -.43], [.19, .38, -.47], [.30, .44, -.35], [.51, .43, -.35], [.62, .31, -.40],
] as const

const PIGMENT_LOOK: Readonly<Record<ReefCoralPigment, Readonly<{ color: string; intensity: number }>>> = {
  green_cyan_fp: { color: '#4dffd0', intensity: .42 },
  red_orange_fp: { color: '#ff2f77', intensity: .56 },
  mixed_fp: { color: '#7dffc2', intensity: .28 },
  chromoprotein: { color: '#778cff', intensity: .055 },
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const seeded = (index: number, salt: number) => {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453
  return value - Math.floor(value)
}

function coralGarden(profileId: ReefShowcaseProfileId, count: number, seed: number,
  baseScale: number): readonly ReefShowcaseCoral[] {
  return Object.freeze(Array.from({ length: count }, (_, index) => {
    const rockId = (index * 5 + seed) % ROCK_ANCHORS.length
    const anchor = ROCK_ANCHORS[rockId]
    const angle = seeded(index, seed + 11) * Math.PI * 2
    const radius = .03 + seeded(index, seed + 19) * .1
    const coral = CORAL_LIBRARY[(index + seed * 3) % CORAL_LIBRARY.length]
    const morphology = coral[2]
    const pigment = coral[3]
    const surfaceHugging = morphology === 'table' || morphology === 'plating'
      || morphology === 'encrusting'
    const lean = surfaceHugging
      ? .02 + seeded(index, seed + rockId + 29) * .09
      : (morphology === 'branching' || morphology === 'blade' ? .1 : .06)
        + seeded(index, seed + rockId + 29) * (morphology === 'branching' || morphology === 'blade' ? .25 : .22)
    const leanAzimuth = Math.atan2(anchor[2], anchor[0])
      + (seeded(index, seed + rockId + 37) - .5) * Math.PI * 1.6
    const sizeRoll = seeded(index, seed + 43)
    const sizeBand = sizeRoll < .34 ? .58 + seeded(index, seed + 47) * .12
      : sizeRoll < .82 ? .78 + seeded(index, seed + 47) * .18
        : 1.05 + seeded(index, seed + 47) * .12
    const morphologyScale = morphology === 'encrusting' ? .78 : morphology === 'soft_colony' ? .82
      : morphology === 'lps' ? .88 : morphology === 'blade' ? .94 : morphology === 'table' ? 1.04 : 1
    return Object.freeze({
      key: `${profileId}:coral:${String(index + 1).padStart(2, '0')}`,
      speciesId: coral[0], variantId: coral[1], morphology,
      placement: Object.freeze({
        version: 1 as const, surface: 'rock' as const, surfaceId: `rock:${rockId}`,
        position: Object.freeze([
          clamp(anchor[0] + Math.cos(angle) * radius, -.82, .82),
          clamp(anchor[1] + (seeded(index, seed + 23) - .5) * .16
            + (surfaceHugging ? -.02 : .015), .22, .56),
          clamp(anchor[2] + Math.sin(angle) * radius, -.72, .72),
        ] as const),
        normal: Object.freeze([Math.cos(leanAzimuth) * lean, Math.sqrt(1 - lean * lean),
          Math.sin(leanAzimuth) * lean] as const),
        yaw: seeded(index, seed + 31) * Math.PI * 2 - Math.PI,
      }),
      presentation: Object.freeze({
        colonyScale: baseScale * morphologyScale * sizeBand,
        fluorescence: Object.freeze({ pigment, ...PIGMENT_LOOK[pigment] }),
      }),
    })
  }))
}

const fish = (speciesId: string, count: number, swimBand: ReefShowcaseSwimBand,
  displayRole: ReefShowcaseRosterRow['displayRole']): ReefShowcaseRosterRow =>
  Object.freeze({ speciesId, count, swimBand, displayRole })

const clean = (speciesId: string, count: number): ReefShowcaseRosterRow =>
  fish(speciesId, count, 'bottom', 'cleanup')

function profile(config: Omit<ReefShowcaseProfile, 'coralGarden'> & {
  readonly coralCount: number; readonly coralSeed: number; readonly coralScale: number
}): ReefShowcaseProfile {
  const { coralCount, coralSeed, coralScale, ...rest } = config
  return Object.freeze({ ...rest,
    fishRoster: Object.freeze([...rest.fishRoster]),
    cleanupRoster: Object.freeze([...rest.cleanupRoster]),
    coralGarden: coralGarden(rest.id, coralCount, coralSeed, coralScale),
  })
}

export const REEF_SHOWCASE_PROFILES: readonly ReefShowcaseProfile[] = Object.freeze([
  profile({ id: 'reef-nano-20', label: 'Vibrant 20 gal nano reef', tierId: 'nano20', form: 'rectangular',
    composition: 'One compact bommie, a clown pair, and a small mixed coral crown.',
    lighting: { fixture: 'led', actinicPeakNanometers: 450, blueFraction: .68, naturalShadowFraction: .32 },
    fishRoster: [fish('black_storm_ocellaris', 2, 'mid', 'pair')],
    cleanupRoster: [clean('astrea_snail', 2), clean('cerith_snail', 2), clean('trochus_snail', 1)],
    coralCount: 6, coralSeed: 1, coralScale: 1.45,
    performanceCaps: { maxFish: 2, maxCleanupCrew: 6, maxCorals: 8, maxRenderedResidents: 16 } }),
  profile({ id: 'reef-standard-40', label: 'Vibrant 40 gal mixed reef', tierId: 'mid151', form: 'rectangular',
    composition: 'Two low islands with a central sand channel and compact mixed gardens.',
    lighting: { fixture: 'led', actinicPeakNanometers: 450, blueFraction: .7, naturalShadowFraction: .3 },
    fishRoster: [fish('ocellaris', 2, 'mid', 'pair'), fish('royal_gramma', 1, 'mid', 'grazer')],
    cleanupRoster: [clean('astrea_snail', 3), clean('cerith_snail', 2), clean('trochus_snail', 2)],
    coralCount: 10, coralSeed: 3, coralScale: 1.7,
    performanceCaps: { maxFish: 4, maxCleanupCrew: 8, maxCorals: 12, maxRenderedResidents: 24 } }),
  profile({ id: 'reef-standard-200', label: 'Established 200 gal reef', tierId: 'xl757', form: 'rectangular',
    composition: 'Layered mixed-reef islands with a cardinal cohort and long grazer lanes.',
    lighting: { fixture: 'pro_led', actinicPeakNanometers: 450, blueFraction: .74, naturalShadowFraction: .26 },
    fishRoster: [fish('ocellaris', 2, 'mid', 'pair'), fish('banggai_cardinal', 5, 'top', 'school'),
      fish('blue_hippo_tang', 1, 'mid', 'grazer'), fish('diamond_goby', 1, 'bottom', 'benthic'),
      fish('royal_gramma', 1, 'mid', 'grazer'), fish('tomini_tang', 1, 'mid', 'grazer')],
    cleanupRoster: [clean('astrea_snail', 4), clean('cerith_snail', 4), clean('trochus_snail', 3),
      clean('cleaner_shrimp', 1), clean('nassarius_snail', 3)],
    coralCount: 24, coralSeed: 5, coralScale: 2.05,
    performanceCaps: { maxFish: 12, maxCleanupCrew: 18, maxCorals: 26, maxRenderedResidents: 56 } }),
  profile({ id: 'reef-250', label: 'Established 250 gal reef', tierId: 'xxl946', form: 'rectangular',
    composition: 'Broad stepped islands with open foreground sand and a midwater school.',
    lighting: { fixture: 'pro_led', actinicPeakNanometers: 450, blueFraction: .76, naturalShadowFraction: .24 },
    fishRoster: [fish('ocellaris', 2, 'mid', 'pair'), fish('banggai_cardinal', 5, 'top', 'school'),
      fish('blue_hippo_tang', 1, 'mid', 'grazer'), fish('yellow_tang', 1, 'mid', 'grazer'),
      fish('diamond_goby', 1, 'bottom', 'benthic'), fish('watchman_goby', 1, 'bottom', 'benthic'),
      fish('royal_gramma', 1, 'mid', 'grazer')],
    cleanupRoster: [clean('astrea_snail', 5), clean('cerith_snail', 4), clean('trochus_snail', 4),
      clean('cleaner_shrimp', 1), clean('nassarius_snail', 4), clean('pistol_shrimp', 1)],
    coralCount: 28, coralSeed: 7, coralScale: 2.25,
    performanceCaps: { maxFish: 14, maxCleanupCrew: 22, maxCorals: 30, maxRenderedResidents: 66 } }),
  profile({ id: 'reef-500', label: 'Mature 500 gal reef wall', tierId: 'mega1893', form: 'rectangular',
    composition: 'Three staggered coral heads, negative-space arches, and uninterrupted grazer lanes.',
    lighting: { fixture: 'pro_led', actinicPeakNanometers: 450, blueFraction: .79, naturalShadowFraction: .23 },
    fishRoster: [fish('ocellaris', 2, 'mid', 'pair'), fish('banggai_cardinal', 8, 'top', 'school'),
      fish('blue_hippo_tang', 2, 'mid', 'grazer'), fish('tomini_tang', 1, 'mid', 'grazer'),
      fish('yellow_tang', 1, 'mid', 'grazer'), fish('purple_tang', 1, 'mid', 'grazer'),
      fish('gem_tang', 1, 'mid', 'grazer'), fish('six_line_wrasse', 1, 'bottom', 'grazer'),
      fish('diamond_goby', 2, 'bottom', 'benthic'), fish('watchman_goby', 2, 'bottom', 'benthic'),
      fish('royal_gramma', 1, 'mid', 'grazer')],
    cleanupRoster: [clean('astrea_snail', 6), clean('cerith_snail', 5), clean('trochus_snail', 5),
      clean('turbo_snail', 2), clean('cleaner_shrimp', 2), clean('nassarius_snail', 5),
      clean('pistol_shrimp', 1), clean('brittle_star', 2)],
    coralCount: 38, coralSeed: 9, coralScale: 2.4,
    performanceCaps: { maxFish: 24, maxCleanupCrew: 30, maxCorals: 42, maxRenderedResidents: 92 } }),
  profile({ id: 'reef-monster-1000', label: 'Polo-inspired 1,000 gal established reef', tierId: 'monster3785', form: 'rectangular',
    composition: 'Dense branching, plating, encrusting, LPS, and soft-coral gardens on layered islands with a wide center swim corridor.',
    lighting: { fixture: 'pro_led', actinicPeakNanometers: 450, blueFraction: .82, naturalShadowFraction: .22 },
    fishRoster: [fish('ocellaris', 2, 'mid', 'pair'), fish('banggai_cardinal', 10, 'top', 'school'),
      fish('blue_hippo_tang', 3, 'mid', 'grazer'), fish('tomini_tang', 2, 'mid', 'grazer'),
      fish('yellow_tang', 1, 'mid', 'grazer'), fish('purple_tang', 1, 'mid', 'grazer'),
      fish('gem_tang', 1, 'mid', 'grazer'), fish('regal_angelfish', 1, 'mid', 'grazer'),
      fish('six_line_wrasse', 1, 'bottom', 'grazer'), fish('diamond_goby', 3, 'bottom', 'benthic'),
      fish('watchman_goby', 4, 'bottom', 'benthic'), fish('royal_gramma', 1, 'mid', 'grazer')],
    cleanupRoster: [clean('astrea_snail', 8), clean('cerith_snail', 6), clean('trochus_snail', 6),
      clean('turbo_snail', 3), clean('fighting_conch', 2), clean('nassarius_snail', 6),
      clean('brittle_star', 3), clean('blue_linckia', 1), clean('cleaner_shrimp', 2), clean('pistol_shrimp', 2)],
    coralCount: 48, coralSeed: 11, coralScale: 2.65,
    performanceCaps: { maxFish: 34, maxCleanupCrew: 42, maxCorals: 48, maxRenderedResidents: 124 } }),
  profile({ id: 'reef-cylinder-1500', label: 'Huge 1,500 gal cylinder reef', tierId: 'cylinder5678', form: 'cylinder',
    composition: 'A radial coral crown with a clear perimeter circuit and open upper-water schooling space.',
    lighting: { fixture: 'pro_led', actinicPeakNanometers: 450, blueFraction: .8, naturalShadowFraction: .24 },
    fishRoster: [fish('black_storm_ocellaris', 2, 'mid', 'pair'), fish('banggai_cardinal', 10, 'top', 'school'),
      fish('blue_hippo_tang', 4, 'mid', 'grazer'), fish('tomini_tang', 3, 'mid', 'grazer'),
      fish('yellow_tang', 2, 'mid', 'grazer'), fish('purple_tang', 1, 'mid', 'grazer'),
      fish('gem_tang', 1, 'mid', 'grazer'), fish('regal_angelfish', 1, 'mid', 'grazer'),
      fish('six_line_wrasse', 1, 'bottom', 'grazer'), fish('diamond_goby', 5, 'bottom', 'benthic'),
      fish('watchman_goby', 5, 'bottom', 'benthic'), fish('royal_gramma', 1, 'mid', 'grazer')],
    cleanupRoster: [clean('astrea_snail', 7), clean('cerith_snail', 6), clean('trochus_snail', 6),
      clean('turbo_snail', 3), clean('nassarius_snail', 6), clean('brittle_star', 3),
      clean('blue_linckia', 1), clean('cleaner_shrimp', 2), clean('pistol_shrimp', 2)],
    coralCount: 42, coralSeed: 13, coralScale: 2.55,
    performanceCaps: { maxFish: 40, maxCleanupCrew: 40, maxCorals: 42, maxRenderedResidents: 120 } }),
])

const PROFILES_BY_ID: ReadonlyMap<string, ReefShowcaseProfile> =
  new Map(REEF_SHOWCASE_PROFILES.map((item) => [item.id, item]))

export function reefShowcaseProfile(id?: string | null): ReefShowcaseProfile {
  return PROFILES_BY_ID.get(id ?? '') ?? PROFILES_BY_ID.get('reef-monster-1000')!
}
