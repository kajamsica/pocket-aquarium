"""Zoanthus sp. colony: species-local `zoanthid_colony` body plan (build(spec, species, ctx)).

Anatomy (Zoantharia: Zoanthidae). Colonial polyps rise from a coenenchyme mat that encrusts rock.
Each polyp is a smooth cylindrical column topped by a flat, slightly overhanging oral disc with a
slit-like central mouth and a marginal fringe of short tapering tentacles in two alternating cycles.
Polyps close by drawing the disc margin over the mouth while the tentacles fold inward and the
column shortens (Gonzalez-Munoz et al. 2016; Alvarez et al. 2021; see source-references.json).

Construction (source space: meters, +X forward, +Z up, origin base_center, rock on z = 0):
- rock: one closed loft of horizontal rings with a flattened-superellipsoid profile, an even-harmonic
  lumpy outline whose x extent equals referenceSize (colony width, axis xy), and value-noise relief on
  the dome. The coenenchyme is modelled into the same loft: a raised plateau with a soft lip over the
  dome plus a gaussian collar mound around every polyp base, so the mat visibly connects the columns.
  Painted as grey rock with coralline algae below and coenenchyme tissue on the plateau.
- polyps: N (14 to 22) individually parameterised closed lofts (buried base ring -> column -> flared
  underside -> disc rim -> gently domed disc -> elongated mouth ring -> cap). Positions come from a
  dense seeded, jittered hexagonal lattice accepted centre-out under the gate-derived spacing rule
  (no disc overlap, flattest tentacle reach off the neighbour's disc, height-scaled sway margin);
  disc radius, column radius, tilt, tentacle count and mouth orientation are seeded per polyp. Column
  height is 0.6 to 0.85 disc diameters in the mat centre and up to ~1.2 at the edge, so the colony sits
  low and crowded; edge polyps lean outward and a few interior polyps lean noticeably.
- tentacles: per polyp one open-shell part of 20 to 24 tapered 4-sided tubes rooted in the disc rim,
  alternating inner (steeper) and outer (flatter) cycles, tips curling upward.
- rig: Root (non-deform) -> Base (deform, static; the rock is skinned to it) -> Polyp_NN (one deform bone
  per polyp, head at the mat surface). Each polyp is its own mesh object parented to its bone (bone
  parenting, no armature modifier) so it sways rigidly about its base and can carry shape keys: Blender's
  glTF importer splits any skinned mesh that has morph-target animation into an empty plus a renamed
  mesh, which the shared import-parity gate rejects, whereas bone-parented objects round-trip intact.
- shape keys per polyp object: `close` (disc margin closes over the mouth into a bud, tentacles fold
  inward) and `spread` (tentacle fringe flattens outward).
- clips: `open` (idle) and `flow` (locomotion) are integer-frequency loops of per-polyp bone sway with
  non-identical phase plus a per-cluster tentacle spread pulse; `close` (response) is a staggered
  per-cluster pulse of the close keys with bone scale shortening the column and a small flinch toward
  the colony centre, starting and ending at the neutral pose.
- glTF: shape-key clips are also placed on muted NLA tracks of the Key datablocks because the exporter's
  ACTIONS mode only collects shape-key animation from the active action or NLA strips; the muted tracks
  never evaluate, so validation and previews only see the active action.

Everything is derived from asset.source.json with seeded hashes; no random, time or set ordering.
"""

from __future__ import annotations

import math

import numpy as np
from mathutils import Matrix, Vector

from ..lib import materials as mat
from ..lib import meshing as msh
from ..lib import noise, paint, textures
from ..lib.animation import Channel, ClipSpec, bake_clip, shape_key_target
from ..lib.contract import BuildResult, base_contract, register_clips
from ..lib.rigging import RigBuilder

MM = 0.001
TENTACLE_SEGMENTS = 4
POLYP_U = (0.0, 0.06, 0.22, 0.36, 0.48, 0.56, 0.62, 0.73, 0.85, 0.94)


# ---------------------------------------------------------------- deterministic helpers

def _h(*values, seed: int = 0) -> float:
    return noise.scalar_hash(*values, seed=seed)


def _lerp(a, b, t):
    return a + (b - a) * t


def _range(pair, t: float) -> float:
    return _lerp(float(pair[0]), float(pair[1]), t)


