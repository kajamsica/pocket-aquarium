"""Euphyllia glabrescens (torch coral): species-local LPS coral body plan.

Anatomy choices (Corals of the World / WoRMS descriptions, see source-references.json):
- Phaceloid corallum: four tubular corallites (branches) rise from a low rock base, each narrow at the
  base and flaring toward the calice, leaning outward from the colony axis so the polyp heads are
  staggered in height. Corallites are separate closed tubes and never fuse above the rock.
- One large polyp per corallite: a fleshy oral-disc dome overhanging the calice with a single slit
  mouth, and 34 long tubular tentacles in three concentric cycles, each ending in a swollen
  acrosphere (knob tip) painted in a contrasting colour.
- Every tentacle is its own closed tube along a cubic Bezier path; lean, droop, lateral curl, length
  and the angular jitter of its root are varied by seeded hashes (per-tentacle phase is baked into the
  geometry). A deterministic avoidance pass keeps tentacles clear of every corallite, the rock and the
  neighbouring polyp discs, so the validator can prove those clearances through every clip.
- Rig (29 deform bones): Base (static; rock and skeleton), one Disc bone per head and, per head, two
  tentacle clusters (half discs) each driven by a three-bone chain (root, mid, tip) that follows the
  mean path of that cluster's tentacles. Every tentacle is skinned along its own arc length
  (Disc at the very root, then segment weights across root/mid/tip), so a travelling wave down the
  chain bends each tentacle along its length with the tip trailing the root instead of pivoting the
  whole tentacle rigidly at the disc. Neighbouring tentacles carry different baked lean, sag and curl
  so a cluster never reads as one block.
- Clips: sway (slow idle loop, per-cluster drift direction, root-to-tip lag, secondary wobble at a
  different integer frequency), flow (current loop: cumulative lean toward +X travelling across the
  colony, tips streaming with a faster flutter), retract (hold envelope: chains curl toward the disc
  axis and scale down toward their roots, discs sink into the calice and shrink, then re-extend).

Everything derives from asset.source.json plus fixed seeds; there is no use of random or time.
"""

from __future__ import annotations

import math

import numpy as np
from mathutils import Matrix, Vector

from ..lib import materials as mat
from ..lib import meshing as msh
from ..lib import textures
from ..lib.animation import Channel, ClipSpec, bake_clip
from ..lib.contract import BuildResult, base_contract, register_clips
from ..lib.noise import cells, fbm, scalar_hash, smoothstep
from ..lib.rigging import RigBuilder, segment_weights

UP = Vector((0.0, 0.0, 1.0))
CHAIN = ("root", "mid", "tip")


# ---------------------------------------------------------------- small helpers

def _h(*values, seed: int) -> float:
    return scalar_hash(*values, seed=seed)


def _interp(profile, t: float) -> float:
    """Piecewise-linear lookup in a [[t, value], ...] table."""
    if t <= profile[0][0]:
        return float(profile[0][1])
    for (t0, v0), (t1, v1) in zip(profile, profile[1:]):
        if t0 <= t <= t1:
            f = (t - t0) / max(t1 - t0, 1e-9)
            return float(v0 + (v1 - v0) * f)
    return float(profile[-1][1])


def _bezier(p0: Vector, p1: Vector, p2: Vector, p3: Vector, t: float) -> Vector:
    s = 1.0 - t
    return p0 * (s * s * s) + p1 * (3.0 * s * s * t) + p2 * (3.0 * s * t * t) + p3 * (t * t * t)


def _closest_on_polyline(point: Vector, points: list[Vector], radii: list[float]):
    best = None
    for a, b, ra, rb in zip(points, points[1:], radii, radii[1:]):
        ab = b - a
        length2 = ab.length_squared
        t = 0.0 if length2 < 1e-18 else max(0.0, min(1.0, (point - a).dot(ab) / length2))
        q = a + ab * t
        d = (point - q).length
        if best is None or d < best[0]:
            best = (d, q, ra + (rb - ra) * t)
    return best


def _xform(geometry, shift: Vector, scale: float):
    vertices, faces, uvs, face_uvs = geometry
    moved = [tuple((Vector(v) - shift) * scale) for v in vertices]
    return moved, faces, uvs, face_uvs


def _key_every_kind(channels: list[Channel], envelope: str | None) -> list[Channel]:
    """Add zero-amplitude channels so every animated bone keys rotation, location and scale in
    every clip; otherwise a clip that keys only some kinds inherits the previous clip's pose for
    the rest (the validator plays clips back to back)."""
    kinds_by_bone: dict[str, set[str]] = {}
    for channel in channels:
        kinds_by_bone.setdefault(channel.target, set()).add(channel.kind)
    padded = list(channels)
    for bone in sorted(kinds_by_bone):
        for kind in ("rotation", "location", "scale"):
            if kind not in kinds_by_bone[bone]:
                padded.append(Channel(bone, kind, (0.0, 1.0, 0.0), 0.0, 1.0, 0.0, "const", envelope=envelope))
    return padded


def _local_axis(rig, bone_name: str, world_axis) -> tuple[float, float, float]:
    """Express an armature-space axis in the bone's local (rest) frame for rotation channels."""
    m3 = rig.data.bones[bone_name].matrix_local.to_3x3()
    local = m3.transposed() @ Vector(world_axis)
    return (local.x, local.y, local.z)


# ---------------------------------------------------------------- colony layout

