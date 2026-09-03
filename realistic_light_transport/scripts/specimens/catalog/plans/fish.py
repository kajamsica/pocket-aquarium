"""Fish body plan: lofted superellipse body, thin-shell fins, eyes, mouth/gill cues, axial rig.

Generalises the accepted Ocellaris construction. All dimensions come from the
species `asset.source.json` (meters, forward +X, up +Z, origin at anatomical midbody).
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from mathutils import Matrix, Vector

from ..lib import materials as mat
from ..lib import meshing as msh
from ..lib import noise, paint, textures
from ..lib.animation import Channel, ClipSpec, bake_clip, travelling_wave
from ..lib.contract import BuildResult, base_contract, register_clips
from ..lib.rigging import RigBuilder, chain_weights

AXIAL_BONES = ("Body", "Spine_A", "Spine_B", "Peduncle", "Caudal")
ZONES = ("zone_caudal", "zone_peduncle", "zone_midbody", "zone_anterior", "zone_head")


# ---------------------------------------------------------------- interpolation

def pchip_slopes(xs, ys):
    n = len(xs)
    if n < 3:
        return [(ys[1] - ys[0]) / (xs[1] - xs[0])] * 2
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    delta = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
    slopes = [0.0] * n
    for i in range(1, n - 1):
        if delta[i - 1] * delta[i] <= 0:
            slopes[i] = 0.0
        else:
            w1 = 2 * h[i] + h[i - 1]
            w2 = h[i] + 2 * h[i - 1]
            slopes[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i])
    slopes[0] = ((2 * h[0] + h[1]) * delta[0] - h[0] * delta[1]) / (h[0] + h[1])
    if math.copysign(1, slopes[0]) != math.copysign(1, delta[0]):
        slopes[0] = 0.0
    elif math.copysign(1, delta[0]) != math.copysign(1, delta[1]) and abs(slopes[0]) > abs(3 * delta[0]):
        slopes[0] = 3 * delta[0]
    slopes[-1] = ((2 * h[-1] + h[-2]) * delta[-1] - h[-1] * delta[-2]) / (h[-1] + h[-2])
    if math.copysign(1, slopes[-1]) != math.copysign(1, delta[-1]):
        slopes[-1] = 0.0
    elif math.copysign(1, delta[-1]) != math.copysign(1, delta[-2]) and abs(slopes[-1]) > abs(3 * delta[-1]):
        slopes[-1] = 3 * delta[-1]
    return slopes


class Profile:
    """Monotone cubic interpolation of one station channel along x."""

    def __init__(self, xs, ys):
        self.xs = list(xs)
        self.ys = list(ys)
        self.slopes = pchip_slopes(self.xs, self.ys)

    def __call__(self, x: float) -> float:
        xs, ys, m = self.xs, self.ys, self.slopes
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        for i in range(len(xs) - 1):
            if xs[i] <= x <= xs[i + 1]:
                h = xs[i + 1] - xs[i]
                t = (x - xs[i]) / h
                h00 = 2 * t ** 3 - 3 * t ** 2 + 1
                h10 = t ** 3 - 2 * t ** 2 + t
                h01 = -2 * t ** 3 + 3 * t ** 2
                h11 = t ** 3 - t ** 2
                return h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * h * m[i + 1]
        return ys[-1]


class Body:
    """Station-driven body description with interpolated cross-section channels."""

    def __init__(self, morphology: dict):
        stations = sorted(morphology["controlStations"], key=lambda item: item["x"])
        xs = [s["x"] for s in stations]
        self.tail_x = xs[0]
        self.head_x = xs[-1]
        self.length = self.head_x - self.tail_x
        self.half_width = Profile(xs, [s["halfWidth"] for s in stations])
        self.dorsal = Profile(xs, [s["dorsalHeight"] for s in stations])
        self.ventral = Profile(xs, [s["ventralDepth"] for s in stations])
        self.center_z = Profile(xs, [s.get("centerZ", 0.0) for s in stations])
        cross = morphology.get("crossSection", {})
        self.exp_dorsal = float(cross.get("dorsalExponent", 1.72))
        self.exp_ventral = float(cross.get("ventralExponent", self.exp_dorsal))
        sampling = morphology.get("sampling", {})
        self.segments = int(sampling.get("ringSegments", 48))
        self.ring_count = int(sampling.get("ringCount", 48))
        self.station_xs = xs

    def ring_positions(self) -> list[float]:
        xs = self.station_xs
        total = self.length
        positions = [xs[0]]
        for a, b in zip(xs, xs[1:]):
            count = max(1, round((b - a) / total * (self.ring_count - len(xs))))
            for k in range(1, count + 1):
                positions.append(a + (b - a) * k / (count + 1))
            positions.append(b)
        return positions

    def surface_y(self, x: float, z: float) -> float:
        """Lateral half-extent of the section at x for absolute height z."""
        cz = self.center_z(x)
        dz = z - cz
        radius = self.dorsal(x) if dz >= 0 else self.ventral(x)
        exponent = self.exp_dorsal if dz >= 0 else self.exp_ventral
        ratio = min(abs(dz) / max(radius, 1e-9), 1.0)
        return self.half_width(x) * max(1.0 - ratio ** exponent, 0.0) ** (1.0 / exponent)

    def ridge_z(self, x: float, dorsal: bool) -> float:
        return self.center_z(x) + (self.dorsal(x) if dorsal else -self.ventral(x))

    def u(self, x: float) -> float:
        return (x - self.tail_x) / self.length


# ---------------------------------------------------------------- fins

def sheet_normals(rows):
    """Per-vertex unit normals of a grid sheet (rows x columns of Vectors)."""
    normals = []
    for r, row in enumerate(rows):
        current = []
        for c, point in enumerate(row):
            p = Vector(point)
            du = Vector(rows[r][min(c + 1, len(row) - 1)]) - Vector(rows[r][max(c - 1, 0)])
            dv = Vector(rows[min(r + 1, len(rows) - 1)][c]) - Vector(rows[max(r - 1, 0)][c])
            normal = du.cross(dv)
            if normal.length < 1e-12:
                normal = Vector((0, 1, 0))
            current.append(normal.normalized())
        normals.append(current)
    return normals


def thin_shell(rows, thickness_base: float, thickness_edge: float, side_hint: Vector | None = None):
    """Two offset sheets plus rim quads: a fin with real (tapering) thickness, open at the base row."""
    normals = sheet_normals(rows)
    if side_hint is not None:
        flip = sum(n.dot(side_hint) for row in normals for n in row) < 0
        if flip:
            normals = [[-n for n in row] for row in normals]
    row_count = len(rows)
    column_count = len(rows[0])

    def offset_rows(sign):
        out = []
        for r, row in enumerate(rows):
            t = r / max(row_count - 1, 1)
            thickness = (thickness_base * (1.0 - t) + thickness_edge * t) / 2
            current = []
            for c, point in enumerate(row):
                edge_taper = 1.0
                if c == 0 or c == column_count - 1:
                    edge_taper = 0.5
                current.append(tuple(Vector(point) + normals[r][c] * (sign * thickness * edge_taper)))
            out.append(current)
        return out

    front = offset_rows(1.0)
    back = offset_rows(-1.0)
    fv, ff, fuv, _ = msh.membrane(front)
    bv, bf, buv, _ = msh.membrane(back)
    offset = len(fv)
    vertices = fv + bv
    faces = list(ff) + [tuple(reversed(tuple(i + offset for i in face))) for face in bf]
    uvs = fuv + buv
    # rim: tip row and the two end columns (base row stays open inside the body)
    def idx(r, c, back_side):
        return (offset if back_side else 0) + r * column_count + c
    for c in range(column_count - 1):
        r = row_count - 1
        a, b = idx(r, c, False), idx(r, c + 1, False)
        a2, b2 = idx(r, c, True), idx(r, c + 1, True)
        faces.append((a, a2, b2, b))
    for r in range(row_count - 1):
        for c, reverse in ((0, True), (column_count - 1, False)):
            a, b = idx(r, c, False), idx(r + 1, c, False)
            a2, b2 = idx(r, c, True), idx(r + 1, c, True)
            face = (a, b, b2, a2)
            faces.append(tuple(reversed(face)) if reverse else face)
    attach = {i for i in range(column_count)} | {offset + i for i in range(column_count)}
    return (vertices, faces, uvs, None), attach, row_count, column_count, offset


def fin_atlas_transform(index: int, columns: int = 4, rows: int = 2):
    col = index % columns
    row = index // columns

    def transform(u, v):
        return ((col + 0.02 + u * 0.96) / columns, (row + 0.02 + v * 0.96) / rows)

    return transform


def median_rows(body: Body, fin: dict, scale: float):
    dorsal = fin["side"] == "dorsal"
    rows_n = int(fin.get("rows", 4))
    cols_n = int(fin.get("columns", 10))
    heights = Profile([p[0] for p in fin["heights"]], [p[1] for p in fin["heights"]])
    lean = float(fin.get("lean", 0.0))
    pinch = float(fin.get("pinch", 0.0))
    gap = 0.00015 * scale
    rows = []
    for r in range(rows_n):
        t = r / (rows_n - 1)
        row = []
        for c in range(cols_n):
            s = c / (cols_n - 1)
            base_x = fin["xStart"] + s * (fin["xEnd"] - fin["xStart"])
            x = base_x + lean * t + (0.5 - s) * pinch * t
            ridge = body.ridge_z(base_x, dorsal)
            height = heights(s) * t
            z = ridge + (gap + height if dorsal else -(gap + height))
            row.append((x, 0.0, z))
        rows.append(row)
    return rows


def caudal_rows(body: Body, fin: dict, scale: float):
    rows_n = int(fin.get("rows", 4))
    cols_n = int(fin.get("columns", 9))
    x_base = body.tail_x + 0.0008 * scale
    cz = body.center_z(body.tail_x)
    base_top = body.dorsal(body.tail_x) * float(fin.get("baseFraction", 0.9))
    base_bottom = body.ventral(body.tail_x) * float(fin.get("baseFraction", 0.9))
    span_top = float(fin["spanTop"])
    span_bottom = float(fin["spanBottom"])
    length = float(fin["length"])
    fork = float(fin.get("fork", 0.0))
    fork_power = float(fin.get("forkPower", 1.6))
    top_lobe = float(fin.get("topLobeLength", 1.0))
    bottom_lobe = float(fin.get("bottomLobeLength", 1.0))
    tilt = float(fin.get("tilt", 0.0))
    rounding = float(fin.get("rounding", 0.0))
    rows = []
    for r in range(rows_n):
        t = r / (rows_n - 1)
        row = []
        for c in range(cols_n):
            s = c / (cols_n - 1)
            z_base = cz + (-base_bottom + (base_top + base_bottom) * s)
            z_edge = cz + (-span_bottom + (span_top + span_bottom) * s) + tilt
            z = z_base + (z_edge - z_base) * t
            center_offset = abs(2 * s - 1)
            lobe = (bottom_lobe + (top_lobe - bottom_lobe) * s) * length
            fork_depth = fork * length * (1.0 - center_offset ** fork_power)
            round_cut = rounding * length * center_offset ** 2.2
            x = x_base - t * max(lobe - fork_depth - round_cut, length * 0.12)
            y = 0.00035 * scale * math.sin(math.pi * s) * t
            row.append((x, y, z))
        rows.append(row)
    return rows


def paired_rows(body: Body, fin: dict, scale: float, side: int):
    rows_n = int(fin.get("rows", 4))
    cols_n = int(fin.get("columns", 6))
    root_x = float(fin["rootX"])
    root_length = float(fin["rootLength"])
    root_height = float(fin.get("rootHeight", 0.0))
    length = float(fin["length"])
    sweep = math.radians(float(fin.get("sweepDegrees", 35.0)))
    droop = math.radians(float(fin.get("droopDegrees", 20.0)))
    taper = float(fin.get("taper", 0.3))
    power = float(fin.get("power", 0.7))
    spread = float(fin.get("spread", 1.0))
    rows = []
    for r in range(rows_n):
        t = r / (rows_n - 1)
        row = []
        for c in range(cols_n):
            s = c / (cols_n - 1)
            x = root_x - s * root_length
            cz = body.center_z(x)
            z = cz + root_height * (body.dorsal(x) if root_height >= 0 else body.ventral(x))
            y = body.surface_y(x, z) + 0.00015 * scale
            extension = taper + (1.0 - taper) * math.sin(math.pi * s) ** power
            direction = Vector((-math.sin(sweep), math.cos(sweep) * spread, -math.sin(droop)))
            direction.normalize()
            reach = length * extension * t
            row.append((x + direction.x * reach - t * s * root_length * 0.15,
                        side * (y + direction.y * reach),
                        z + direction.z * reach))
        rows.append(row)
    return rows


# ---------------------------------------------------------------- textures

class PaintContext:
    def __init__(self, body: Body, width: int, height: int, spec: dict):
        self.U, self.V = textures.uv_grid(width, height)
        self.X = body.tail_x + self.U * body.length
        angle = self.V * math.tau
        self.ZETA = np.cos(angle)
        self.SIDE = np.where(np.sin(angle) >= 0, 1.0, -1.0)
        self.length = body.length
        self.body = body
        self.spec = spec
        self.noise = noise
        self.paint = paint
        self.np = np
        self.shape = self.U.shape

    def ridge_height(self):
        """Approximate local body height (dorsal + ventral) along X, normalised by max."""
        heights = np.array([self.body.dorsal(x) + self.body.ventral(x) for x in self.X[0]])
        return np.tile(heights / heights.max(), (self.shape[0], 1))


class FinPaintContext:
    def __init__(self, width: int, height: int, fin_name: str, spec: dict):
        self.U, self.V = textures.uv_grid(width, height)
        self.fin = fin_name
        self.spec = spec
        self.noise = noise
        self.paint = paint
        self.np = np
        self.shape = self.U.shape


def default_body_paint(ctx: PaintContext):
    base = textures.rgba((0.55, 0.55, 0.5), 1.0, ctx.shape)
    albedo = textures.mix(base, (0.25, 0.25, 0.28), paint.gradient(-ctx.ZETA, 0.2, 0.9) * 0.4)
    height = paint.scales_height(ctx.U, ctx.V, 70, 26)
    return {"albedo": albedo, "roughness": textures.grey(0.38 + 0.1 * height), "normal": textures.normal_from_height(height, 1.2)}


def default_fin_paint(ctx: FinPaintContext):
    ray = paint.rays(ctx.U, 14) * ctx.V
    return np.stack([0.72 + 0.18 * ray, 0.72 + 0.18 * ray, 0.68 + 0.18 * ray, np.full(ctx.shape, 0.82)], axis=-1)


# ---------------------------------------------------------------- build

def build(spec: dict, species, ctx) -> BuildResult:
    prefix = ctx.prefix
    morphology = spec["morphology"]
    body = Body(morphology)
    scale = body.length / 0.08
    fins_spec = morphology.get("fins", [])
    fin_names = [fin["name"] for fin in fins_spec]
    if len(fin_names) != len(set(fin_names)):
        raise ValueError("Fin names must be unique")

    # ---- textures & materials
    tex = spec.get("textures", {})
    body_w, body_h = tex.get("bodyResolution", [512, 256])
    fin_w, fin_h = tex.get("finResolution", [512, 256])
    paint_ctx = PaintContext(body, body_w, body_h, spec)
    body_paint = species.paint_body(paint_ctx) if hasattr(species, "paint_body") else default_body_paint(paint_ctx)
    texture_dir = ctx.texture_dir
    written = []
    images = {}
    for key, non_color in (("albedo", False), ("roughness", True), ("normal", True)):
        pixels = body_paint.get(key)
        if pixels is None:
            continue
        path = texture_dir / f"body-{key}.png"
        images[key] = textures.write_image(f"{prefix}_Body_{key}", path, pixels, non_color)
        written.append(path)
    # fin atlas: each fin owns one tile
    atlas_columns, atlas_rows = 4, 2
    if len(fins_spec) > atlas_columns * atlas_rows:
        raise ValueError("Fin atlas supports at most 8 fins")
    atlas = np.zeros((fin_h, fin_w, 4), dtype=np.float64)
    tile_w, tile_h = fin_w // atlas_columns, fin_h // atlas_rows
    for index, fin in enumerate(fins_spec):
        fin_ctx = FinPaintContext(tile_w, tile_h, fin["name"], spec)
        tile = species.paint_fin(fin_ctx) if hasattr(species, "paint_fin") else default_fin_paint(fin_ctx)
        col, row = index % atlas_columns, index // atlas_columns
        atlas[row * tile_h:(row + 1) * tile_h, col * tile_w:(col + 1) * tile_w] = tile
    fin_path = texture_dir / "fin-atlas.png"
    images["fin"] = textures.write_image(f"{prefix}_FinAtlas", fin_path, atlas, False)
    written.append(fin_path)

    palette = spec.get("palette", {})
    skin = mat.principled(f"{prefix}_Skin", palette.get("skin", (0.5, 0.5, 0.5)), 0.42, coat=0.12, specular=0.38)
    mat.attach_textures(skin, albedo=images.get("albedo"), roughness=images.get("roughness"), normal=images.get("normal"),
                        normal_strength=float(tex.get("normalStrength", 0.35)))
    fin_material = mat.principled(f"{prefix}_Fin", palette.get("fin", (0.6, 0.6, 0.6)), 0.5, coat=0.04, specular=0.28)
    mat.attach_textures(fin_material, albedo=images["fin"], alpha_from_albedo=True)
    eye_material = mat.principled(f"{prefix}_Eye", palette.get("iris", (0.08, 0.05, 0.02)), 0.14, coat=0.6, subsurface=0.0)
    pupil_material = mat.principled(f"{prefix}_Pupil", (0.004, 0.003, 0.003), 0.3, coat=0.2, subsurface=0.0)
    glint_material = mat.principled(f"{prefix}_Glint", (0.85, 0.86, 0.84), 0.2, subsurface=0.0)
    cue_material = mat.principled(f"{prefix}_Cue", palette.get("cue", (0.12, 0.05, 0.03)), 0.46, coat=0.05)
    adorn_material = mat.principled(f"{prefix}_Adornment", palette.get("adornment", (0.9, 0.9, 0.85)), 0.32, coat=0.25)
    material_map = {"skin": skin, "fin": fin_material, "eye": eye_material, "pupil": pupil_material,
                    "glint": glint_material, "cue": cue_material, "adornment": adorn_material}

    # ---- rig
    rig_spec = spec.get("rig", {})
    joints = rig_spec.get("axialJoints")
    if not joints:
        L, t0 = body.length, body.tail_x
        joints = [t0 + L * f for f in (0.92, 0.62, 0.44, 0.27, 0.13, -0.02)]
    if len(joints) != 6:
        raise ValueError("rig.axialJoints must list six x coordinates from head to tail")
    axial_names = ("Body", "Spine_A", "Spine_B", "Peduncle", "Caudal")
    rb = RigBuilder(f"{prefix}_Rig", spec["id"])
    zc = [body.center_z(min(max(x, body.tail_x), body.head_x)) for x in joints]
    rb.bone("Root", (joints[0] + 0.004 * scale, 0, zc[0]), (joints[0], 0, zc[0]), deform=False)
    parent = "Root"
    for index, name in enumerate(axial_names):
        rb.bone(name, (joints[index], 0, zc[index]), (joints[index + 1], 0, zc[index + 1]), parent, connected=index > 0)
        parent = name
    spans = []
    for index in range(4):
        start = joints[index + 1]
        end = joints[index + 1] + (joints[index + 2] - joints[index + 1]) * 0.6
        spans.append((start, end, axial_names[index], axial_names[index + 1]))

    def axial_weights(x: float) -> dict[str, float]:
        return chain_weights(x, spans, "Body", "Caudal")

    def axial_bone_at(x: float) -> str:
        for index in range(5):
            if x >= joints[index + 1]:
                return axial_names[index]
        return "Caudal"

    fin_bones: dict[str, str] = {}
    for fin in fins_spec:
        kind = fin["type"]
        if kind == "median":
            dorsal = fin["side"] == "dorsal"
            heights = Profile([p[0] for p in fin["heights"]], [p[1] for p in fin["heights"]])
            x0, x1 = fin["xStart"], fin["xEnd"]
            peak_s = max(range(11), key=lambda k: heights(k / 10)) / 10
            head = (x1 - (x1 - x0) * 0.1, 0, body.ridge_z(x1 - (x1 - x0) * 0.1, dorsal))
            tip_x = x0 + (x1 - x0) * peak_s
            tail = (x0 + (x1 - x0) * 0.15, 0, body.ridge_z(tip_x, dorsal) + (heights(peak_s) * 0.5 if dorsal else -heights(peak_s) * 0.5))
            bone_name = fin.get("bone", "Dorsal" if dorsal else "Anal")
            rb.bone(bone_name, head, tail, axial_bone_at((x0 + x1) / 2))
            fin_bones[fin["name"]] = bone_name
        elif kind == "paired":
            side_bones = []
            for side, suffix in ((-1, "L"), (1, "R")):
                x = fin["rootX"] - fin["rootLength"] * 0.5
                z = body.center_z(x) + float(fin.get("rootHeight", 0.0)) * (body.dorsal(x) if fin.get("rootHeight", 0.0) >= 0 else body.ventral(x))
                y = body.surface_y(x, z)
                rows = paired_rows(body, fin, scale, side)
                tip = Vector(rows[-1][len(rows[-1]) // 2])
                bone_name = f"{fin.get('bone', fin['name'].capitalize())}_{suffix}"
                rb.bone(bone_name, (x, side * y, z), tuple(Vector((x, side * y, z)).lerp(tip, 0.7)), axial_bone_at(x))
                side_bones.append(bone_name)
            fin_bones[fin["name"]] = fin.get("bone", fin["name"].capitalize())
        elif kind == "caudal":
            fin_bones[fin["name"]] = "Caudal"
        else:
            raise ValueError(f"Unknown fin type {kind}")
    mouth = morphology.get("mouth", {})
    jaw_x = body.head_x
    jaw_z = body.center_z(body.head_x) + float(mouth.get("zOffset", -0.3)) * body.ventral(body.head_x) * 0.6
    rb.bone("Jaw", (jaw_x - 0.10 * body.length, 0, jaw_z), (jaw_x + 0.012 * body.length, 0, jaw_z - 0.001 * scale), "Body")
    gill = morphology.get("gill", {})
    gill_x = float(gill.get("x", body.tail_x + body.length * 0.72))
    rb.bone("Gill", (gill_x + 0.03 * body.length, 0, body.center_z(gill_x) + body.dorsal(gill_x) * 0.3),
            (gill_x - 0.03 * body.length, 0, body.center_z(gill_x) - body.ventral(gill_x) * 0.45), "Body")
    for extra in rig_spec.get("extraBones", []):
        rb.bone(extra["name"], tuple(extra["head"]), tuple(extra["tail"]), extra.get("parent", "Body"))
    rig = rb.finish()

    # ---- body mesh
    positions = body.ring_positions()
    rings = [msh.superellipse_ring(x, body.half_width(x), body.dorsal(x), body.ventral(x), 0.0, body.center_z(x),
                                   body.segments, body.exp_dorsal, body.exp_ventral) for x in positions]
    geometry = msh.loft(rings, u_values=[body.u(x) for x in positions], cap_start=True, cap_end=True)
    zone_fractions = morphology.get("zoneFractions", [0.10, 0.28, 0.55, 0.78])
    zone_groups: dict[str, set[int]] = {name: set() for name in ZONES}
    attach_groups: dict[str, set[int]] = {}
    verts = geometry[0]
    for index, (x, y, z) in enumerate(verts):
        f = body.u(x)
        zone = ZONES[sum(1 for edge in zone_fractions if f >= edge)]
        zone_groups[zone].add(index)
    for fin in fins_spec:
        name = fin["name"]
        group = attach_groups.setdefault(f"attach_{name}", set())
        if fin["type"] == "median":
            dorsal = fin["side"] == "dorsal"
            margin = 0.02 * body.length
            for index, (x, y, z) in enumerate(verts):
                if fin["xStart"] - margin <= x <= fin["xEnd"] + margin:
                    ridge = body.ridge_z(x, dorsal)
                    cz = body.center_z(x)
                    if (dorsal and z >= cz + (ridge - cz) * 0.78) or (not dorsal and z <= cz + (ridge - cz) * 0.78):
                        group.add(index)
        elif fin["type"] == "caudal":
            for index, (x, y, z) in enumerate(verts):
                if x <= body.tail_x + 0.035 * body.length:
                    group.add(index)
        else:
            for side, suffix in ((-1, "L"), (1, "R")):
                side_group = attach_groups.setdefault(f"attach_{name}_{suffix}", set())
                x0, x1 = fin["rootX"] - fin["rootLength"] - 0.02 * body.length, fin["rootX"] + 0.02 * body.length
                for index, (x, y, z) in enumerate(verts):
                    if x0 <= x <= x1 and side * y > 0:
                        cz = body.center_z(x)
                        rh = float(fin.get("rootHeight", 0.0))
                        target_z = cz + rh * (body.dorsal(x) if rh >= 0 else body.ventral(x))
                        if abs(z - target_z) <= max(body.dorsal(x), body.ventral(x)) * 0.32 and abs(y) >= body.surface_y(x, target_z) * 0.55:
                            side_group.add(index)
    body_part = msh.make_part("body", geometry, "skin", lambda i, v: axial_weights(v[0]), closed=True,
                              groups={**zone_groups, **attach_groups})
    body_obj = msh.assemble(f"{prefix}_Body", [body_part], material_map, rig, f"{prefix}_Armature")
    body_obj["adultLengthMeters"] = spec["referenceSize"]["meters"]
    body_obj["lod"] = 1

    # ---- fins
    thickness = morphology.get("finThickness", {"base": 0.0012, "edge": 0.00012})
    t_base = float(thickness["base"]) * scale
    t_edge = float(thickness["edge"]) * scale
    fin_parts = []
    fin_group_names = []
    for index, fin in enumerate(fins_spec):
        name = fin["name"]
        kind = fin["type"]
        transform = fin_atlas_transform(index)
        if kind == "median":
            rows = median_rows(body, fin, scale)
            bone_name = fin_bones[name]
            geometry, attach, row_count, column_count, offset = thin_shell(rows, t_base, t_edge, Vector((0, 1, 0)))

            def weights(i, v, bone_name=bone_name, rc=row_count, cc=column_count, off=offset):
                local = i if i < off else i - off
                t = (local // cc) / max(rc - 1, 1)
                return msh.blend_weights(axial_weights(v[0]), {bone_name: 1.0}, t)
            part = msh.make_part(name, geometry, "fin", weights, closed=False,
                                 groups={f"fin_{name}": set(range(len(geometry[0]))), f"attach_{name}": attach},
                                 uv_transform=transform)
            fin_parts.append(part)
            fin_group_names.append(name)
        elif kind == "caudal":
            rows = caudal_rows(body, fin, scale)
            geometry, attach, row_count, column_count, offset = thin_shell(rows, t_base * 0.8, t_edge, Vector((0, 1, 0)))

            def weights(i, v, rc=row_count, cc=column_count, off=offset):
                local = i if i < off else i - off
                t = (local // cc) / max(rc - 1, 1)
                return {"Peduncle": 1.0 - t, "Caudal": t} if 0 < t < 1 else ({"Caudal": 1.0} if t >= 1 else {"Peduncle": 1.0})
            part = msh.make_part(name, geometry, "fin", weights, closed=False,
                                 groups={f"fin_{name}": set(range(len(geometry[0]))), f"attach_{name}": attach},
                                 uv_transform=transform)
            fin_parts.append(part)
            fin_group_names.append(name)
        else:
            for side, suffix in ((-1, "L"), (1, "R")):
                rows = paired_rows(body, fin, scale, side)
                bone_name = f"{fin_bones[name]}_{suffix}"
                base_bone = axial_bone_at(fin["rootX"] - fin["rootLength"] * 0.5)
                geometry, attach, row_count, column_count, offset = thin_shell(rows, t_base, t_edge, Vector((0, side, 0)))

                def weights(i, v, bone_name=bone_name, base_bone=base_bone, rc=row_count, cc=column_count, off=offset):
                    local = i if i < off else i - off
                    t = (local // cc) / max(rc - 1, 1)
                    return msh.blend_weights({base_bone: 1.0}, {bone_name: 1.0}, t)
                part_name = f"{name}_{suffix}"
                part = msh.make_part(part_name, geometry, "fin", weights, closed=False,
                                     groups={f"fin_{part_name}": set(range(len(geometry[0]))), f"attach_{part_name}": attach},
                                     uv_transform=transform)
                fin_parts.append(part)
                fin_group_names.append(part_name)
    fins_obj = msh.assemble(f"{prefix}_Fins", fin_parts, material_map, rig, f"{prefix}_Armature")
    fins_obj["lod"] = 1

    # ---- eyes, cues, adornments
    detail_parts = []
    eye = morphology["eyes"]
    eye_x = float(eye["x"])
    eye_z = body.center_z(eye_x) + float(eye.get("zFraction", 0.4)) * body.dorsal(eye_x)
    radius = float(eye["radius"])
    protrude = float(eye.get("protrude", 0.55))
    aspect = float(eye.get("aspect", 0.35))
    for side, suffix in ((-1, "L"), (1, "R")):
        y_surface = body.surface_y(eye_x, eye_z)
        # the eyeball is a flattened ellipsoid seated in the head contour; only `protrude` of its
        # half-thickness stands proud of the flank so it reads as a lateral eye, not a bead
        center_y = side * (y_surface - radius * aspect * (1.0 - protrude))
        outer_y = center_y + side * radius * aspect
        rotation = Matrix.Rotation(math.radians(90) * side, 3, "X")
        eyeball = msh.make_part(f"eye_{suffix}", msh.ellipsoid((eye_x, center_y, eye_z), (radius, radius, radius * aspect), 20, 12, rotation),
                                "eye", lambda i, v: {"Body": 1.0}, closed=True)
        pupil_r = radius * float(eye.get("pupilFraction", 0.5))
        pupil_t = pupil_r * 0.3
        pupil = msh.make_part(f"pupil_{suffix}", msh.ellipsoid((eye_x + radius * 0.06, outer_y - side * pupil_t * 0.45, eye_z),
                                                                (pupil_r, pupil_r, pupil_t), 16, 10, rotation),
                              "pupil", lambda i, v: {"Body": 1.0}, closed=True)
        glint = msh.make_part(f"glint_{suffix}", msh.ellipsoid((eye_x + radius * 0.34, outer_y + side * pupil_t * 0.35, eye_z + radius * 0.34),
                                                                (radius * 0.11, radius * 0.11, radius * 0.04), 10, 6, rotation),
                              "glint", lambda i, v: {"Body": 1.0}, closed=True)
        detail_parts.extend([eyeball, pupil, glint])
    # mouth: short arc tube at the snout tip, skinned to Jaw
    mouth_w = float(mouth.get("width", 0.0026)) * scale
    mouth_r = float(mouth.get("radius", 0.00032)) * scale
    snout_x = body.head_x
    mouth_z = jaw_z
    mouth_points = [(snout_x - 0.0012 * scale, -mouth_w, mouth_z + 0.0005 * scale), (snout_x + 0.0008 * scale, 0.0, mouth_z),
                    (snout_x - 0.0012 * scale, mouth_w, mouth_z + 0.0005 * scale)]
    detail_parts.append(msh.make_part("mouth", msh.tube(mouth_points, [mouth_r * 0.6, mouth_r, mouth_r * 0.6], 8), "cue",
                                      lambda i, v: {"Jaw": 1.0}, closed=True))
    lip_points = [(snout_x - 0.0016 * scale, -mouth_w * 0.9, mouth_z - 0.0009 * scale), (snout_x + 0.0002 * scale, 0.0, mouth_z - 0.0011 * scale),
                  (snout_x - 0.0016 * scale, mouth_w * 0.9, mouth_z - 0.0009 * scale)]
    detail_parts.append(msh.make_part("lower_lip", msh.tube(lip_points, [mouth_r * 0.5, mouth_r * 0.8, mouth_r * 0.5], 8), "cue",
                                      lambda i, v: {"Jaw": 1.0}, closed=True))
    # gill arcs on both flanks
    gill_r = float(gill.get("radius", 0.0002)) * scale
    gill_points = int(gill.get("points", 11))
    for side, suffix in ((-1, "L"), (1, "R")):
        points = []
        for k in range(gill_points):
            f = k / (gill_points - 1)
            z = body.center_z(gill_x) + body.dorsal(gill_x) * 0.5 - f * (body.dorsal(gill_x) * 0.5 + body.ventral(gill_x) * 0.45)
            x = gill_x - math.sin(math.pi * f) * float(gill.get("bulge", 0.025)) * body.length
            # half-embedded so the operculum edge reads as a raised ridge hugging the flank, not a wire
            y = body.surface_y(x, z) - gill_r * 0.35
            points.append((x, side * y, z))
        detail_parts.append(msh.make_part(f"gill_{suffix}", msh.tube(points, [gill_r] * gill_points, 6), "cue",
                                          lambda i, v: {"Gill": 1.0}, closed=True))
    for adorn in morphology.get("adornments", []):
        if adorn["type"] == "scalpel":
            ax = float(adorn["x"])
            az = body.center_z(ax) + float(adorn.get("zFraction", 0.0)) * body.dorsal(ax)
            length = float(adorn["length"])
            for side, suffix in ((-1, "L"), (1, "R")):
                y = body.surface_y(ax, az) + 0.0003 * scale
                geometry = msh.ellipsoid((ax, side * y, az), (length * 0.5, 0.00045 * scale, length * 0.22), 12, 8)
                detail_parts.append(msh.make_part(f"scalpel_{suffix}", geometry, "adornment",
                                                  lambda i, v, x=ax: axial_weights(x), closed=True))
        elif adorn["type"] == "sphere":
            center = tuple(adorn["center"])
            geometry = msh.ellipsoid(center, tuple(adorn["radii"]), 12, 8)
            detail_parts.append(msh.make_part(adorn["name"], geometry, adorn.get("material", "adornment"),
                                              lambda i, v, b=adorn.get("bone", "Body"): {b: 1.0}, closed=True))
        else:
            raise ValueError(f"Unknown adornment {adorn['type']}")
    details_obj = msh.assemble(f"{prefix}_Details", detail_parts, material_map, rig, f"{prefix}_Armature")

    # ---- animation
    clips = []
    for clip_name, clip in spec["animation"].items():
        channels: list[Channel] = []
        env = None if clip["loop"] else clip.get("envelope", "bell")
        axial = clip.get("axial")
        if axial:
            channels += travelling_wave(list(axial_names[1:]), [float(a) for a in axial], (0, 0, 1),
                                        float(clip.get("axialFrequency", 1.0)), float(clip.get("axialLag", 0.45)),
                                        envelope_kind=env)
        pectoral = float(clip.get("pectoral", 0.0))
        for fin in fins_spec:
            if fin["type"] != "paired":
                continue
            amplitude = float(clip.get(fin["name"], pectoral if fin["name"] == "pectoral" else pectoral * 0.32))
            frequency = float(clip.get(f"{fin['name']}Frequency", clip.get("pectoralFrequency", 2.0)))
            for side, suffix in ((-1, "L"), (1, "R")):
                channels.append(Channel(f"{fin_bones[fin['name']]}_{suffix}", "rotation", (1, 0, 0), side * amplitude, frequency,
                                        float(clip.get(f"{fin['name']}Phase", 0.0)), envelope=env))
        for fin in fins_spec:
            if fin["type"] != "median":
                continue
            amplitude = float(clip.get(fin["name"], clip.get("median", 1.0)))
            channels.append(Channel(fin_bones[fin["name"]], "rotation", (0, 1, 0), amplitude, float(clip.get("axialFrequency", 1.0)),
                                    0.0 if fin["side"] == "dorsal" else math.pi, envelope=env))
        channels.append(Channel("Gill", "rotation", (0, 0, 1), float(clip.get("gill", 1.2)), float(clip.get("gillFrequency", 2.0)), envelope=env))
        channels.append(Channel("Jaw", "rotation", (1, 0, 0), float(clip.get("jaw", 2.0)), float(clip.get("jawFrequency", 2.0)),
                                waveform="pulse", envelope=env))
        for raw in clip.get("channels", []):
            channels.append(Channel(raw["target"], raw.get("kind", "rotation"), tuple(raw.get("axis", (0, 0, 1))), float(raw.get("amplitude", 0)),
                                    float(raw.get("frequency", 1)), float(raw.get("phase", 0)), raw.get("waveform", "sin"),
                                    float(raw.get("exponent", 1)), float(raw.get("bias", 0)), raw.get("envelope", env)))
        if hasattr(species, "extra_channels"):
            channels += species.extra_channels(clip_name, spec, env)
        clips.append(ClipSpec(clip_name, int(clip["frames"]), bool(clip["loop"]), channels))
    actions = [bake_clip(rig, clip) for clip in clips]

    # ---- contract
    meshes = [body_obj, fins_obj, details_obj]
    contract = base_contract(spec, rig.name, f"{prefix}_Root", [m.name for m in meshes], size_axis="x")
    contract["closedParts"].append({"object": body_obj.name, "group": "part_body", "volumeFloor": 0.7})
    non_adjacent = (("zone_head", "zone_midbody"), ("zone_head", "zone_peduncle"), ("zone_head", "zone_caudal"),
                    ("zone_anterior", "zone_peduncle"), ("zone_anterior", "zone_caudal"), ("zone_midbody", "zone_caudal"))
    for first, second in non_adjacent:
        contract["clearance"].append({"a": [body_obj.name, first], "b": [body_obj.name, second]})
    contract["clearance"].append({"a": [body_obj.name, "zone_head"], "b": [fins_obj.name, "fin_caudal"],
                                  "minDistance": 0.0125 * body.length, "label": "head_tail_clearance"})
    adjacency = {tuple(sorted(pair)) for pair in morphology.get("finAdjacency", [])}
    for name in fin_group_names:
        contract["clearance"].append({"a": [fins_obj.name, f"fin_{name}", f"attach_{name}"],
                                      "b": [body_obj.name, "part_body", f"attach_{name}"],
                                      "label": f"fin_body_{name}"})
    for i, first in enumerate(fin_group_names):
        for second in fin_group_names[i + 1:]:
            key = tuple(sorted((first.rsplit("_", 1)[0] if first.endswith(("_L", "_R")) else first,
                                second.rsplit("_", 1)[0] if second.endswith(("_L", "_R")) else second)))
            if key in adjacency or key[0] == key[1]:
                continue
            contract["clearance"].append({"a": [fins_obj.name, f"fin_{first}", f"attach_{first}"],
                                          "b": [fins_obj.name, f"fin_{second}", f"attach_{second}"], "label": f"fin_fin_{first}_{second}"})
    for name in fin_group_names:
        if name.endswith("_L"):
            contract["centerPlane"].append({"object": fins_obj.name, "group": f"fin_{name}", "exclude": f"attach_{name}", "side": -1})
        elif name.endswith("_R"):
            contract["centerPlane"].append({"object": fins_obj.name, "group": f"fin_{name}", "exclude": f"attach_{name}", "side": 1})
    contract["axialChain"] = {"bones": list(axial_names), "maxJointDegrees": float(spec.get("validation", {}).get("maxJointDegrees", 24.0)),
                              "maxJointDegreesResponse": float(spec.get("validation", {}).get("maxJointDegreesResponse", 36.0)),
                              "maxCumulativeDegrees": 75.0}
    contract["symmetry"] = [{"object": fins_obj.name, "left": f"fin_{n}", "right": f"fin_{n[:-2]}_R", "tolerance": 0.0004 * scale}
                            for n in fin_group_names if n.endswith("_L")]
    register_clips(contract, clips)

    return BuildResult(rig=rig, root=None, meshes=meshes, clips=clips, contract=contract,
                       preview_action=spec["clipRoles"]["locomotion"], textures=written,
                       notes={"bodyLengthMeters": body.length, "fins": fin_group_names})