def _smooth(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def _noise2(x: float, y: float, scale: float, seed: int, octaves: int = 3) -> float:
    return float(noise.fbm(np.array([x / scale]), np.array([y / scale]), octaves=octaves, seed=seed)[0])


def _periodic(fn, U, V, blend_start: float = 0.88):
    """Make a (U, V) noise field continuous across the V = 0 / V = 1 loft seam."""
    a = fn(U, V)
    b = fn(U, V - 1.0)
    w = noise.smoothstep(blend_start, 1.0, V)
    return a * (1.0 - w) + b * w


def _merge(geometries):
    vertices, faces, uvs, face_uvs = [], [], [], []
    for verts, fcs, uv, fuv in geometries:
        offset = len(vertices)
        vertices.extend(verts)
        faces.extend(tuple(i + offset for i in face) for face in fcs)
        uvs.extend(uv)
        if fuv:
            face_uvs.extend(fuv)
        else:
            face_uvs.extend(tuple(uv[i] for i in face) for face in fcs)
    return vertices, faces, uvs, face_uvs


# ---------------------------------------------------------------- rock

class Rock:
    """Flattened superellipsoid mound: vertical flanks, broad dome, even-harmonic lumpy outline."""

    def __init__(self, cfg: dict, half_width: float, seed: int):
        self.height = float(cfg["height"])
        self.exponent = float(cfg.get("profileExponent", 2.4))
        self.aspect_y = float(cfg.get("aspectY", 0.82))
        self.lump = float(cfg.get("lumpiness", 0.08))
        self.bump_amp = float(cfg.get("bumpAmplitude", 0.0012))
        self.bump_scale = float(cfg.get("bumpScale", 0.02))
        self.segments = int(cfg.get("segments", 40))
        self.levels = [float(v) for v in cfg.get("levels", [0.0, 0.06, 0.16, 0.30, 0.45, 0.60, 0.72, 0.82, 0.90, 0.955, 0.985])]
        # coenenchyme: a raised pad with a soft lip over the dome, plus a collar mound around every polyp base
        self.plateau_height = float(cfg.get("plateauHeight", 0.0))
        self.plateau_range = [float(v) for v in cfg.get("plateauRange", [0.52, 0.70])]
        self.crown_height = float(cfg.get("crownHeight", 0.0))
        self.mound_height = float(cfg.get("moundHeight", 0.0))
        self.mound_sigma = float(cfg.get("moundSigmaFactor", 1.9))
        self.mounds: list[tuple[float, float, float]] = []  # (x, y, column radius)
        self.seed = seed
        self.phases = [math.tau * _h(k, seed=seed + 101) for k in range(3)]
        samples = 1440
        xs = [self._raw_outline(math.tau * k / samples) * math.cos(math.tau * k / samples) for k in range(samples)]
        self.scale = 2.0 * half_width / (max(xs) - min(xs))

    def _raw_outline(self, theta: float) -> float:
        c, s = math.cos(theta), math.sin(theta)
        ellipse = 1.0 / math.sqrt(c * c + (s / self.aspect_y) ** 2)
        # even harmonics only keep the outline centrally symmetric, so the footprint stays centred on x = y = 0
        lumps = 1.0 + self.lump * (0.55 * math.sin(2 * theta + self.phases[0]) + 0.30 * math.sin(4 * theta + self.phases[1])
                                   + 0.15 * math.sin(6 * theta + self.phases[2]))
        return ellipse * lumps

    def outline(self, theta: float) -> float:
        return self.scale * self._raw_outline(theta)

    def profile(self, f: float) -> float:
        f = min(max(f, 0.0), 1.0)
        return (1.0 - f ** self.exponent) ** (1.0 / self.exponent)

    def ramp(self, f: float) -> float:
        return max(f, 0.0) ** 0.6

    def bump(self, x: float, y: float) -> float:
        return self.bump_amp * (2.0 * _noise2(x, y, self.bump_scale, self.seed + 7) - 1.0)

    def plateau(self, f: float) -> float:
        lo, hi = self.plateau_range
        return self.plateau_height * _smooth((f - lo) / max(hi - lo, 1e-9))

    def mound(self, x: float, y: float) -> float:
        total = 0.0
        for mx, my, column in self.mounds:
            sigma = self.mound_sigma * column
            d2 = ((x - mx) ** 2 + (y - my) ** 2) / (sigma * sigma)
            if d2 < 12.0:
                total += self.mound_height * math.exp(-d2)
        return total

    def relief(self, x: float, y: float, f: float) -> float:
        # the tissue pad smooths the bare-rock relief underneath it, so the collar mounds read on a calm surface
        lo, hi = self.plateau_range
        calm = 1.0 - 0.75 * _smooth((f - lo) / max(hi - lo, 1e-9))
        # a gentle crown keeps the pad centre convex, so collar mounds never leave a crater between them
        crown = self.crown_height * f ** 4
        return self.height * f + self.plateau(f) + crown + self.bump(x, y) * self.ramp(f) * calm + self.mound(x, y) * self.ramp(f)

    def surface_z(self, x: float, y: float) -> float:
        r = math.hypot(x, y)
        theta = math.atan2(y, x)
        s = r / self.outline(theta)
        if s >= 1.0:
            return 0.0
        f = (1.0 - s ** self.exponent) ** (1.0 / self.exponent)
        return self.relief(x, y, f)

    def ring(self, f: float):
        out = []
        for k in range(self.segments):
            theta = math.tau * k / self.segments
            r = self.outline(theta) * self.profile(f)
            x, y = r * math.cos(theta), r * math.sin(theta)
            out.append((x, y, self.relief(x, y, f)))
        return out

    def geometry(self):
        rings = [self.ring(f) for f in self.levels]
        vertices, faces, uvs, face_uvs = msh.loft(rings, u_values=list(self.levels), cap_start=True, cap_end=True)
        # the loft's centre-fan caps collapse to a UV line (u constant), which leaves the cap faces without a
        # tangent frame and renders them dark; remap each cap onto a small UV disc inside the uniform pole band
        n = self.segments
        face_uvs = list(face_uvs)
        for cap, u_center in ((0, 0.010), (1, 0.992)):
            start = len(faces) - (2 - cap) * n
            for k in range(n):
                theta_a = math.tau * k / n
                theta_b = math.tau * (k + 1) / n
                corner_a = (u_center + 0.007 * math.cos(theta_a), 0.5 + 0.007 * math.sin(theta_a))
                corner_b = (u_center + 0.007 * math.cos(theta_b), 0.5 + 0.007 * math.sin(theta_b))
                center = (u_center, 0.5)
                # the start cap winds (centre, next, this) and the end cap (centre, this, next)
                face_uvs[start + k] = (center, corner_b, corner_a) if cap == 0 else (center, corner_a, corner_b)
        return vertices, faces, uvs, face_uvs


# ---------------------------------------------------------------- polyp layout

def _anchor(rock: Rock, x: float, y: float, column: float) -> tuple[Vector, float]:
    """Anchor ring height and buried depth for a column footprint on the (mat-relieved) rock surface.

    The buried ring sits below the lowest point under the footprint, the anchor ring above the highest,
    so the column always emerges from (never floats over) the mat.
    """
    probe = column * 1.6
    heights = [rock.surface_z(x + probe * math.cos(math.tau * k / 10), y + probe * math.sin(math.tau * k / 10)) for k in range(10)]
    heights.append(rock.surface_z(x, y))
    z_low, z_high = min(heights), max(heights)
    return Vector((x, y, z_high + 0.9 * MM)), (z_high - z_low) + 3.0 * MM


def _polyp_triangles(pcfg: dict, tentacles: int) -> int:
    segments = int(pcfg.get("segments", 12))
    return 20 * segments + tentacles * 24


def _layout(colony: dict, rock: Rock, half_width: float, seed: int) -> list[dict]:
    """Crowded mat packing: dense jittered hex candidates, accepted centre-out under a gate-derived spacing rule.

    Column height scales with the disc diameter (0.6 to 0.85 diameters in the mat centre, up to ~1.2 at the
    edge where polyps reach for light), so the discs sit low and read as one continuous carpet. The spacing
    rule is only what the clearance gates need: neighbouring discs may not overlap, the flattest tentacle
    reach of either polyp must stay off the other's disc, plus a sway margin proportional to both heights.
    """
    pcfg = colony["polyp"]
    scfg = colony["spacing"]
    lattice = float(scfg["lattice"])
    jitter = float(scfg["jitter"])
    margin_base = float(scfg.get("marginBase", 0.0005))
    margin_per_height = float(scfg.get("marginPerHeight", 0.06))
    frac = float(scfg["footprintFraction"])
    elev0 = math.radians(float(pcfg.get("tentacleElevationDegrees", 32.0)))
    spread_drop = math.radians(float(pcfg.get("spreadElevationDrop", 14.0)))
    edge_lean = math.radians(float(pcfg.get("edgeLeanDegrees", 11.0)))
    random_tilt = math.radians(float(pcfg.get("randomTiltDegrees", 3.5)))
    edge_boost = float(pcfg.get("edgeHeightBoost", 0.45))
    rotation = math.tau / 6 * _h(1, seed=seed + 3)
    cos_r, sin_r = math.cos(rotation), math.sin(rotation)

    candidates = []
    span = int(math.ceil(half_width / lattice)) + 2
    for row in range(-span, span + 1):
        for col in range(-span, span + 1):
            gx = (col + 0.5 * (row % 2)) * lattice
            gy = row * lattice * math.sqrt(3.0) / 2.0
            x = gx * cos_r - gy * sin_r + (2.0 * _h(row, col, 1, seed=seed) - 1.0) * jitter
            y = gx * sin_r + gy * cos_r + (2.0 * _h(row, col, 2, seed=seed) - 1.0) * jitter
            r = math.hypot(x, y)
            theta = math.atan2(y, x)
            limit = frac * rock.outline(theta)
            if r > limit:
                continue
            candidates.append((round(r, 9), row, col, x, y, r / max(limit, 1e-9), theta))
    candidates.sort()

    accepted: list[dict] = []
    for _r, row, col, x, y, edge, theta in candidates:
        if len(accepted) >= int(colony.get("maxPolyps", 17)):
            break
        disc_min, disc_max = (float(v) for v in pcfg["discRadius"])
        disc_wanted = _range(pcfg["discRadius"], _h(row, col, 3, seed=seed))
        column_fraction = _range(pcfg["columnRadiusFraction"], _h(row, col, 4, seed=seed))
        edge_f = _smooth((edge - 0.55) / 0.45)
        height_fraction = _range(pcfg["heightFraction"], _h(row, col, 5, seed=seed)) * (1.0 + edge_boost * edge_f)
        tentacles = int(round(_range(pcfg["tentacles"], _h(row, col, 6, seed=seed)) / 2.0)) * 2
        tentacle_fraction = _range(pcfg["tentacleLengthFraction"], _h(row, col, 7, seed=seed))
        # squared hash: most polyps stand nearly upright, a few lean noticeably
        lean = edge_lean * _smooth((edge - 0.4) / 0.6) + random_tilt * _h(row, col, 8, seed=seed) ** 2
        azimuth = theta + (2.0 * _h(row, col, 9, seed=seed) - 1.0) * math.radians(28.0)
        if edge < 0.35:
            azimuth = math.tau * _h(row, col, 9, seed=seed)
        axis = Vector((math.sin(lean) * math.cos(azimuth), math.sin(lean) * math.sin(azimuth), math.cos(lean)))
        # horizontal reach of the longest tentacle in its flattest pose (outer cycle, spread key, elevation
        # jitter), as a fraction of the disc radius; the sway margin also scales with (disc-proportional) height
        flattest = max(elev0 - math.radians(6.0) - spread_drop - math.radians(5.0), 0.0)
        reach_k = tentacle_fraction * 1.15 * 1.06 * math.cos(flattest)
        sway_q = 1.0 + 2.0 * margin_per_height * height_fraction

        def fit(disc: float):
            """Anchor, disc centre and the largest disc radius the neighbours and footprint still allow."""
            column = disc * column_fraction
            # provisional anchor on the bare mat; the collar mounds are added after the layout is fixed and only move z
            anchor, embed = _anchor(rock, x, y, column)
            height = 2.0 * disc * height_fraction
            center = anchor + axis * height
            allowed = disc_max
            for extent in (abs(center.x), abs(center.y)):
                allowed = min(allowed, (half_width - 0.3 * MM - extent) / (1.0 + reach_k))
            for other in accepted:
                distance = math.hypot(center.x - other["discCenter"].x, center.y - other["discCenter"].y)
                # sway margin: both polyps rotate about their anchors, so relative disc travel scales with both heights
                room = distance - other["disc"] - margin_base - margin_per_height * (other["height"] + 2.0 * MM)
                if reach_k * room / (sway_q + reach_k) >= other["reach"]:
                    allowed = min(allowed, room / (sway_q + reach_k))
                else:
                    allowed = min(allowed, (room - other["reach"]) / sway_q)
            return anchor, embed, column, height, center, allowed

        # discs shrink to fill whatever gap the neighbours leave (crowded mat), down to the range minimum;
        # the centre shifts slightly with the disc (lean * height), so settle in a couple of passes
        disc = disc_wanted
        ok = False
        for _pass in range(4):
            anchor, embed, column, height, disc_center, allowed = fit(disc)
            if allowed < disc_min:
                break
            if disc <= allowed + 1e-9:
                ok = True
                break
            disc = allowed
        if not ok:
            continue
        e1 = axis.cross(Vector((1.0, 0.0, 0.0))).normalized()
        e2 = axis.cross(e1).normalized()
        accepted.append({
            "row": row, "col": col, "x": x, "y": y, "edge": edge, "anchor": anchor, "axis": axis, "e1": e1, "e2": e2,
            "disc": disc, "column": column, "height": height, "embed": embed, "tentacles": tentacles,
            "tentacleLength": disc * tentacle_fraction, "reach": disc * reach_k, "discCenter": disc_center,
            "mouthAngle": math.tau * _h(row, col, 10, seed=seed),
            "scale": disc / (4.0 * MM),
        })
    # triangle guard: candidates were accepted centre-out, so trimming the tail drops the outermost polyps first
    guard = int(colony.get("triangleGuard", 19500))
    rock_triangles = (len(rock.levels) - 1) * rock.segments * 2 + 2 * rock.segments
    while accepted and rock_triangles + sum(_polyp_triangles(pcfg, p["tentacles"]) for p in accepted) > guard:
        accepted.pop()
    minimum = int(colony.get("minPolyps", 12))
    if len(accepted) < minimum:
        raise ValueError(f"Only {len(accepted)} polyps fit the colony footprint (minimum {minimum}); loosen spacing or sizes")
    accepted.sort(key=lambda p: (round(p["x"], 9), round(p["y"], 9)))
    clusters = int(colony.get("clusters", 5))
    count = len(accepted)
    for index, polyp in enumerate(accepted):
        polyp["index"] = index
        polyp["name"] = f"{index:02d}"
        polyp["bone"] = f"Polyp_{index:02d}"
        polyp["cluster"] = min(int(index * clusters / count), clusters - 1)
    return accepted


# ---------------------------------------------------------------- polyp geometry

def _polyp_rings(P: dict, segments: int, closed: float):
    """Rings of the column + disc loft at a given closure (0 = open rest pose, 1 = closed bud)."""
    anchor, axis, e1, e2 = P["anchor"], P["axis"], P["e1"], P["e2"]
    rc, rd, h, s = P["column"], P["disc"], P["height"], P["scale"]
    c = closed
    mm = MM * s

    def ring(t: float, radius: float, elongate=None):
        points = []
        for k in range(segments):
            phi = math.tau * k / segments
            rr = radius
            if elongate is not None:
                angle, along, across = elongate
                ca, sa = math.cos(phi - angle), math.sin(phi - angle)
                rr = radius / math.sqrt((ca / along) ** 2 + (sa / across) ** 2)
            point = anchor + axis * t + (e1 * math.cos(phi) + e2 * math.sin(phi)) * rr
            points.append((point.x, point.y, point.z))
        return points

    stations = [
        (-P["embed"], rc * 0.98, None),
        (0.0, rc, None),
        (0.30 * h, rc * 1.00, None),
        (0.58 * h, rc * 1.02, None),
        (0.82 * h, rc * 1.06, None),
        (0.92 * h, _lerp(rc * 1.30, rc * 1.12, c), None),
        (h + _lerp(0.0, 0.30 * mm, c), _lerp(rd, rc * 1.22, c), None),
        (h + _lerp(0.30 * mm, 1.10 * mm, c), _lerp(rd * 0.78, rc * 0.90, c), None),
        (h + _lerp(0.42 * mm, 1.60 * mm, c), _lerp(rd * 0.48, rc * 0.52, c), None),
        (h + _lerp(0.20 * mm, 1.85 * mm, c), _lerp(rd * 0.17, rc * 0.16, c), (P["mouthAngle"], 1.7, 0.6)),
    ]
    return [ring(t, radius, elongate) for t, radius, elongate in stations]


def _polyp_geometry(P: dict, segments: int, closed: float):
    return msh.loft(_polyp_rings(P, segments, closed), u_values=list(POLYP_U), cap_start=True, cap_end=True)


def _parent_to_bone(obj, rig, bone_name: str):
    """Bone-parent an object authored in world space without moving it (Blender attaches at the bone tail)."""
    bone = rig.data.bones[bone_name]
    obj.parent = rig
    obj.parent_type = "BONE"
    obj.parent_bone = bone_name
    parent_matrix = rig.matrix_world @ bone.matrix_local @ Matrix.Translation((0.0, bone.length, 0.0))
    obj.matrix_parent_inverse = parent_matrix.inverted()


def _tentacle_geometry(P: dict, pcfg: dict, closed: float, spread: float, seed: int):
    anchor, axis, e1, e2 = P["anchor"], P["axis"], P["e1"], P["e2"]
    rc, rd, h, s = P["column"], P["disc"], P["height"], P["scale"]
    mm = MM * s
    n = P["tentacles"]
    elev0 = math.radians(float(pcfg.get("tentacleElevationDegrees", 32.0)))
    elev_closed = math.radians(float(pcfg.get("closedElevationDegrees", 70.0)))
    spread_drop = math.radians(float(pcfg.get("spreadElevationDrop", 14.0)))
    radius0 = float(pcfg.get("tentacleRadius", 0.0004)) * s
    pieces = []
    for k in range(n):
        outer = k % 2 == 0
        jitter = (_h(P["row"], P["col"], 20 + k, seed=seed) - 0.5) * 0.30
        phi = math.tau * (k + jitter) / n
        out = e1 * math.cos(phi) + e2 * math.sin(phi)
        side = e2 * math.cos(phi) - e1 * math.sin(phi)
        elev_rest = elev0 + math.radians(-6.0 if outer else 7.0) + math.radians(5.0) * (_h(P["row"], P["col"], 60 + k, seed=seed) - 0.5) * 2.0
        elev = _lerp(elev_rest, elev_rest - spread_drop, spread)
        base_t = _lerp(h + (0.05 if outer else 0.22) * mm, h + (0.30 if outer else 0.45) * mm, closed)
        base_r = _lerp(rd * (0.99 if outer else 0.92), rc * 1.22 * (0.99 if outer else 0.92), closed)
        length = P["tentacleLength"] * (0.85 + 0.30 * _h(P["row"], P["col"], 100 + k, seed=seed)) * (1.0 + 0.06 * spread) * (1.0 - 0.08 * closed)
        direction_rest = out * math.cos(elev) + axis * math.sin(elev)
        direction_closed = -out * math.cos(elev_closed) + axis * math.sin(elev_closed)
        direction = direction_rest.lerp(direction_closed, closed).normalized()
        curl = (axis * (length * 0.30)).lerp(-out * (length * 0.15), closed)
        base = anchor + axis * base_t + out * base_r
        points = []
        for sv in (-0.14, 0.45, 1.0):
            point = base + direction * (length * sv) + curl * (sv * sv)
            points.append((point.x, point.y, point.z))
        radius = radius0 * (0.9 + 0.2 * _h(P["row"], P["col"], 140 + k, seed=seed))
        pieces.append(msh.tube(points, [radius, radius * 0.8, radius * 0.28], TENTACLE_SEGMENTS, up_hint=(side.x, side.y, side.z)))
    return _merge(pieces)


def _tint(P: dict, seed: int):
    warm = _h(P["row"], P["col"], 200, seed=seed)
    value = 0.86 + 0.14 * _h(P["row"], P["col"], 201, seed=seed)
    color = (value * (1.0 - 0.10 * warm), value * (1.0 - 0.06 * abs(warm - 0.5) * 2.0), value * (1.0 - 0.10 * (1.0 - warm)), 1.0)

    def color_fn(_index, _vertex):
        return color

    return color_fn


# ---------------------------------------------------------------- textures

def _paint_rock(palette: dict, shape, seed: int):
    height_px, width_px = shape
    U, V = textures.uv_grid(width_px, height_px)  # U = height fraction (0 base, 1 top), V = angle
    grain = _periodic(lambda u, v: noise.fbm(u * 6.0, v * 42.0, octaves=4, seed=seed + 21), U, V)
    blotch = _periodic(lambda u, v: noise.fbm(u * 5.0, v * 36.0, octaves=3, seed=seed + 23), U, V)
    pit_distance = _periodic(lambda u, v: noise.cells(u * 22.0, v * 160.0, seed=seed + 25)[0], U, V)
    pits = (1.0 - noise.smoothstep(0.08, 0.26, pit_distance)) * noise.smoothstep(0.35, 0.65, grain)
    wobble = _periodic(lambda u, v: noise.fbm(u * 1.0, v * 9.0, octaves=2, seed=seed + 27), U, V)
    # the painted mat edge tracks the raised plateau lip (rock.plateauRange midpoint) with a little wobble
    mat_edge = 0.60 + 0.04 * (wobble - 0.5) * 2.0
    mat_mask = noise.smoothstep(mat_edge - 0.035, mat_edge + 0.035, U)
    speckle = _periodic(lambda u, v: noise.fbm(u * 14.0, v * 90.0, octaves=2, seed=seed + 29), U, V)

    rock = textures.rgba(palette["rock"], 1.0, U.shape)
    rock = textures.scale_rgb(rock, 0.80 + 0.40 * grain)
    rock = textures.mix(rock, palette["rockDark"], pits * 0.40)
    coralline_mask = noise.smoothstep(0.58, 0.66, blotch) * noise.smoothstep(0.03, 0.12, U) * (1.0 - mat_mask)
    rock = textures.mix(rock, palette["coralline"], coralline_mask * (0.35 + 0.25 * grain))
    pale = noise.smoothstep(0.58, 0.68, _periodic(lambda u, v: noise.fbm(u * 3.0, v * 20.0, octaves=2, seed=seed + 26), U, V))
    rock = textures.mix(rock, (0.46, 0.44, 0.42), pale * 0.45 * (1.0 - coralline_mask))
    # the top cap is a UV pole (all V converge), so damp the V-dependent detail toward u = 1 to avoid pinwheel streaks
    pole = 1.0 - noise.smoothstep(0.90, 0.985, U)
    mat_color = textures.rgba(palette["mat"], 1.0, U.shape)
    mat_color = textures.scale_rgb(mat_color, 1.0 + (0.30 * grain - 0.15) * pole)
    speckle_mask = noise.smoothstep(0.62, 0.72, speckle) * 0.7
    # at the pole use the mean speckle coverage so the cap matches the surrounding mat in brightness
    mat_color = textures.mix(mat_color, palette["matLight"], speckle_mask * pole + float(np.mean(speckle_mask)) * (1.0 - pole))
    albedo = textures.mix(rock, mat_color, mat_mask)

    roughness = (0.88 - 0.10 * grain + 0.06 * pits) * (1.0 - mat_mask) + (0.60 - 0.08 * speckle * pole) * mat_mask
    height = ((0.5 + 0.28 * (grain - 0.5) - 0.40 * pits) * (1.0 - mat_mask)
              + (0.5 + (0.14 * (speckle - 0.5) + 0.05 * (grain - 0.5)) * pole) * mat_mask)
    return albedo, textures.grey(roughness), np.clip(height, 0.0, 1.0)


def _paint_polyp(palette: dict, shape, seed: int):
    height_px, width_px = shape
    U, V = textures.uv_grid(width_px, height_px)  # U along the polyp (0 buried base, 0.62 rim, 0.94 mouth), V around
    grain = _periodic(lambda u, v: noise.fbm(u * 10.0, v * 18.0, octaves=3, seed=seed + 31), U, V)
    wobble = _periodic(lambda u, v: noise.fbm(u * 2.0, v * 6.0, octaves=2, seed=seed + 33), U, V)
    w = (wobble - 0.5) * 0.02
    rays = paint.rays(V, 18.0, 3.0)
    rays_fine = paint.rays(V, 36.0, 5.0)
    speck = paint.spots(U * 0.6, V, density=26.0, radius=0.22, seed=seed + 35)

    column = textures.rgba(palette["column"], 1.0, U.shape)
    column = textures.scale_rgb(column, 0.86 + 0.28 * grain)
    column = textures.mix(column, palette["columnBase"], 1.0 - noise.smoothstep(0.02, 0.30, U))
    ring = textures.rgba(palette["discRing"], 1.0, U.shape)
    ring = textures.scale_rgb(ring, 0.82 + 0.30 * rays + 0.10 * (grain - 0.5))
    field = textures.rgba(palette["discField"], 1.0, U.shape)
    field = textures.mix(field, palette["discRay"], rays * (0.35 + 0.45 * (1.0 - noise.smoothstep(0.74, 0.86, U))))
    field = textures.mix(field, palette["discRay"], speck * 0.35)
    field = textures.scale_rgb(field, 0.90 + 0.20 * grain)
    center = textures.rgba(palette["discCenter"], 1.0, U.shape)
    center = textures.scale_rgb(center, 0.88 + 0.24 * grain + 0.10 * rays_fine)
    mouth = textures.rgba(palette["mouth"], 1.0, U.shape)

    albedo = column
    albedo = textures.mix(albedo, ring, noise.smoothstep(0.612 + w, 0.635 + w, U))
    albedo = textures.mix(albedo, field, noise.smoothstep(0.705 + w, 0.745 + w, U))
    albedo = textures.mix(albedo, center, noise.smoothstep(0.855 + w, 0.885 + w, U))
    albedo = textures.mix(albedo, mouth, noise.smoothstep(0.922, 0.942, U))

    disc_mask = noise.smoothstep(0.58, 0.64, U)
    mouth_mask = noise.smoothstep(0.92, 0.94, U)
    roughness = 0.48 * (1.0 - disc_mask) + 0.36 * disc_mask + 0.18 * mouth_mask - 0.06 * (grain - 0.5)
    ridge_zone = noise.smoothstep(0.62, 0.70, U) * (1.0 - noise.smoothstep(0.86, 0.92, U))
    height = 0.5 + 0.10 * (grain - 0.5) * (1.0 - disc_mask) + 0.22 * (rays - 0.5) * ridge_zone + 0.08 * (rays_fine - 0.5) * disc_mask - 0.25 * mouth_mask
    return albedo, textures.grey(roughness), np.clip(height, 0.0, 1.0)


def _paint_tentacle(palette: dict, shape, seed: int):
    height_px, width_px = shape
    U, V = textures.uv_grid(width_px, height_px)  # U along the tentacle (0 base, 1 tip)
    grain = _periodic(lambda u, v: noise.fbm(u * 9.0, v * 3.0, octaves=3, seed=seed + 41), U, V)
    albedo = textures.rgba(palette["tentacle"], 1.0, U.shape)
    albedo = textures.scale_rgb(albedo, 0.86 + 0.28 * grain)
    albedo = textures.mix(albedo, palette["column"], (1.0 - noise.smoothstep(0.0, 0.22, U)) * 0.45)
    albedo = textures.mix(albedo, palette["tentacleTip"], noise.smoothstep(0.52, 0.92, U) * (0.85 + 0.15 * grain))
    roughness = 0.44 - 0.08 * noise.smoothstep(0.5, 1.0, U) + 0.06 * (grain - 0.5)
    height = 0.5 + 0.16 * (grain - 0.5)
    return albedo, textures.grey(roughness), np.clip(height, 0.0, 1.0)


def _write_set(ctx, prefix: str, stem: str, albedo, roughness, height, normal_strength: float, written: list):
    images = {}
    for key, pixels, non_color in (("albedo", albedo, False), ("roughness", roughness, True),
                                   ("normal", textures.normal_from_height(height, normal_strength), True)):
        path = ctx.texture_dir / f"{stem}-{key}.png"
        images[key] = textures.write_image(f"{prefix}_{stem.capitalize()}_{key}", path, pixels, non_color)
        written.append(path)
    return images


# ---------------------------------------------------------------- shape keys and export tracks

def _add_shape_keys(obj, parts, targets: dict[str, dict[int, list]]):
    """targets: key name -> {part index: full vertex list for that part in the target pose}."""
    offsets = []
    offset = 0
    for part in parts:
        offsets.append(offset)
        offset += len(part.vertices)
    obj.shape_key_add(name="Basis", from_mix=False)
    for key_name in sorted(targets):
        block = obj.shape_key_add(name=key_name, from_mix=False)
        block.slider_min = 0.0
        block.slider_max = 1.0
        block.value = 0.0
        for part_index, vertices in sorted(targets[key_name].items()):
            base = offsets[part_index]
            for j, vertex in enumerate(vertices):
                block.data[base + j].co = vertex


def _stash_key_clips(obj, actions_by_clip: dict[str, object], clip_names: list[str]):
    """Muted NLA strips on the Key datablock so the glTF exporter (ACTIONS mode) collects the shape-key channels."""
    key = obj.data.shape_keys
    if key is None or key.animation_data is None:
        return
    for clip_name in sorted(clip_names):
        action = actions_by_clip[clip_name]
        slot = next((s for s in action.slots if s.target_id_type == "KEY"), None)
        if slot is None:
            continue
        track = key.animation_data.nla_tracks.new()
        track.name = f"glb_{clip_name}"
        strip = track.strips.new(clip_name, 1, action)
        strip.action_slot = slot
        track.mute = True


# ---------------------------------------------------------------- build

def build(spec: dict, species, ctx) -> BuildResult:
    prefix = ctx.prefix
    colony = spec["colony"]
    seed = int(colony.get("seed", 1))
    palette = spec["palette"]
    tex = spec.get("textures", {})
    half_width = float(spec["referenceSize"]["meters"]) / 2.0
    pcfg = colony["polyp"]
    segments = int(pcfg.get("segments", 14))

    rock = Rock(colony["rock"], half_width, seed)
    polyps = _layout(colony, rock, half_width, seed)
    # the coenenchyme collars follow the fixed layout; re-anchor every column on the relieved mat
    rock.mounds = [(P["x"], P["y"], P["column"]) for P in polyps]
    for P in polyps:
        P["anchor"], P["embed"] = _anchor(rock, P["x"], P["y"], P["column"])
        P["discCenter"] = P["anchor"] + P["axis"] * P["height"]
    clusters = sorted({p["cluster"] for p in polyps})

    # ---- textures and materials
    written: list = []
    rock_w, rock_h = tex.get("rockResolution", [256, 1024])
    polyp_w, polyp_h = tex.get("polypResolution", [512, 512])
    tent_w, tent_h = tex.get("tentacleResolution", [256, 64])
    rock_images = _write_set(ctx, prefix, "rock", *_paint_rock(palette, (rock_h, rock_w), seed), float(tex.get("rockNormalStrength", 0.9)), written)
    polyp_images = _write_set(ctx, prefix, "polyp", *_paint_polyp(palette, (polyp_h, polyp_w), seed), float(tex.get("polypNormalStrength", 0.6)), written)
    tent_images = _write_set(ctx, prefix, "tentacle", *_paint_tentacle(palette, (tent_h, tent_w), seed), float(tex.get("tentacleNormalStrength", 0.4)), written)

    rock_material = mat.principled(f"{prefix}_Rock", palette["rock"], 0.85, coat=0.0, subsurface=0.0, specular=0.3)
    mat.attach_textures(rock_material, albedo=rock_images["albedo"], roughness=rock_images["roughness"], normal=rock_images["normal"], normal_strength=1.0)
    polyp_material = mat.principled(f"{prefix}_Polyp", palette["discField"], 0.40, coat=0.06, subsurface=0.12, specular=0.4)
    mat.attach_textures(polyp_material, albedo=polyp_images["albedo"], roughness=polyp_images["roughness"], normal=polyp_images["normal"],
                        normal_strength=1.0, vertex_color="Tint")
    tent_material = mat.principled(f"{prefix}_Tentacle", palette["tentacle"], 0.42, coat=0.04, subsurface=0.15, specular=0.35)
    mat.attach_textures(tent_material, albedo=tent_images["albedo"], roughness=tent_images["roughness"], normal=tent_images["normal"],
                        normal_strength=1.0, vertex_color="Tint")
    material_map = {"rock": rock_material, "polyp": polyp_material, "tentacle": tent_material}

    # ---- rig: Root -> Base (static) -> one bone per polyp
    rb = RigBuilder(f"{prefix}_Rig", spec["id"])
    rb.bone("Root", (0.0, 0.0, -0.004), (0.0, 0.0, 0.0), deform=False, roll_up=(1.0, 0.0, 0.0))
    rb.bone("Base", (0.0, 0.0, 0.0), (0.0, 0.0, rock.height * 0.5), "Root", roll_up=(1.0, 0.0, 0.0))
    for P in polyps:
        head = P["anchor"]
        tail = P["anchor"] + P["axis"] * P["height"]
        rb.bone(P["bone"], (head.x, head.y, head.z), (tail.x, tail.y, tail.z), "Base", roll_up=(1.0, 0.0, 0.0))
    rig = rb.finish()

    # ---- rock mesh
    rock_part = msh.make_part("rock", rock.geometry(), "rock", lambda i, v: {"Base": 1.0}, closed=True,
                              color_fn=lambda i, v: (1.0, 1.0, 1.0, 1.0))
    rock_obj = msh.assemble(f"{prefix}_Rock", [rock_part], material_map, rig, f"{prefix}_Armature", color_attribute="Tint")
    rock_obj["lod"] = 1

    # ---- one bone-parented object per polyp: closed column+disc loft plus its tentacle fringe,
    # with `close` (bud + folded tentacles) and `spread` (flattened fringe) shape keys
    polyp_objects = []
    polyp_parts = []
    tent_parts = []
    ring_count = len(POLYP_U)
    no_weights = lambda i, v: {}  # noqa: E731 - bone-parented objects carry no skin weights
    for P in polyps:
        name = P["name"]
        body_geometry = _polyp_geometry(P, segments, 0.0)
        embed = set(range(segments)) | {ring_count * segments}
        body = msh.make_part(f"polyp_{name}", body_geometry, "polyp", no_weights, closed=True,
                             groups={f"embed_{name}": embed}, color_fn=_tint(P, seed))
        fringe = msh.make_part(f"tent_{name}", _tentacle_geometry(P, pcfg, 0.0, 0.0, seed), "tentacle", no_weights, closed=False,
                               color_fn=_tint(P, seed))
        obj = msh.assemble(f"{prefix}_Polyp_{name}", [body, fringe], material_map, None, color_attribute="Tint")
        obj["lod"] = 1
        _parent_to_bone(obj, rig, P["bone"])
        _add_shape_keys(obj, [body, fringe], {
            "close": {0: _polyp_geometry(P, segments, 1.0)[0], 1: _tentacle_geometry(P, pcfg, 1.0, 0.0, seed)[0]},
            "spread": {1: _tentacle_geometry(P, pcfg, 0.0, 1.0, seed)[0]},
        })
        P["object"] = obj.name
        polyp_objects.append(obj)
        polyp_parts.append(body)
        tent_parts.append(fringe)

    # rest-size sanity (the validator measures the whole mesh along xy)
    all_vertices = [v for part in [rock_part, *polyp_parts, *tent_parts] for v in part.vertices]
    max_x = max(abs(v[0]) for v in all_vertices)
    max_y = max(abs(v[1]) for v in all_vertices)
    if max_x > half_width + 1e-6 or max_y > half_width + 1e-6:
        raise ValueError(f"Colony exceeds its footprint: |x| {max_x:.5f} |y| {max_y:.5f} vs half width {half_width:.5f}")

    # ---- animation
    anim = spec["animation"]
    clips: list[ClipSpec] = []
    x_span = 2.0 * half_width
    cluster_count = len(clusters)

    open_cfg = anim["open"]
    channels: list[Channel] = []
    for P in polyps:
        pid = (P["row"], P["col"])
        tilt = float(open_cfg["tiltDegrees"]) + float(open_cfg.get("tiltJitterDegrees", 1.5)) * (2.0 * _h(*pid, 300, seed=seed) - 1.0)
        channels.append(Channel(P["bone"], "rotation", (1.0, 0.0, 0.0), tilt, float(open_cfg.get("frequency", 1)), math.tau * _h(*pid, 301, seed=seed)))
        channels.append(Channel(P["bone"], "rotation", (0.0, 0.0, 1.0), tilt * 0.7, float(open_cfg.get("frequency", 1)), math.tau * _h(*pid, 302, seed=seed)))
        channels.append(Channel(P["bone"], "rotation", (1.0, 0.0, 0.0), float(open_cfg.get("secondaryDegrees", 1.0)),
                                float(open_cfg.get("secondaryFrequency", 2)), math.tau * _h(*pid, 303, seed=seed)))
    spread = float(open_cfg.get("spread", 0.4))
    for P in polyps:
        channels.append(Channel(shape_key_target(P["object"], "spread"), "value", amplitude=0.5 * spread,
                                frequency=float(open_cfg.get("frequency", 1)), phase=math.tau * _h(P["cluster"], 310, seed=seed), bias=0.5 * spread))
    clips.append(ClipSpec("open", int(open_cfg["frames"]), True, channels))

    flow_cfg = anim["flow"]
    channels = []
    cycles = float(flow_cfg.get("waveCycles", 0.5))
    for P in polyps:
        pid = (P["row"], P["col"])
        phase = -math.tau * cycles * (P["x"] + half_width) / x_span + 0.30 * (_h(*pid, 320, seed=seed) - 0.5)
        channels.append(Channel(P["bone"], "rotation", (1.0, 0.0, 0.0), float(flow_cfg["tiltDegrees"]), float(flow_cfg.get("frequency", 1)), phase,
                                bias=float(flow_cfg.get("leanBiasDegrees", 0.0))))
        channels.append(Channel(P["bone"], "rotation", (0.0, 0.0, 1.0), float(flow_cfg.get("crossDegrees", 2.0)),
                                float(flow_cfg.get("crossFrequency", 2)), math.tau * _h(*pid, 321, seed=seed)))
    spread = float(flow_cfg.get("spread", 0.5))
    for P in polyps:
        channels.append(Channel(shape_key_target(P["object"], "spread"), "value", amplitude=0.5 * spread,
                                frequency=float(flow_cfg.get("frequency", 1)), phase=-math.tau * cycles * (P["cluster"] + 0.5) / cluster_count,
                                bias=0.5 * spread))
    clips.append(ClipSpec("flow", int(flow_cfg["frames"]), True, channels))

    close_cfg = anim["close"]
    channels = []
    pulse_frequency = float(close_cfg.get("pulseFrequency", 0.9))
    exponent = float(close_cfg.get("pulseExponent", 1.3))
    stagger = float(close_cfg.get("staggerFraction", 0.07))
    for P in polyps:
        start = 0.02 + stagger * P["cluster"]
        phase = -math.tau * pulse_frequency * start
        channels.append(Channel(shape_key_target(P["object"], "close"), "value", amplitude=1.0, frequency=pulse_frequency,
                                phase=phase, waveform="pulse", exponent=exponent))
        channels.append(Channel(P["bone"], "scale", (0.0, 1.0, 0.0), -float(close_cfg.get("shorten", 0.22)), pulse_frequency, phase,
                                waveform="pulse", exponent=exponent))
        r = max(math.hypot(P["x"], P["y"]), 1e-6)
        # bone-local X tilts toward world +X and bone-local Z toward world -Y (roll aligned to +X), so this axis leans to the centre
        flinch_axis = (-P["x"] / r, 0.0, P["y"] / r)
        channels.append(Channel(P["bone"], "rotation", flinch_axis, float(close_cfg.get("flinchDegrees", 4.0)), pulse_frequency, phase,
                                waveform="pulse", exponent=exponent))
    clips.append(ClipSpec("close", int(close_cfg["frames"]), False, channels))

    mesh_objects = {obj.name: obj for obj in polyp_objects}
    actions = {clip.name: bake_clip(rig, clip, mesh_objects=mesh_objects) for clip in clips}
    for obj in polyp_objects:
        _stash_key_clips(obj, actions, ["open", "flow", "close"])

    # ---- contract
    meshes = [rock_obj, *polyp_objects]
    contract = base_contract(spec, rig.name, f"{prefix}_Root", [m.name for m in meshes], size_axis="xy")
    contract["closedParts"].append({"object": rock_obj.name, "group": "part_rock", "volumeFloor": 0.6})
    neighbour_limit = 2.6 * float(colony["spacing"]["lattice"])
    for P in polyps:
        name = P["name"]
        contract["closedParts"].append({"object": P["object"], "group": f"part_polyp_{name}", "volumeFloor": 0.6})
        contract["clearance"].append({"a": [P["object"], f"part_polyp_{name}", f"embed_{name}"], "b": [rock_obj.name, "part_rock"],
                                      "label": f"polyp_{name}_vs_rock"})
        contract["clearance"].append({"a": [P["object"], f"part_tent_{name}"], "b": [rock_obj.name, "part_rock"],
                                      "label": f"tentacles_{name}_vs_rock"})
        for Q in polyps:
            if Q is P or math.hypot(P["x"] - Q["x"], P["y"] - Q["y"]) > neighbour_limit:
                continue
            contract["clearance"].append({"a": [P["object"], f"part_tent_{name}"], "b": [Q["object"], f"part_polyp_{Q['name']}"],
                                          "label": f"tentacles_{name}_vs_polyp_{Q['name']}"})
            if P["index"] < Q["index"]:
                contract["clearance"].append({"a": [P["object"], f"part_polyp_{name}"], "b": [Q["object"], f"part_polyp_{Q['name']}"],
                                              "label": f"polyp_{name}_vs_polyp_{Q['name']}"})
    contract["vertexColorAttribute"] = "Tint"
    register_clips(contract, clips)

    triangles = sum(len(face) - 2 for part in [rock_part, *polyp_parts, *tent_parts] for face in part.faces)
    notes = {
        "polyps": len(polyps),
        "clusters": cluster_count,
        "tentacles": sum(P["tentacles"] for P in polyps),
        "sourceTriangles": triangles,
        "rockHeightMeters": rock.height,
        "polypHeightsMeters": [round(P["height"], 5) for P in polyps],
        "discRadiiMeters": [round(P["disc"], 5) for P in polyps],
        "variant": ctx.variant,
    }
    return BuildResult(rig=rig, root=None, meshes=meshes, clips=clips, contract=contract,
                       preview_action=spec["clipRoles"]["locomotion"], textures=written, notes=notes)