class Head:
    """One corallite branch with its polyp disc frame."""

    def __init__(self, index: int, cfg: dict, morph: dict, colony_center: Vector):
        self.index = index
        corallite = morph["corallite"]
        self.R = float(corallite["radius"]) * float(cfg.get("radiusScale", 1.0))
        embed = float(morph["rock"]["embed"])
        self.base = Vector((float(cfg["x"]), float(cfg["y"]), embed))
        outward = Vector((self.base.x - colony_center.x, self.base.y - colony_center.y, 0.0))
        self.outward = outward.normalized() if outward.length > 1e-6 else Vector((1.0, 0.0, 0.0))
        height = float(cfg["height"])
        lean = math.radians(float(cfg["leanDegrees"]))
        self.top = self.base + self.outward * (height * math.tan(lean)) + Vector((0.0, 0.0, height))
        ctrl = self.base + Vector((0.0, 0.0, height * 0.55))
        samples = int(corallite["samples"])
        self.axis_points: list[Vector] = []
        self.axis_radii: list[float] = []
        for k in range(samples):
            t = k / (samples - 1)
            point = self.base * ((1 - t) ** 2) + ctrl * (2 * (1 - t) * t) + self.top * (t * t)
            self.axis_points.append(point)
            self.axis_radii.append(self.R * _interp(corallite["radiusProfile"], t))
        self.normal = (self.top - ctrl).normalized()
        self.rotation = UP.rotation_difference(self.normal).to_matrix()
        self.e1 = self.rotation @ Vector((1.0, 0.0, 0.0))
        self.e2 = self.rotation @ Vector((0.0, 1.0, 0.0))
        disc = morph["disc"]
        self.disc_radius = self.R * float(disc["radiusFactor"])
        self.disc_height = self.R * float(disc["heightFactor"])
        self.disc_center = self.top + self.normal * (self.R * float(disc["lift"]))
        self.disc_bone = f"Disc_{index}"
        self.cluster_chains: list[list[str]] = []
        self.cluster_joints: list[list[Vector]] = []

    def to_world(self, local: Vector) -> Vector:
        return self.disc_center + self.e1 * local.x + self.e2 * local.y + self.normal * local.z


class Tentacle:
    def __init__(self, head: int, index: int, points: list[Vector], radii: list[float], ts: list[float],
                 sector: int, length: float):
        self.head = head
        self.index = index
        self.points = points
        self.radii = radii
        self.ts = ts
        self.sector = sector
        self.length = length

    def point_at(self, fraction: float) -> Vector:
        """Linear interpolation of the sampled path at an arc-length fraction."""
        for (t0, p0), (t1, p1) in zip(zip(self.ts, self.points), zip(self.ts[1:], self.points[1:])):
            if t0 <= fraction <= t1:
                f = (fraction - t0) / max(t1 - t0, 1e-9)
                return p0.lerp(p1, f)
        return self.points[-1] if fraction > self.ts[-1] else self.points[0]


def _tentacles_for_head(head: Head, morph: dict, seed: int) -> list[Tentacle]:
    cfg = morph["tentacles"]
    r_t = float(cfg["radius"])
    length_min, length_max = (float(v) for v in cfg["lengthRange"])
    ts = [float(t) for t in cfg["profileT"]]
    factors = [float(f) for f in cfg["profileRadius"]]
    clusters = int(cfg["clustersPerHead"])
    droop_gain = float(cfg["droop"])
    curl = float(cfg["curl"])
    sector_offset = math.tau * _h(head.index, seed=seed + 9)
    result: list[Tentacle] = []
    k = 0
    for ring_index, (rho0, count) in enumerate(cfg["placementRings"]):
        count = int(count)
        for j in range(count):
            h1 = _h(head.index, ring_index, j, seed=seed + 1)
            h2 = _h(head.index, ring_index, j, seed=seed + 2)
            h3 = _h(head.index, ring_index, j, seed=seed + 3)
            h4 = _h(head.index, ring_index, j, seed=seed + 4)
            h5 = _h(head.index, ring_index, j, seed=seed + 5)
            h6 = _h(head.index, ring_index, j, seed=seed + 6)
            h7 = _h(head.index, ring_index, j, seed=seed + 7)
            h8 = _h(head.index, ring_index, j, seed=seed + 8)
            theta = (j + 0.5 * (ring_index % 2) + 0.55 * (h1 - 0.5)) / count * math.tau + sector_offset * 0.37
            rho = min(0.94, max(0.12, float(rho0) + 0.10 * (h2 - 0.5)))
            radial_world = (head.e1 * math.cos(theta) + head.e2 * math.sin(theta)).normalized()
            local = Vector((rho * head.disc_radius * math.cos(theta), rho * head.disc_radius * math.sin(theta),
                            head.disc_height * math.sqrt(max(0.0, 1.0 - rho * rho))))
            normal_local = Vector((local.x / head.disc_radius ** 2, local.y / head.disc_radius ** 2,
                                   local.z / head.disc_height ** 2)).normalized()
            surface_normal = (head.e1 * normal_local.x + head.e2 * normal_local.y + head.normal * normal_local.z).normalized()
            root = head.to_world(local) - surface_normal * (r_t * 0.6)
            # tentacles on the colony's outer side lean out and droop; those facing the colony centre
            # stand taller so the crowd of polyps forms a dome instead of stabbing through neighbours
            facing = radial_world.dot(head.outward)
            f_facing = 0.55 + 0.45 * (0.5 + 0.5 * facing)
            tilt = (0.15 + 1.25 * rho * rho) * f_facing
            d0 = (head.normal + radial_world * tilt + surface_normal * 0.35).normalized()
            length = (length_min + (length_max - length_min) * (0.35 + 0.65 * rho)) * (0.85 + 0.30 * h3)
            side = head.normal.cross(radial_world).normalized()
            c1 = 0.26 * (h4 - 0.5)
            c2 = 0.44 * (h5 - 0.5)
            # only tentacles on the colony's outer side cascade downward; inner ones arch over the
            # colony centre and stay above the neighbouring calices. Each tentacle sags by its own
            # amount so neighbours never share a silhouette.
            droop = droop_gain * rho * msh.smoothstep((facing + 0.15) / 0.9) * (0.7 + 0.6 * h7)
            sag = 0.16 * h8
            p1 = root + d0 * (0.40 * length)
            p2 = root + d0 * (0.55 * length) + radial_world * (0.30 * length * f_facing) \
                + head.normal * (length * (0.12 - 0.55 * droop - sag)) + side * (c1 * length)
            p3 = root + d0 * (0.42 * length) + radial_world * (0.60 * length * f_facing) \
                + head.normal * (length * (0.05 - droop)) + side * (c2 * length)
            phase = math.tau * h6
            points = []
            for t in ts:
                point = _bezier(root, p1, p2, p3, t)
                wiggle = math.sin(math.tau * (0.8 + 0.5 * h7) * t + phase) * t * (1.0 - 0.4 * t)
                point = point + side * (curl * length * wiggle) \
                    + head.normal * (0.6 * curl * length * math.cos(math.tau * 0.7 * t + phase) * t)
                points.append(point)
            radii = [r_t * f for f in factors]
            sector = int(((theta - sector_offset) % math.tau) / (math.tau / clusters)) % clusters
            result.append(Tentacle(head.index, k, points, radii, ts, sector, length))
            k += 1
    return result


