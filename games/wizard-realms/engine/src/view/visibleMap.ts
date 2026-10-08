/** A local atlas window, capped independently of the streamed world's total extent. */
export function visibleMapTiles<T extends { gridX: number; gridZ: number }>(
  tiles: readonly T[], playerGridX: number, playerGridZ: number, radiusCells = 16,
): T[] {
  if (tiles.length === 0) return []
  const radius = Math.max(0, Math.min(16, Number.isFinite(radiusCells) ? Math.floor(radiusCells) : 16))
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const tile of tiles) {
    minX = Math.min(minX, tile.gridX); maxX = Math.max(maxX, tile.gridX)
    minZ = Math.min(minZ, tile.gridZ); maxZ = Math.max(maxZ, tile.gridZ)
  }
  const width = Math.min(radius * 2 + 1, maxX - minX + 1)
  const depth = Math.min(radius * 2 + 1, maxZ - minZ + 1)
  const startX = Math.max(minX, Math.min(playerGridX - radius, maxX - width + 1))
  const startZ = Math.max(minZ, Math.min(playerGridZ - radius, maxZ - depth + 1))
  return tiles.filter((tile) => tile.gridX >= startX && tile.gridX < startX + width
    && tile.gridZ >= startZ && tile.gridZ < startZ + depth)
    .sort((a, b) => a.gridZ - b.gridZ || a.gridX - b.gridX)
}
