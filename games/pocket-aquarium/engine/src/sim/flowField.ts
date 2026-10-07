export interface FlowFieldOptions {
  readonly quality?: 'balanced' | 'cinematic'
}

export interface FlowFieldState {
  readonly columns: number
  readonly rows: number
  readonly widthMeters: number
  readonly heightMeters: number
  readonly pressureIterations: number
  readonly velocityX: Float64Array
  readonly velocityY: Float64Array
  readonly pressure: Float64Array
  readonly divergenceBeforeProjection: number
  readonly pressureResidual: number
}

export interface FlowSample {
  readonly xMetersPerSecond: number
  readonly yMetersPerSecond: number
  readonly speedMetersPerSecond: number
}

export interface FlowScalarEstimate {
  readonly meanSpeedMetersPerSecond: number
  readonly peakSpeedMetersPerSecond: number
  readonly meanShearPerSecond: number
  readonly lowFlowFraction: number
}

export interface FlowDiagnosis extends FlowScalarEstimate {
  readonly columns: number
  readonly rows: number
  readonly maximumDivergence: number
  readonly divergenceBeforeProjection: number
  readonly pressureResidual: number
}

const PROFILES = {
  balanced: { columns: 24, rows: 12, pressureIterations: 12 },
  cinematic: { columns: 32, rows: 16, pressureIterations: 20 },
} as const
const DEFAULT_WIDTH_METERS = 1.2
const DEFAULT_HEIGHT_METERS = 0.5
const MAXIMUM_SPEED_METERS_PER_SECOND = 0.45
const LOW_FLOW_METERS_PER_SECOND = 0.025
const MAXIMUM_ELAPSED_SECONDS = 0.5
const MAXIMUM_SUBSTEP_SECONDS = 1 / 30
const LINEAR_DAMPING_PER_SECOND = 0.32
const PUMP_ACCELERATION_METERS_PER_SECOND_SQUARED = 0.42
const CANONICAL_REGIME_HORIZON_SECONDS = 12
const CANONICAL_REGIME_STEP_SECONDS = 0.5

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value))
const finite = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isFinite(value) ? value : fallback
const at = (column: number, row: number, width: number): number => row * width + column

const bilinear = (values: Float64Array, width: number, height: number, x: number, y: number): number => {
  const boundedX = clamp(x, 0, width - 1)
  const boundedY = clamp(y, 0, height - 1)
  const x0 = Math.floor(boundedX)
  const y0 = Math.floor(boundedY)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const tx = boundedX - x0
  const ty = boundedY - y0
  const lower = values[at(x0, y0, width)] * (1 - tx) + values[at(x1, y0, width)] * tx
  const upper = values[at(x0, y1, width)] * (1 - tx) + values[at(x1, y1, width)] * tx
  return lower * (1 - ty) + upper * ty
}

/**
 * Samples the front-plane reduced-order field at normalized aquarium coordinates.
 * Public velocities use meters per second. This is not a 3D CFD or pump-certification model.
 * State dimensions use meters and step durations use seconds.
 */
export function sampleFlowField(field: FlowFieldState, x: number, y: number): FlowSample {
  const nx = clamp(finite(x, 0.5), 0, 1)
  const ny = clamp(finite(y, 0.5), 0, 1)
  const vx = bilinear(field.velocityX, field.columns + 1, field.rows, nx * field.columns, ny * field.rows - 0.5)
  const vy = bilinear(field.velocityY, field.columns, field.rows + 1, nx * field.columns - 0.5, ny * field.rows)
  return { xMetersPerSecond: vx, yMetersPerSecond: vy, speedMetersPerSecond: Math.hypot(vx, vy) }
}

export function createFlowField(options: FlowFieldOptions = {}): FlowFieldState {
  const profile = PROFILES[options.quality ?? 'balanced']
  const { columns, rows } = profile
  return {
    columns,
    rows,
    widthMeters: DEFAULT_WIDTH_METERS,
    heightMeters: DEFAULT_HEIGHT_METERS,
    pressureIterations: profile.pressureIterations,
    velocityX: new Float64Array((columns + 1) * rows),
    velocityY: new Float64Array(columns * (rows + 1)),
    pressure: new Float64Array(columns * rows),
    divergenceBeforeProjection: 0,
    pressureResidual: 0,
  }
}

const divergence = (field: FlowFieldState, vx: Float64Array, vy: Float64Array): Float64Array => {
  const result = new Float64Array(field.columns * field.rows)
  const dx = field.widthMeters / field.columns
  const dy = field.heightMeters / field.rows
  for (let row = 0; row < field.rows; row += 1) {
    for (let column = 0; column < field.columns; column += 1) {
      result[at(column, row, field.columns)] =
        (vx[at(column + 1, row, field.columns + 1)] - vx[at(column, row, field.columns + 1)]) / dx +
        (vy[at(column, row + 1, field.columns)] - vy[at(column, row, field.columns)]) / dy
    }
  }
  return result
}

