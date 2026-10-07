import {
  REEF_SHOWCASE_PROFILES,
  reefShowcaseProfile,
  type ReefShowcaseProfileId,
} from './showcaseProfiles'

export const DEV_FRESHWATER_50_VIEW_ID = 'freshwater-50' as const
export type DevTankViewId = ReefShowcaseProfileId | typeof DEV_FRESHWATER_50_VIEW_ID

export type DevTankView = Readonly<{
  id: ReefShowcaseProfileId
  label: string
  waterType: 'reef'
}> | Readonly<{
  id: typeof DEV_FRESHWATER_50_VIEW_ID
  label: string
  waterType: 'freshwater'
}>

export const DEV_TANK_VIEWS: readonly DevTankView[] = Object.freeze([
  ...REEF_SHOWCASE_PROFILES.map(({ id, label }) => ({ id, label, waterType: 'reef' as const })),
  { id: DEV_FRESHWATER_50_VIEW_ID, label: 'Freshwater 50 gallon', waterType: 'freshwater' },
])

const reefView = (id: string | null) => REEF_SHOWCASE_PROFILES.find((profile) => profile.id === id)

/** Resolve only the development fixture route. Non-dev gating remains the App shell's authority. */
export function devTankViewFromSearch(search: string): DevTankView {
  const requested = new URLSearchParams(search).get('devTank')
  if (requested === DEV_FRESHWATER_50_VIEW_ID)
    return DEV_TANK_VIEWS.find(({ id }) => id === DEV_FRESHWATER_50_VIEW_ID)!
  const profile = reefView(requested) ?? reefShowcaseProfile()
  return { id: profile.id, label: profile.label, waterType: 'reef' }
}

export function devTankViewUrl(href: string, id: DevTankViewId): string {
  const url = new URL(href)
  url.searchParams.set('dev', '1')
  url.searchParams.set('devTank', id)
  return url.toString()
}