def _avoid_obstacles(tentacles: list[Tentacle], heads: list[Head], morph: dict) -> int:
    """Push tentacle path samples out of every corallite, the rock and the other polyps' discs."""
    cfg = morph["tentacles"]
    base_margin = float(cfg["avoidMargin"])
    swing = math.radians(float(cfg.get("swingBudgetDegrees", 20.0)))
    rock = morph["rock"]
    rock_top = float(rock["height"])
    moved = 0
    for _ in range(3):
        for tentacle in tentacles:
            own = heads[tentacle.head]
            for k in range(2, len(tentacle.points)):
                point = tentacle.points[k]
                tube_r = tentacle.radii[k] * 1.15
                # the animation swings this sample around the disc centre; reserve that travel
                margin = base_margin + (point - own.disc_center).length * swing
                for head in heads:
                    hit = _closest_on_polyline(point, head.axis_points, head.axis_radii)
                    # above the calice the corallite ends; the polyp disc owns that space
                    above_calice = (point - head.top).dot(head.normal) > 0.0
                    if hit is not None and not above_calice:
                        distance, q, axis_r = hit
                        required = axis_r + tube_r + margin
                        if distance < required:
                            direction = (point - q)
                            if direction.length < 1e-9:
                                direction = head.outward
                            point = q + direction.normalized() * required
                            moved += 1
                    if head.index != tentacle.head:
                        required = head.disc_radius * 1.02 + tube_r + margin * 1.4
                        offset = point - head.disc_center
                        if offset.length < required:
                            point = head.disc_center + offset.normalized() * required
                            moved += 1
                if point.z < rock_top + tube_r + margin:
                    point = Vector((point.x, point.y, rock_top + tube_r + margin))
                    moved += 1
                tentacle.points[k] = point
    return moved


def _rock_geometry(morph: dict, center: Vector, seed: int):
    rock = morph["rock"]
    radius = float(rock["radius"])
    height = float(rock["height"])
    segments = int(rock["segments"])
    ring_count = int(rock["rings"])
    phases = [math.tau * _h(k, seed=seed + 20 + k) for k in range(4)]
    rings = []
    for k in range(ring_count):
        t = k / (ring_count - 1)
        z = height * math.sin(t * math.pi / 2) ** 0.85
        r_profile = 1.0 - 0.42 * t * t
        ring = []
        for s in range(segments):
            a = s / segments * math.tau
            lump = 1.0 + 0.10 * math.cos(2 * a + phases[0]) + 0.07 * math.cos(3 * a + phases[1]) \
                + 0.05 * math.cos(5 * a + phases[2]) + 0.03 * math.cos(7 * a + phases[3] + k * 0.9)
            r = radius * r_profile * lump
            ring.append((center.x + math.cos(a) * r, center.y + math.sin(a) * r, z))
        rings.append(ring)
    return msh.loft(rings, cap_start=True, cap_end=True)


# ---------------------------------------------------------------- procedural paint