const maximumAbsolute = (values: Float64Array): number => {
  let maximum = 0
  for (const value of values) maximum = Math.max(maximum, Math.abs(value))
  return maximum
}

const enforceWalls = (field: FlowFieldState, vx: Float64Array, vy: Float64Array): void => {
  for (let row = 0; row < field.rows; row += 1) {
    vx[at(0, row, field.columns + 1)] = 0
    vx[at(field.columns, row, field.columns + 1)] = 0
  }
  for (let column = 0; column < field.columns; column += 1) {
    vy[at(column, 0, field.columns)] = 0
    vy[at(column, field.rows, field.columns)] = 0
  }
}

const advanceSubstep = (field: FlowFieldState, seconds: number, pumpPower: number): FlowFieldState => {
  const vx = new Float64Array(field.velocityX.length)
  const vy = new Float64Array(field.velocityY.length)
  const damping = Math.exp(-LINEAR_DAMPING_PER_SECOND * seconds)
  const componentLimit = MAXIMUM_SPEED_METERS_PER_SECOND / Math.SQRT2
  for (let row = 0; row < field.rows; row += 1) for (let column = 1; column < field.columns; column += 1) {
    const x = column / field.columns
    const y = (row + 0.5) / field.rows
    const local = sampleFlowField(field, x, y)
    const backX = x - (local.xMetersPerSecond * seconds) / field.widthMeters
    const backY = y - (local.yMetersPerSecond * seconds) / field.heightMeters
    const swirl = Math.exp(-3.8 * ((x - 0.52) ** 2 + (y - 0.5) ** 2))
    const jet = Math.exp(-80 * (x - 0.12) ** 2 - 55 * (y - 0.62) ** 2)
    const force = PUMP_ACCELERATION_METERS_PER_SECOND_SQUARED * pumpPower * (-(y - 0.5) * swirl + 0.55 * jet)
    vx[at(column, row, field.columns + 1)] = clamp(sampleFlowField(field, backX, backY).xMetersPerSecond * damping + force * seconds, -componentLimit, componentLimit)
  }
  for (let row = 1; row < field.rows; row += 1) for (let column = 0; column < field.columns; column += 1) {
    const x = (column + 0.5) / field.columns
    const y = row / field.rows
    const local = sampleFlowField(field, x, y)
    const backX = x - (local.xMetersPerSecond * seconds) / field.widthMeters
    const backY = y - (local.yMetersPerSecond * seconds) / field.heightMeters
    const swirl = Math.exp(-3.8 * ((x - 0.52) ** 2 + (y - 0.5) ** 2))
    const jet = Math.exp(-80 * (x - 0.12) ** 2 - 55 * (y - 0.62) ** 2)
    const force = PUMP_ACCELERATION_METERS_PER_SECOND_SQUARED * pumpPower * ((x - 0.52) * swirl - 0.18 * jet)
    vy[at(column, row, field.columns)] = clamp(sampleFlowField(field, backX, backY).yMetersPerSecond * damping + force * seconds, -componentLimit, componentLimit)
  }
  enforceWalls(field, vx, vy)
  const div = divergence(field, vx, vy)
  const rhs = div.map((value) => value / seconds)
  const dx2 = (field.widthMeters / field.columns) ** 2
  const dy2 = (field.heightMeters / field.rows) ** 2
  const denominator = 2 / dx2 + 2 / dy2
  let pressure = field.pressure.slice()
  for (let iteration = 0; iteration < field.pressureIterations; iteration += 1) {
    const next = new Float64Array(pressure.length)
    let mean = 0
    for (let row = 0; row < field.rows; row += 1) for (let column = 0; column < field.columns; column += 1) {
      const center = at(column, row, field.columns)
      const left = pressure[at(Math.max(0, column - 1), row, field.columns)]
      const right = pressure[at(Math.min(field.columns - 1, column + 1), row, field.columns)]
      const bottom = pressure[at(column, Math.max(0, row - 1), field.columns)]
      const top = pressure[at(column, Math.min(field.rows - 1, row + 1), field.columns)]
      next[center] = ((left + right) / dx2 + (bottom + top) / dy2 - rhs[center]) / denominator
      mean += next[center]
    }
    mean /= next.length
    for (let index = 0; index < next.length; index += 1) next[index] -= mean
    pressure = next
  }
  for (let row = 0; row < field.rows; row += 1) for (let column = 1; column < field.columns; column += 1) {
    const right = pressure[at(column, row, field.columns)]
    const left = pressure[at(column - 1, row, field.columns)]
    vx[at(column, row, field.columns + 1)] -= seconds * (right - left) / Math.sqrt(dx2)
  }
  for (let row = 1; row < field.rows; row += 1) for (let column = 0; column < field.columns; column += 1) {
    const top = pressure[at(column, row, field.columns)]
    const bottom = pressure[at(column, row - 1, field.columns)]
    vy[at(column, row, field.columns)] -= seconds * (top - bottom) / Math.sqrt(dy2)
  }
  enforceWalls(field, vx, vy)
  for (let index = 0; index < vx.length; index += 1) vx[index] = clamp(vx[index], -componentLimit, componentLimit)
  for (let index = 0; index < vy.length; index += 1) vy[index] = clamp(vy[index], -componentLimit, componentLimit)
  let residual = 0
  for (let row = 0; row < field.rows; row += 1) for (let column = 0; column < field.columns; column += 1) {
    const center = at(column, row, field.columns)
    const laplacian = (pressure[at(Math.max(0, column - 1), row, field.columns)] - 2 * pressure[center] + pressure[at(Math.min(field.columns - 1, column + 1), row, field.columns)]) / dx2 + (pressure[at(column, Math.max(0, row - 1), field.columns)] - 2 * pressure[center] + pressure[at(column, Math.min(field.rows - 1, row + 1), field.columns)]) / dy2
    residual = Math.max(residual, Math.abs(laplacian - rhs[center]))
  }
  return { ...field, velocityX: vx, velocityY: vy, pressure, divergenceBeforeProjection: maximumAbsolute(div), pressureResidual: residual }
}

