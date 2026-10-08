import type { Vec3, WizardTerrainCell } from './contracts'

const MAX_RADIUS_CELLS = 8

/** Stable row-major terrain window, bounded to 17 by 17 cells at the default radius. */
export function visibleTerrainCells(cells: readonly WizardTerrainCell[], player: Vec3, radiusCells = MAX_RADIUS_CELLS): WizardTerrainCell[] {
  if (cells.length === 0) return []
  const spacingX = cells[0].size[0]
  const spacingZ = cells[0].size[1]
  const radius = Math.max(0, Math.min(MAX_RADIUS_CELLS, Number.isFinite(radiusCells) ? Math.floor(radiusCells) : MAX_RADIUS_CELLS))
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const cell of cells) {
    const x = Math.round(cell.position[0] / spacingX)
    const z = Math.round(cell.position[2] / spacingZ)
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z)
  }
  const spanX = maxX - minX + 1
  const spanZ = maxZ - minZ + 1
  // Both existing Greenway profiles fit within 16 by 16. Keep their entire visible terrain at the default radius.
  const preserveGreenway = radius === MAX_RADIUS_CELLS && spanX <= 16 && spanZ <= 16
  const width = preserveGreenway ? spanX : Math.min(radius * 2 + 1, spanX)
  const depth = preserveGreenway ? spanZ : Math.min(radius * 2 + 1, spanZ)
  const startX = Math.max(minX, Math.min(Math.round(player[0] / spacingX) - radius, maxX - width + 1))
  const startZ = Math.max(minZ, Math.min(Math.round(player[2] / spacingZ) - radius, maxZ - depth + 1))
  const visible = new Map<string, { cell: WizardTerrainCell; x: number; z: number }>()
  for (const cell of cells) {
    const x = Math.round(cell.position[0] / spacingX)
    const z = Math.round(cell.position[2] / spacingZ)
    if (x < startX || x >= startX + width || z < startZ || z >= startZ + depth) continue
    const key = `${x}:${z}`
    const existing = visible.get(key)
    if (!existing || cell.id < existing.cell.id) visible.set(key, { cell, x, z })
  }
  return [...visible.values()].sort((a, b) => a.z - b.z || a.x - b.x).map(({ cell }) => cell)
}