def _paint_tissue(palette: dict, seed: int):
    height_px, width_px = 128, 512
    U, V = textures.uv_grid(width_px, height_px)
    Vm = 0.5 - np.abs(V - 0.5)  # mirrored around the tube so the UV seam is invisible
    stem = palette["stem"]
    stem_dark = palette["stemDark"]
    tip = palette["tip"]
    tip_core = palette["tipCore"]
    streak = fbm(U * 5.0, Vm * 14.0, octaves=3, seed=seed + 21)
    speckle = fbm(U * 64.0, Vm * 30.0, octaves=2, seed=seed + 22)
    albedo = textures.rgba(stem, 1.0, U.shape)
    albedo = textures.mix(albedo, stem_dark, smoothstep(0.42, 0.80, streak) * 0.32)
    albedo = textures.scale_rgb(albedo, 0.90 + 0.22 * speckle)
    # the root darkens into the disc colour where the tentacle meets the oral disc
    albedo = textures.mix(albedo, palette["disc"], (1.0 - smoothstep(0.0, 0.16, U)) * 0.65)
    # the tissue thins toward the tip and reads translucent: lift and desaturate the stem colour
    # progressively along the tentacle (backlit look) before the acrosphere takes over
    pale = (float(stem[0]) * 0.55 + 0.42, float(stem[1]) * 0.55 + 0.42, float(stem[2]) * 0.55 + 0.42)
    translucency = smoothstep(0.30, 0.86, U) * 0.38 * (0.85 + 0.3 * fbm(U * 3.0, Vm * 6.0, octaves=2, seed=seed + 25))
    albedo = textures.mix(albedo, pale, translucency)
    # translucent-looking pale band before the acrosphere, then the knob
    neck = smoothstep(0.74, 0.85, U) * (1.0 - smoothstep(0.85, 0.89, U))
    albedo = textures.mix(albedo, tip, 0.4 * neck)
    knob = smoothstep(0.855, 0.885, U)
    tip_rgba = textures.rgba(tip, 1.0, U.shape)
    core_mask = smoothstep(0.905, 0.965, U) * (0.55 + 0.45 * (0.5 + 0.5 * np.cos(V * math.tau)))
    tip_rgba = textures.mix(tip_rgba, tip_core, core_mask)
    tip_rgba = textures.scale_rgb(tip_rgba, 0.94 + 0.12 * fbm(U * 40.0, Vm * 20.0, octaves=2, seed=seed + 24))
    albedo = textures.mix(albedo, tip_rgba, knob)
    roughness = 0.46 + 0.10 * speckle - 0.08 * knob + 0.04 * (1.0 - smoothstep(0.0, 0.2, U))
    height = 0.5 + 0.16 * (fbm(U * 34.0, Vm * 16.0, octaves=3, seed=seed + 23) - 0.5) \
        + 0.04 * np.cos(V * math.tau * 5.0) * (1.0 - knob) + 0.05 * (speckle - 0.5) * knob
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height, 0.9)}


def _paint_disc(palette: dict, seed: int):
    height_px, width_px = 128, 256
    U, V = textures.uv_grid(width_px, height_px)
    disc = palette["disc"]
    stem = palette["stem"]
    stria = 0.5 + 0.5 * np.cos(V * math.tau * 28.0 + 1.5 * (fbm(U * 6.0, V * 3.0, octaves=2, seed=seed + 31) - 0.5))
    stria = stria ** 1.6 * smoothstep(0.03, 0.12, U)
    grain = fbm(U * 30.0, V * 40.0, octaves=3, seed=seed + 32)
    albedo = textures.rgba(disc, 1.0, U.shape)
    albedo = textures.mix(albedo, stem, 0.35 * stria)
    ring = smoothstep(0.22, 0.34, U) * (1.0 - smoothstep(0.36, 0.5, U))
    albedo = textures.mix(albedo, stem, 0.25 * ring)
    albedo = textures.mix(albedo, palette["mouth"], (1.0 - smoothstep(0.02, 0.09, U)) * 0.75)
    albedo = textures.scale_rgb(albedo, 0.88 + 0.24 * grain)
    roughness = 0.40 + 0.10 * grain - 0.05 * stria
    height = 0.5 + 0.22 * (stria - 0.5) + 0.10 * (grain - 0.5)
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height, 1.0)}


def _paint_skeleton(palette: dict, seed: int):
    height_px, width_px = 128, 256
    U, V = textures.uv_grid(width_px, height_px)
    Vm = 0.5 - np.abs(V - 0.5)
    cream = palette["skeleton"]
    pit_distance, pit_id = cells(U * 16.0, Vm * 9.0, seed=seed + 41)
    pit = (1.0 - smoothstep(0.10, 0.30, pit_distance)) * smoothstep(0.35, 0.6, pit_id)
    costae = 0.5 + 0.5 * np.cos(V * math.tau * 24.0)
    film = fbm(U * 5.0, Vm * 7.0, octaves=3, seed=seed + 42)
    algae = smoothstep(0.50, 0.80, film) * (1.0 - smoothstep(0.30, 0.70, U))
    grain = fbm(U * 40.0, Vm * 40.0, octaves=2, seed=seed + 43)
    albedo = textures.rgba(cream, 1.0, U.shape)
    albedo = textures.scale_rgb(albedo, 0.90 + 0.16 * grain - 0.30 * pit)
    albedo = textures.mix(albedo, (0.30, 0.34, 0.20), 0.6 * algae)
    albedo = textures.mix(albedo, (0.52, 0.30, 0.34), 0.35 * smoothstep(0.6, 0.85, fbm(U * 3.0, Vm * 4.0, octaves=2, seed=seed + 44)) * (1.0 - smoothstep(0.4, 0.8, U)))
    roughness = 0.84 + 0.10 * pit + 0.05 * (grain - 0.5) - 0.12 * algae
    height = 0.5 + 0.22 * (costae - 0.5) - 0.28 * pit + 0.08 * (grain - 0.5)
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height, 1.3)}