export function stepFlowField(field: FlowFieldState, elapsedSeconds: number, pumpPower = 0.62): FlowFieldState {
  const boundedSeconds = clamp(finite(elapsedSeconds, 0), 0, MAXIMUM_ELAPSED_SECONDS)
  if (boundedSeconds === 0) return field
  const steps = Math.ceil(boundedSeconds / MAXIMUM_SUBSTEP_SECONDS)
  const seconds = boundedSeconds / steps
  let next = field
  for (let step = 0; step < steps; step += 1) next = advanceSubstep(next, seconds, clamp(finite(pumpPower, 0), 0, 1))
  return next
}

export function estimateFlowScalars(field: FlowFieldState): FlowScalarEstimate {
  let speedSum = 0
  let peakSpeed = 0
  let shearSum = 0
  let lowFlowCells = 0
  for (let row = 0; row < field.rows; row += 1) for (let column = 0; column < field.columns; column += 1) {
    const x = (column + 0.5) / field.columns
    const y = (row + 0.5) / field.rows
    const local = sampleFlowField(field, x, y)
    const left = sampleFlowField(field, x - 0.5 / field.columns, y)
    const right = sampleFlowField(field, x + 0.5 / field.columns, y)
    const bottom = sampleFlowField(field, x, y - 0.5 / field.rows)
    const top = sampleFlowField(field, x, y + 0.5 / field.rows)
    const shear = Math.hypot((right.yMetersPerSecond - left.yMetersPerSecond) * field.columns / field.widthMeters, (top.xMetersPerSecond - bottom.xMetersPerSecond) * field.rows / field.heightMeters)
    speedSum += local.speedMetersPerSecond
    peakSpeed = Math.max(peakSpeed, local.speedMetersPerSecond)
    shearSum += shear
    if (local.speedMetersPerSecond < LOW_FLOW_METERS_PER_SECOND) lowFlowCells += 1
  }
  const cells = field.columns * field.rows
  return { meanSpeedMetersPerSecond: speedSum / cells, peakSpeedMetersPerSecond: peakSpeed, meanShearPerSecond: shearSum / cells, lowFlowFraction: lowFlowCells / cells }
}

let cachedCanonicalPower: number | undefined
let cachedCanonicalEstimate: FlowScalarEstimate | undefined

/**
 * Settles one fixed balanced grid for 12 seconds, more than 3.8 linear-damping
 * time constants. The single-entry frozen cache bounds memory and preserves
 * identical numerical results when the physical pump power changes and returns.
 */
export function estimateCanonicalFlowRegime(flowPower: number): FlowScalarEstimate {
  const power = clamp(finite(flowPower, 0), 0, 1)
  if (power === cachedCanonicalPower && cachedCanonicalEstimate) return cachedCanonicalEstimate

  let field = createFlowField({ quality: 'balanced' })
  const steps = CANONICAL_REGIME_HORIZON_SECONDS / CANONICAL_REGIME_STEP_SECONDS
  for (let step = 0; step < steps; step += 1) {
    field = stepFlowField(field, CANONICAL_REGIME_STEP_SECONDS, power)
  }
  const estimate = Object.freeze(estimateFlowScalars(field))
  cachedCanonicalPower = power
  cachedCanonicalEstimate = estimate
  return estimate
}

export function diagnoseFlowField(field: FlowFieldState): FlowDiagnosis {
  return { columns: field.columns, rows: field.rows, ...estimateFlowScalars(field), maximumDivergence: maximumAbsolute(divergence(field, field.velocityX, field.velocityY)), divergenceBeforeProjection: field.divergenceBeforeProjection, pressureResidual: field.pressureResidual }
}
