import * as THREE from 'three'

export const REEF_SAND_Y = -1.44

export function seededUnit(index: number, salt = 0) {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453
  return value - Math.floor(value)
}

/** One shared live-rock layout drives both rendering and fish collision clearance.
 *  TODO(aquascaping): this fixed seeded layout is engine-owned. Player-authored
 *  aquascaping is a future system that would supply these rocks from saved state;
 *  it is intentionally out of scope here. */
export const REEF_ROCKS = Array.from({ length: 13 }, (_, index) => {
  const arc = (index / 12) * Math.PI * 1.74 + 0.16
  const radius = 0.66 + seededUnit(index, 1) * 1.12
  const side = index < 7 ? -0.62 : 0.82
  return {
    position: new THREE.Vector3(
      side + Math.cos(arc) * radius,
      REEF_SAND_Y + 0.22 + seededUnit(index, 2) * 0.4,
      Math.sin(arc) * 0.52 + (seededUnit(index, 3) - 0.5) * 0.42,
    ),
    rotation: new THREE.Euler(
      seededUnit(index, 4) * 0.45,
      seededUnit(index, 5) * Math.PI,
      (seededUnit(index, 6) - 0.5) * 0.48,
    ),
    scale: new THREE.Vector3(
      0.36 + seededUnit(index, 7) * 0.4,
      0.32 + seededUnit(index, 8) * 0.42,
      0.34 + seededUnit(index, 9) * 0.36,
    ),
  }
})

const ROCK_COLLISION_PAD = 1.2
const PELLET_ROUTE_CLEARANCE = 0.16
const PELLET_DEFLECTION_LEAD = 0.28
const PELLET_DEFLECTION_DEPTH = 0.42
const PELLET_HALF_WIDTH = 2.68
const PELLET_HALF_DEPTH = 1.08

/** Keep a falling pellet's authoritative depth while deterministically routing its scene
 *  x/z lane around the complete rock footprint. Once deflected, the route persists to
 *  the substrate so a pellet cannot pop back through the underside of the hardscape. */
export function resolveReefPelletPosition(position: THREE.Vector3, pelletId: number, clearance: number) {
  const sourceX = position.x
  const sourceZ = position.z
  let safeX = sourceX
  let safeZ = sourceZ
  let highestObstruction = -Infinity

  for (const rock of REEF_ROCKS) {
    const rx = rock.scale.x * ROCK_COLLISION_PAD + clearance
    const ry = rock.scale.y * ROCK_COLLISION_PAD + clearance
    const rz = rock.scale.z * ROCK_COLLISION_PAD + clearance
    const nx = (sourceX - rock.position.x) / rx
    const nz = (sourceZ - rock.position.z) / rz
    const horizontalDistanceSq = nx * nx + nz * nz
    if (horizontalDistanceSq < 1) {
      highestObstruction = Math.max(highestObstruction,
        rock.position.y + ry * Math.sqrt(1 - horizontalDistanceSq))
    }
  }

  // Find the nearest sampled substrate lane with enough room for a benthic fish
  // body to approach. The seeded spoke offset prevents every portion taking one path.
  const laneIsClear = (x: number, z: number) => REEF_ROCKS.every((rock) => {
    const nx = (x - rock.position.x) / (rock.scale.x * ROCK_COLLISION_PAD + PELLET_ROUTE_CLEARANCE)
    const nz = (z - rock.position.z) / (rock.scale.z * ROCK_COLLISION_PAD + PELLET_ROUTE_CLEARANCE)
    return nx * nx + nz * nz >= 1
  })
  routeSearch: if (!laneIsClear(safeX, safeZ)) {
    const angleOffset = seededUnit(pelletId, 91) * Math.PI * 2
    for (let ring = 1; ring <= 30; ring += 1) {
      const radius = ring * .12
      for (let spoke = 0; spoke < 24; spoke += 1) {
        const angle = angleOffset + spoke / 24 * Math.PI * 2
        const candidateX = THREE.MathUtils.clamp(sourceX + Math.cos(angle) * radius,
          -PELLET_HALF_WIDTH, PELLET_HALF_WIDTH)
        const candidateZ = THREE.MathUtils.clamp(sourceZ + Math.sin(angle) * radius,
          -PELLET_HALF_DEPTH, PELLET_HALF_DEPTH)
        if (!laneIsClear(candidateX, candidateZ)) continue
        safeX = candidateX
        safeZ = candidateZ
        break routeSearch
      }
    }
  }

  if (Number.isFinite(highestObstruction)) {
    const progress = THREE.MathUtils.smoothstep(
      highestObstruction + PELLET_DEFLECTION_LEAD - position.y,
      0,
      PELLET_DEFLECTION_DEPTH,
    )
    position.x = THREE.MathUtils.lerp(sourceX, safeX, progress)
    position.z = THREE.MathUtils.lerp(sourceZ, safeZ, progress)
  }

  // Preserve y exactly; any intermediate blend that enters a rock is moved sideways to
  // the closest cross-section edge rather than being projected upward or below it.
  for (let pass = 0; pass < 6; pass += 1) {
    for (const rock of REEF_ROCKS) {
      const rx = rock.scale.x * ROCK_COLLISION_PAD + clearance
      const ry = rock.scale.y * ROCK_COLLISION_PAD + clearance
      const rz = rock.scale.z * ROCK_COLLISION_PAD + clearance
      const ny = (position.y - rock.position.y) / ry
      if (Math.abs(ny) >= 1) continue
      let nx = (position.x - rock.position.x) / rx
      let nz = (position.z - rock.position.z) / rz
      let horizontalDistance = Math.sqrt(nx * nx + nz * nz)
      const requiredDistance = Math.sqrt(1 - ny * ny) + 1e-4
      if (horizontalDistance >= requiredDistance) continue
      if (horizontalDistance < 1e-5) {
        const angle = seededUnit(pelletId, 97) * Math.PI * 2
        nx = Math.cos(angle)
        nz = Math.sin(angle)
        horizontalDistance = 1
      }
      position.x = THREE.MathUtils.clamp(rock.position.x + nx / horizontalDistance * requiredDistance * rx,
        -PELLET_HALF_WIDTH, PELLET_HALF_WIDTH)
      position.z = THREE.MathUtils.clamp(rock.position.z + nz / horizontalDistance * requiredDistance * rz,
        -PELLET_HALF_DEPTH, PELLET_HALF_DEPTH)
    }
  }
}