def _paint_rock(palette: dict, seed: int):
    height_px, width_px = 128, 256
    U, V = textures.uv_grid(width_px, height_px)
    Vm = 0.5 - np.abs(V - 0.5)
    rock = palette["rock"]
    # the rock loft is roughly 13x wider around than it is tall, so sample noise anisotropically
    mottle = fbm(U * 2.0, Vm * 26.0, octaves=4, seed=seed + 51)
    grain = fbm(U * 8.0, Vm * 100.0, octaves=2, seed=seed + 52)
    pit_distance, pit_id = cells(U * 3.0, Vm * 40.0, seed=seed + 53)
    pit = 1.0 - smoothstep(0.12, 0.32, pit_distance)
    coralline = (1.0 - smoothstep(0.22, 0.34, cells(U * 1.5, Vm * 18.0, seed=seed + 54)[0])) * smoothstep(0.45, 0.6, mottle)
    albedo = textures.rgba(rock, 1.0, U.shape)
    albedo = textures.scale_rgb(albedo, 0.75 + 0.5 * mottle + 0.15 * (grain - 0.5) - 0.25 * pit)
    albedo = textures.mix(albedo, (0.36, 0.11, 0.27), 0.8 * coralline)
    albedo = textures.mix(albedo, (0.22, 0.26, 0.14), 0.5 * smoothstep(0.6, 0.85, fbm(U * 1.5, Vm * 16.0, octaves=2, seed=seed + 55)))
    roughness = 0.90 + 0.06 * (grain - 0.5) - 0.15 * coralline
    height = 0.5 + 0.20 * (mottle - 0.5) - 0.25 * pit + 0.10 * (grain - 0.5)
    return {"albedo": albedo, "roughness": textures.grey(roughness), "normal": textures.normal_from_height(height, 1.4)}


# ---------------------------------------------------------------- build

