import type { MorphologyProfileV1 } from '../../specimens/specimenProfile'

type Station = MorphologyProfileV1['controlStations'][number]
export type EditableStationField = 'x' | 'dorsalHeight' | 'ventralDepth' | 'halfWidth' | 'centerY' | 'centerZ'

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value))

export function constrainStationEdit(
  profile: MorphologyProfileV1,
  stationId: string,
  field: EditableStationField,
  requestedValue: number,
): MorphologyProfileV1 {
  const index = profile.controlStations.findIndex((station) => station.id === stationId)
  if (index < 0 || !Number.isFinite(requestedValue)) return profile
  const clearance = profile.constraints.minimumClearance
  const station = profile.controlStations[index]
  let value = requestedValue
  if (field === 'x') {
    const minimum = index ? profile.controlStations[index - 1].x + clearance : station.x
    const maximum = index < profile.controlStations.length - 1
      ? profile.controlStations[index + 1].x - clearance : station.x
    value = clamp(value, minimum, maximum)
  } else if (field === 'dorsalHeight' || field === 'ventralDepth' || field === 'halfWidth') {
    value = clamp(value, clearance, profile.adultLengthMeters * 0.4)
  } else {
    value = clamp(value, -profile.adultLengthMeters * 0.125, profile.adultLengthMeters * 0.125)
  }
  const next: Station = { ...station, [field]: value }
  return { ...profile, controlStations: profile.controlStations.map((item, itemIndex) => itemIndex === index ? next : item) }
}