def build(spec: dict, species, ctx) -> BuildResult:
    prefix = ctx.prefix
    morph = spec["morphology"]
    seed = int(morph.get("seed", 11))
    palette = spec["palette"]
    tex_cfg = spec.get("textures", {})
    tcfg = morph["tentacles"]

    # ---- textures & materials
    written = []

    def write_set(stem: str, paint: dict):
        images = {}
        for key, non_color in (("albedo", False), ("roughness", True), ("normal", True)):
            path = ctx.texture_dir / f"{stem}-{key}.png"
            images[key] = textures.write_image(f"{prefix}_{stem}_{key}", path, paint[key], non_color)
            written.append(path)
        return images

    tissue_images = write_set("tissue", _paint_tissue(palette, seed))
    disc_images = write_set("disc", _paint_disc(palette, seed))
    skeleton_images = write_set("skeleton", _paint_skeleton(palette, seed))
    rock_images = write_set("rock", _paint_rock(palette, seed))
    # soft wet tissue: no clear coat, low specular, broad roughness, strong subsurface
    tissue = mat.principled(f"{prefix}_Tissue", palette["stem"], 0.50, coat=0.0, subsurface=0.55, specular=0.22)
    mat.attach_textures(tissue, albedo=tissue_images["albedo"], roughness=tissue_images["roughness"], normal=tissue_images["normal"],
                        normal_strength=float(tex_cfg.get("tissueNormalStrength", 0.45)))
    disc_material = mat.principled(f"{prefix}_Disc", palette["disc"], 0.48, coat=0.0, subsurface=0.45, specular=0.28)
    mat.attach_textures(disc_material, albedo=disc_images["albedo"], roughness=disc_images["roughness"], normal=disc_images["normal"],
                        normal_strength=float(tex_cfg.get("discNormalStrength", 0.8)))
    skeleton_material = mat.principled(f"{prefix}_Skeleton", palette["skeleton"], 0.85, coat=0.0, subsurface=0.02, specular=0.25)
    mat.attach_textures(skeleton_material, albedo=skeleton_images["albedo"], roughness=skeleton_images["roughness"], normal=skeleton_images["normal"],
                        normal_strength=float(tex_cfg.get("skeletonNormalStrength", 1.0)))
    rock_material = mat.principled(f"{prefix}_Rock", palette["rock"], 0.92, coat=0.0, subsurface=0.0, specular=0.20)
    mat.attach_textures(rock_material, albedo=rock_images["albedo"], roughness=rock_images["roughness"], normal=rock_images["normal"],
                        normal_strength=float(tex_cfg.get("rockNormalStrength", 1.0)))
    mouth_material = mat.principled(f"{prefix}_Mouth", palette["mouth"], 0.5, coat=0.05, subsurface=0.05, specular=0.30)
    material_map = {"tissue": tissue, "disc": disc_material, "skeleton": skeleton_material, "rock": rock_material, "mouth": mouth_material}

    # ---- colony layout (nominal metres, rescaled below to the reference colony width)
    head_cfgs = morph["heads"]
    colony_center = Vector((sum(float(h["x"]) for h in head_cfgs) / len(head_cfgs),
                            sum(float(h["y"]) for h in head_cfgs) / len(head_cfgs), 0.0))
    heads = [Head(index, cfg, morph, colony_center) for index, cfg in enumerate(head_cfgs)]
    tentacles: list[Tentacle] = []
    for head in heads:
        tentacles.extend(_tentacles_for_head(head, morph, seed))
    moved = _avoid_obstacles(tentacles, heads, morph)
    clusters = int(tcfg["clustersPerHead"])
    joint_fractions = [float(f) for f in tcfg.get("chainFractions", [0.0, 0.34, 0.67, 1.0])]
    for head in heads:
        for sector in range(clusters):
            members = [t for t in tentacles if t.head == head.index and t.sector == sector]
            joints = []
            for fraction in joint_fractions:
                if members:
                    mean = Vector((0.0, 0.0, 0.0))
                    for t in members:
                        mean += t.point_at(fraction)
                    joints.append(mean / len(members))
                else:
                    angle = (sector + 0.5) / clusters * math.tau
                    direction = (head.normal + (head.e1 * math.cos(angle) + head.e2 * math.sin(angle)) * 0.8).normalized()
                    joints.append(head.disc_center + head.normal * (head.R * 0.3) + direction * (fraction * float(tcfg["lengthRange"][0])))
            head.cluster_chains.append([f"Tent_{head.index}_{sector}_{name}" for name in CHAIN])
            head.cluster_joints.append(joints)

    # ---- nominal geometry
    rock_geometry = _rock_geometry(morph, colony_center, seed)
    corallite_geometries = [msh.tube(head.axis_points, head.axis_radii, int(morph["corallite"]["segments"]), cap_start=True, cap_end=True)
                            for head in heads]
    disc_cfg = morph["disc"]
    mouth_cfg = morph["mouth"]
    disc_geometries = []
    mouth_geometries = []
    for head in heads:
        disc_geometries.append(msh.ellipsoid(tuple(head.disc_center), (head.disc_radius, head.disc_radius, head.disc_height),
                                             int(disc_cfg["segments"]), int(disc_cfg["rings"]), head.rotation))
        twist = Matrix.Rotation(math.tau * _h(head.index, seed=seed + 12), 3, "Z")
        mouth_center = head.disc_center + head.normal * (head.disc_height * 0.93)
        mouth_geometries.append(msh.ellipsoid(tuple(mouth_center),
                                              (head.R * float(mouth_cfg["length"]), head.R * float(mouth_cfg["width"]), head.R * float(mouth_cfg["height"])),
                                              10, 5, head.rotation @ twist))
    segments = int(tcfg["segments"])
    tentacle_geometries = [msh.tube(t.points, t.radii, segments, cap_start=True, cap_end=True, u_values=t.ts) for t in tentacles]

    all_vertices = list(rock_geometry[0])
    for geometry in (*corallite_geometries, *disc_geometries, *mouth_geometries, *tentacle_geometries):
        all_vertices.extend(geometry[0])
    xs = [v[0] for v in all_vertices]
    ys = [v[1] for v in all_vertices]
    zs = [v[2] for v in all_vertices]
    shift = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, 0.0))
    nominal_width = max(max(xs) - min(xs), max(ys) - min(ys))
    scale = float(spec["referenceSize"]["meters"]) / nominal_width
    if min(zs) < -1e-9:
        raise ValueError("Colony geometry dips below the base plane")

    def world(point: Vector) -> Vector:
        return (point - shift) * scale

    # ---- rig
    rb = RigBuilder(f"{prefix}_Rig", spec["id"])
    rb.bone("Root", (0.0, 0.0, -0.004), (0.0, 0.0, 0.0), deform=False)
    rb.bone("Base", (0.0, 0.0, 0.0), (0.0, 0.0, 0.012 * scale), "Root")
    for head in heads:
        disc_head = world(head.disc_center - head.normal * (head.R * 0.3))
        disc_tail = world(head.disc_center + head.normal * (head.R * 0.4))
        rb.bone(head.disc_bone, tuple(disc_head), tuple(disc_tail), "Base")
        for chain, joints in zip(head.cluster_chains, head.cluster_joints):
            parent = head.disc_bone
            for k, bone_name in enumerate(chain):
                bone_head = world(joints[k])
                bone_tail = world(joints[k + 1])
                if (bone_tail - bone_head).length < 1e-4:
                    raise ValueError(f"Degenerate tentacle chain bone {bone_name}")
                rb.bone(bone_name, tuple(bone_head), tuple(bone_tail), parent, connected=k > 0)
                parent = bone_name
    rig = rb.finish()

    # ---- mesh parts
    def static_weights(i, v):
        return {"Base": 1.0}

    rock_part = msh.make_part("rock", _xform(rock_geometry, shift, scale), "rock", static_weights, closed=True,
                              groups={"hard": set(range(len(rock_geometry[0])))})
    skeleton_parts = [rock_part]
    for head, geometry in zip(heads, corallite_geometries):
        count = len(geometry[0])
        skeleton_parts.append(msh.make_part(f"corallite_{head.index}", _xform(geometry, shift, scale), "skeleton", static_weights, closed=True,
                                            groups={"hard": set(range(count)), "skeleton": set(range(count))}))
    skeleton_obj = msh.assemble(f"{prefix}_Skeleton", skeleton_parts, material_map, rig, f"{prefix}_Armature")
    skeleton_obj["lod"] = 1

    polyp_parts = []
    for head, disc_geometry, mouth_geometry in zip(heads, disc_geometries, mouth_geometries):
        def disc_weights(i, v, bone=head.disc_bone):
            return {bone: 1.0}
        polyp_parts.append(msh.make_part(f"disc_{head.index}", _xform(disc_geometry, shift, scale), "disc", disc_weights, closed=True,
                                         groups={f"disc_{head.index}": set(range(len(disc_geometry[0])))}))
        polyp_parts.append(msh.make_part(f"mouth_{head.index}", _xform(mouth_geometry, shift, scale), "mouth", disc_weights, closed=True,
                                         groups={f"disc_{head.index}": set(range(len(mouth_geometry[0])))}))
    polyps_obj = msh.assemble(f"{prefix}_Polyps", polyp_parts, material_map, rig, f"{prefix}_Armature")
    polyps_obj["lod"] = 1

    tentacle_parts = []
    ring_count = len(tcfg["profileT"])
    for tentacle, geometry in zip(tentacles, tentacle_geometries):
        head = heads[tentacle.head]
        chain = head.cluster_chains[tentacle.sector]

        def tentacle_weights(i, v, ts=tentacle.ts, disc_bone=head.disc_bone, chain=chain):
            # arc-length skinning: the very root belongs to the disc, then the chain takes over with
            # soft segment blends so the tentacle bends progressively instead of hinging at the disc
            if i < ring_count * segments:
                t = ts[i // segments]
            elif i == ring_count * segments:
                t = ts[0]
            else:
                t = ts[-1]
            w_chain = msh.smoothstep((t - 0.02) / 0.14)
            return msh.blend_weights({disc_bone: 1.0}, segment_weights(t, chain, 1.0), w_chain)

        count = len(geometry[0])
        tentacle_parts.append(msh.make_part(f"tentacle_{tentacle.head}_{tentacle.index}", _xform(geometry, shift, scale), "tissue",
                                            tentacle_weights, closed=True,
                                            groups={f"tentacles_{tentacle.head}": set(range(count)), "tentacles_all": set(range(count))}))
    tentacles_obj = msh.assemble(f"{prefix}_Tentacles", tentacle_parts, material_map, rig, f"{prefix}_Armature")
    tentacles_obj["lod"] = 1
    skeleton_obj["colonyWidthMeters"] = spec["referenceSize"]["meters"]

    # ---- animation
    anim = spec["animation"]
    clips: list[ClipSpec] = []

    chain_gain = [float(g) for g in tcfg.get("chainGain", [0.35, 0.7, 1.0])]

    def chain_wave(chain: list[str], world_axis: Vector, degrees: float, frequency: int, phase: float, lag: float,
                   bias_degrees: float = 0.0) -> list[Channel]:
        """Travelling wave down a chain about one world axis (expressed per bone in its local frame).

        Amplitude grows toward the tip and each bone lags the one before it, so the tip trails the root.
        Amplitudes on chained bones accumulate, which is what makes the tentacle bend along its length.
        """
        return [Channel(bone, "rotation", _local_axis(rig, bone, world_axis), degrees * gain, frequency,
                        phase - k * lag, bias=bias_degrees * gain)
                for k, (bone, gain) in enumerate(zip(chain, chain_gain))]

    sway = anim["sway"]
    channels: list[Channel] = []
    frequency = int(sway.get("frequency", 1))
    lag = float(sway.get("lag", 0.9))
    for head in heads:
        for c, chain in enumerate(head.cluster_chains):
            ha = _h(head.index, c, seed=seed + 61)
            hb = _h(head.index, c, seed=seed + 62)
            hc = _h(head.index, c, seed=seed + 63)
            # each cluster drifts along its own horizontal direction; a perpendicular wobble at a
            # different integer frequency stops the loop from reading as a metronome
            drift = math.tau * ha
            main_axis = Vector((math.cos(drift), math.sin(drift), 0.0))
            wobble_axis = Vector((-math.sin(drift), math.cos(drift), 0.0))
            amplitude = float(sway["tentacleDegrees"]) * (0.8 + 0.4 * hc)
            channels.extend(chain_wave(chain, main_axis, amplitude, frequency, math.tau * hb, lag))
            channels.extend(chain_wave(chain, wobble_axis, amplitude * float(sway.get("wobbleFraction", 0.45)),
                                       frequency + int(sway.get("wobbleFrequencyOffset", 1)), math.tau * hc + 0.7, lag * 0.8))
        hd = _h(head.index, seed=seed + 64)
        channels.append(Channel(head.disc_bone, "rotation", (1.0, 0.0, 0.0), float(sway["discDegrees"]), frequency, math.tau * hd))
        channels.append(Channel(head.disc_bone, "scale", (1.0, 1.0, 1.0), float(sway["discPulse"]), frequency, math.tau * hd + 1.1))
    clips.append(ClipSpec("sway", int(sway["frames"]), True, _key_every_kind(channels, None)))

    flow = anim["flow"]
    channels = []
    frequency = int(flow.get("frequency", 2))
    wave_number = float(flow.get("waveNumber", 30.0))
    lag = float(flow.get("lag", 1.1))
    flutter_frequency = int(flow.get("flutterFrequency", 4))
    for head in heads:
        for c, chain in enumerate(head.cluster_chains):
            root_x = rig.data.bones[chain[0]].head_local.x
            ha = _h(head.index, c, seed=seed + 71)
            hb = _h(head.index, c, seed=seed + 72)
            phase = -wave_number * root_x + 0.5 * (ha - 0.5)
            # current along +X: rotation about world Y leans the chain downstream, the bias makes the
            # lean cumulative along the chain so the tips stream furthest
            channels.extend(chain_wave(chain, Vector((0.0, 1.0, 0.0)), float(flow["tentacleDegrees"]) * (0.85 + 0.3 * hb),
                                       frequency, phase, lag, bias_degrees=float(flow.get("leanDegrees", 0.0))))
            # tips flutter side to side at a faster integer frequency
            channels.append(Channel(chain[2], "rotation", _local_axis(rig, chain[2], (1.0, 0.0, 0.0)),
                                    float(flow.get("flutterDegrees", 4.0)), flutter_frequency, math.tau * ha))
            channels.append(Channel(chain[1], "rotation", _local_axis(rig, chain[1], (1.0, 0.0, 0.0)),
                                    float(flow.get("flutterDegrees", 4.0)) * 0.5, flutter_frequency - 1, math.tau * hb))
        disc_x = rig.data.bones[head.disc_bone].head_local.x
        channels.append(Channel(head.disc_bone, "rotation", _local_axis(rig, head.disc_bone, (0.0, 1.0, 0.0)),
                                float(flow["discDegrees"]), frequency, -wave_number * disc_x))
    clips.append(ClipSpec("flow", int(flow["frames"]), True, _key_every_kind(channels, None)))

    retract = anim["retract"]
    envelope = retract.get("envelope", "hold")
    channels = []
    for head in heads:
        for chain, joints in zip(head.cluster_chains, head.cluster_joints):
            # the root bone scales the whole chain toward its head; every bone curls toward the disc
            # axis so the tentacles shorten and fold rather than sliding along a straight line
            channels.append(Channel(chain[0], "scale", (1.0, 1.0, 1.0), -float(retract["contract"]), 1.0, 0.0, "const", envelope=envelope))
            for k, bone in enumerate(chain):
                direction = (joints[k + 1] - joints[k]).normalized()
                tuck_axis = direction.cross(UP)
                if tuck_axis.length > 0.15:
                    amplitude = float(retract["tuckDegrees"]) * min(1.0, tuck_axis.length / 0.5)
                else:
                    tuck_axis = Vector((0.0, 1.0, 0.0))
                    amplitude = float(retract["tuckDegrees"]) * 0.3
                channels.append(Channel(bone, "rotation", _local_axis(rig, bone, tuck_axis.normalized()), amplitude, 1.0, 0.0, "const", envelope=envelope))
        channels.append(Channel(head.disc_bone, "location", (0.0, 1.0, 0.0), -float(retract["discSinkFactor"]) * head.R * scale, 1.0, 0.0, "const", envelope=envelope))
        channels.append(Channel(head.disc_bone, "scale", (1.0, 1.0, 1.0), -float(retract["discShrink"]), 1.0, 0.0, "const", envelope=envelope))
    clips.append(ClipSpec("retract", int(retract["frames"]), False, _key_every_kind(channels, envelope)))

    mesh_objects = {obj.name: obj for obj in (skeleton_obj, polyps_obj, tentacles_obj)}
    for clip in clips:
        bake_clip(rig, clip, mesh_objects=mesh_objects)

    # ---- contract
    meshes = [skeleton_obj, polyps_obj, tentacles_obj]
    contract = base_contract(spec, rig.name, f"{prefix}_Root", [m.name for m in meshes], size_axis="xy")
    contract["closedParts"].append({"object": skeleton_obj.name, "group": "part_rock", "volumeFloor": 0.9})
    for head in heads:
        contract["closedParts"].append({"object": skeleton_obj.name, "group": f"part_corallite_{head.index}", "volumeFloor": 0.9})
        contract["closedParts"].append({"object": polyps_obj.name, "group": f"part_disc_{head.index}", "volumeFloor": 0.6})
        contract["closedParts"].append({"object": polyps_obj.name, "group": f"part_mouth_{head.index}", "volumeFloor": 0.6})
    for head in heads:
        contract["clearance"].append({"a": [tentacles_obj.name, f"tentacles_{head.index}"], "b": [skeleton_obj.name, "hard"],
                                      "minDistance": 0.0012, "label": f"tentacles_{head.index}_vs_skeleton"})
        for other in heads:
            if other.index == head.index:
                continue
            contract["clearance"].append({"a": [tentacles_obj.name, f"tentacles_{head.index}"], "b": [polyps_obj.name, f"disc_{other.index}"],
                                          "label": f"tentacles_{head.index}_vs_disc_{other.index}"})
            contract["clearance"].append({"a": [polyps_obj.name, f"disc_{head.index}"], "b": [skeleton_obj.name, f"part_corallite_{other.index}"],
                                          "label": f"disc_{head.index}_vs_corallite_{other.index}"})
            if other.index > head.index:
                contract["clearance"].append({"a": [skeleton_obj.name, f"part_corallite_{head.index}"], "b": [skeleton_obj.name, f"part_corallite_{other.index}"],
                                              "label": f"corallite_{head.index}_vs_corallite_{other.index}"})
                contract["clearance"].append({"a": [polyps_obj.name, f"disc_{head.index}"], "b": [polyps_obj.name, f"disc_{other.index}"],
                                              "label": f"disc_{head.index}_vs_disc_{other.index}"})
    register_clips(contract, clips)

    preview_action = spec.get("preview", {}).get("action", spec["clipRoles"]["locomotion"])
    return BuildResult(rig=rig, root=None, meshes=meshes, clips=clips, contract=contract, preview_action=preview_action,
                       textures=written,
                       notes={"heads": len(heads), "tentacles": len(tentacles), "nominalWidthMeters": nominal_width,
                              "colonyScale": scale, "avoidanceMoves": moved,
                              "corallitesDiameterMeters": [round(h.R * 2 * scale, 5) for h in heads],
                              "tentacleLengthMeters": [round(min(t.length for t in tentacles) * scale, 5), round(max(t.length for t in tentacles) * scale, 5)]})
