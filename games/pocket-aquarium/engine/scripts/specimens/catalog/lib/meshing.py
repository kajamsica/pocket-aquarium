"""Analytic mesh construction: lofts, tubes, membranes, ellipsoids and part assembly.

Every generator is pure Python over explicit coordinates so the same inputs
always produce the same vertex order, topology and UV layout. Geometry tuples are
(vertices, faces, vertex_uvs, face_uvs) where face_uvs holds per-corner UVs so
closed lofts stay manifold while their texture seam remains continuous.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import bpy
from mathutils import Vector


Vec3 = tuple[float, float, float]
UV = tuple[float, float]


@dataclass
class MeshPart:
    """A named, independently generated chunk of geometry with its own skin weights."""

    name: str
    vertices: list[Vec3]
    faces: list[tuple[int, ...]]
    uvs: list[UV]
    weights: list[dict[str, float]]
    material: str
    closed: bool = False
    groups: dict[str, set[int]] = field(default_factory=dict)
    colors: list[tuple[float, float, float, float]] | None = None
    face_materials: list[str] | None = None
    face_uvs: list[tuple[UV, ...]] | None = None

    def translate(self, offset: Vec3) -> "MeshPart":
        ox, oy, oz = offset
        self.vertices = [(x + ox, y + oy, z + oz) for x, y, z in self.vertices]
        return self

    def transform(self, matrix) -> "MeshPart":
        self.vertices = [tuple(matrix @ Vector(v)) for v in self.vertices]
        if self.closed and signed_volume(self.vertices, self.faces) < 0:
            self.flip()
        return self

    def flip(self) -> "MeshPart":
        self.faces = [tuple(reversed(face)) for face in self.faces]
        if self.face_uvs:
            self.face_uvs = [tuple(reversed(corners)) for corners in self.face_uvs]
        return self

    def mirror_y(self, rename: dict[str, str] | None = None) -> "MeshPart":
        """Return a bilateral copy mirrored across the XZ plane with reversed winding."""
        rename = rename or {}

        def rn(name: str) -> str:
            for old, new in rename.items():
                if name.endswith(old):
                    return name[: -len(old)] + new
            return name

        return MeshPart(
            name=rn(self.name),
            vertices=[(x, -y, z) for x, y, z in self.vertices],
            faces=[tuple(reversed(face)) for face in self.faces],
            uvs=list(self.uvs),
            weights=[{rn(k): w for k, w in item.items()} for item in self.weights],
            material=self.material,
            closed=self.closed,
            groups={rn(k): set(v) for k, v in self.groups.items()},
            colors=list(self.colors) if self.colors else None,
            face_materials=list(self.face_materials) if self.face_materials else None,
            face_uvs=[tuple(reversed(corners)) for corners in self.face_uvs] if self.face_uvs else None,
        )

    def bounds(self):
        xs = [v[0] for v in self.vertices]
        ys = [v[1] for v in self.vertices]
        zs = [v[2] for v in self.vertices]
        return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


def signed_volume(vertices, faces) -> float:
    total = 0.0
    for face in faces:
        a = Vector(vertices[face[0]])
        for i in range(1, len(face) - 1):
            b = Vector(vertices[face[i]])
            c = Vector(vertices[face[i + 1]])
            total += a.dot(b.cross(c))
    return total / 6.0


def ensure_outward(part: MeshPart) -> MeshPart:
    """Flip winding of a closed part whose signed volume is negative."""
    if part.closed and signed_volume(part.vertices, part.faces) < 0:
        part.flip()
    return part


def superellipse_ring(x: float, half_width: float, dorsal: float, ventral: float, center_y: float, center_z: float,
                      segments: int, exponent_dorsal: float, exponent_ventral: float, roll: float = 0.0) -> list[Vec3]:
    """Ring around +X with angle 0 at the dorsal ridge, increasing towards +Y."""
    ring = []
    for segment in range(segments):
        angle = segment / segments * math.tau + roll
        side = math.sin(angle)
        vertical = math.cos(angle)
        exponent = exponent_dorsal if vertical >= 0 else exponent_ventral
        y = math.copysign(abs(side) ** (2.0 / exponent), side) * half_width
        radius = dorsal if vertical >= 0 else ventral
        z = math.copysign(abs(vertical) ** (2.0 / exponent), vertical) * radius
        ring.append((x, center_y + y, center_z + z))
    return ring


def loft(rings: list[list[Vec3]], u_values: list[float] | None = None, cap_start: bool = True, cap_end: bool = True,
         v_offset: float = 0.0):
    """Quad loft through closed rings (equal vertex counts) with optional centre-fan caps.

    UVs: u follows the ring sequence (0 at first ring, 1 at last), v goes around the ring
    starting at ring vertex 0; wrap-around faces receive v = 1 corners so the seam is continuous.
    """
    segments = len(rings[0])
    if any(len(ring) != segments for ring in rings):
        raise ValueError("Loft rings must have equal vertex counts")
    count = len(rings)
    u_values = u_values or [index / max(count - 1, 1) for index in range(count)]
    vertices: list[Vec3] = []
    uvs: list[UV] = []
    faces: list[tuple[int, ...]] = []
    face_uvs: list[tuple[UV, ...]] = []

    def vtx_uv(ring_index: int, segment: int) -> UV:
        return (u_values[ring_index], segment / segments + v_offset)

    for ring_index, ring in enumerate(rings):
        for segment, coordinate in enumerate(ring):
            vertices.append(tuple(coordinate))
            uvs.append(vtx_uv(ring_index, segment))
    for ring_index in range(count - 1):
        for segment in range(segments):
            nxt = (segment + 1) % segments
            a = ring_index * segments + segment
            b = ring_index * segments + nxt
            c = (ring_index + 1) * segments + segment
            d = (ring_index + 1) * segments + nxt
            faces.append((a, c, d, b))
            face_uvs.append((vtx_uv(ring_index, segment), vtx_uv(ring_index + 1, segment),
                             vtx_uv(ring_index + 1, segment + 1), vtx_uv(ring_index, segment + 1)))
    if cap_start:
        center = tuple(sum(c[i] for c in rings[0]) / segments for i in range(3))
        center_index = len(vertices)
        vertices.append(center)
        uvs.append((u_values[0], 0.5 + v_offset))
        for segment in range(segments):
            nxt = (segment + 1) % segments
            faces.append((center_index, nxt, segment))
            face_uvs.append(((u_values[0], 0.5 + v_offset), vtx_uv(0, segment + 1), vtx_uv(0, segment)))
    if cap_end:
        center = tuple(sum(c[i] for c in rings[-1]) / segments for i in range(3))
        center_index = len(vertices)
        vertices.append(center)
        uvs.append((u_values[-1], 0.5 + v_offset))
        base = (count - 1) * segments
        for segment in range(segments):
            nxt = (segment + 1) % segments
            faces.append((center_index, base + segment, base + nxt))
            face_uvs.append(((u_values[-1], 0.5 + v_offset), vtx_uv(count - 1, segment), vtx_uv(count - 1, segment + 1)))
    return vertices, faces, uvs, face_uvs


def frames_along(points: list[Vec3], up_hint: Vec3 = (0.0, 0.0, 1.0)):
    """Rotation-minimising frames (tangent, normal, binormal) along a polyline."""
    tangents = []
    for index in range(len(points)):
        previous = Vector(points[max(index - 1, 0)])
        following = Vector(points[min(index + 1, len(points) - 1)])
        tangent = following - previous
        if tangent.length < 1e-12:
            tangent = Vector((1.0, 0.0, 0.0))
        tangents.append(tangent.normalized())
    normal = Vector(up_hint)
    if abs(normal.dot(tangents[0])) > 0.95:
        normal = Vector((0.0, 1.0, 0.0))
        if abs(normal.dot(tangents[0])) > 0.95:
            normal = Vector((1.0, 0.0, 0.0))
    normal = (normal - tangents[0] * normal.dot(tangents[0])).normalized()
    frames = []
    for index, tangent in enumerate(tangents):
        if index:
            normal = normal - tangent * normal.dot(tangent)
            if normal.length < 1e-9:
                normal = tangent.orthogonal()
            normal = normal.normalized()
        binormal = tangent.cross(normal).normalized()
        frames.append((tangent, normal.copy(), binormal))
    return frames


def tube(points: list[Vec3], radii: list[float], segments: int = 8, cap_start: bool = True, cap_end: bool = True,
         up_hint: Vec3 = (0.0, 0.0, 1.0), aspect: float = 1.0, ring_fn=None, u_values=None):
    """Closed tube around a polyline. `ring_fn(index, angle)` may return a radius multiplier."""
    frames = frames_along(points, up_hint)
    rings = []
    for index, (point, radius) in enumerate(zip(points, radii)):
        _tangent, normal, binormal = frames[index]
        ring = []
        for segment in range(segments):
            angle = segment / segments * math.tau
            factor = ring_fn(index, angle) if ring_fn else 1.0
            offset = normal * (math.cos(angle) * radius * factor) + binormal * (math.sin(angle) * radius * aspect * factor)
            ring.append(tuple(Vector(point) + offset))
        rings.append(ring)
    return loft(rings, u_values=u_values, cap_start=cap_start, cap_end=cap_end)


def ellipsoid(center: Vec3, radii: Vec3, segments: int = 16, rings: int = 10, axis_rotation=None):
    """Analytic UV ellipsoid (closed) with poles on the local Z axis."""
    cx, cy, cz = center
    rx, ry, rz = radii
    ring_list = []
    for ring in range(1, rings):
        phi = ring / rings * math.pi
        z = math.cos(phi)
        s = math.sin(phi)
        current = []
        for segment in range(segments):
            theta = segment / segments * math.tau
            local = Vector((math.cos(theta) * s * rx, math.sin(theta) * s * ry, z * rz))
            if axis_rotation is not None:
                local = axis_rotation @ local
            current.append((cx + local.x, cy + local.y, cz + local.z))
        ring_list.append(current)
    verts, faces, uvs, face_uvs = loft(ring_list, cap_start=False, cap_end=False)
    top = Vector((0, 0, rz))
    bottom = Vector((0, 0, -rz))
    if axis_rotation is not None:
        top = axis_rotation @ top
        bottom = axis_rotation @ bottom
    top_index = len(verts)
    verts.append((cx + top.x, cy + top.y, cz + top.z))
    uvs.append((0.0, 0.5))
    bottom_index = len(verts)
    verts.append((cx + bottom.x, cy + bottom.y, cz + bottom.z))
    uvs.append((1.0, 0.5))
    base = (rings - 2) * segments
    for segment in range(segments):
        nxt = (segment + 1) % segments
        faces.append((top_index, nxt, segment))
        face_uvs.append(((0.0, 0.5), (0.0, (segment + 1) / segments), (0.0, segment / segments)))
        faces.append((bottom_index, base + segment, base + nxt))
        face_uvs.append(((1.0, 0.5), (1.0, segment / segments), (1.0, (segment + 1) / segments)))
    return verts, faces, uvs, face_uvs


def membrane(rows: list[list[Vec3]]):
    """Open triangulated sheet from rows of equal length (row 0 is the attachment base)."""
    row_count = len(rows)
    column_count = len(rows[0])
    if any(len(row) != column_count for row in rows):
        raise ValueError("Inconsistent membrane grid")
    vertices: list[Vec3] = []
    uvs: list[UV] = []
    faces: list[tuple[int, ...]] = []
    for row_index, row in enumerate(rows):
        for column_index, coordinate in enumerate(row):
            vertices.append(tuple(coordinate))
            uvs.append((column_index / max(column_count - 1, 1), row_index / max(row_count - 1, 1)))
    for row in range(row_count - 1):
        for column in range(column_count - 1):
            a = row * column_count + column
            b = a + 1
            c = (row + 1) * column_count + column
            d = c + 1
            faces.extend(((a, c, d), (a, d, b)))
    return vertices, faces, uvs, None


def make_part(name: str, geometry, material: str, weight_fn, closed: bool, groups: dict[str, set[int]] | None = None,
              uv_transform=None, color_fn=None) -> MeshPart:
    vertices, faces, uvs, face_uvs = geometry
    if uv_transform:
        uvs = [uv_transform(u, v) for u, v in uvs]
        if face_uvs:
            face_uvs = [tuple(uv_transform(u, v) for u, v in corners) for corners in face_uvs]
    weights = [weight_fn(index, vertex) for index, vertex in enumerate(vertices)]
    colors = [color_fn(index, vertex) for index, vertex in enumerate(vertices)] if color_fn else None
    part = MeshPart(name=name, vertices=list(vertices), faces=list(faces), uvs=list(uvs), weights=weights,
                    material=material, closed=closed, groups=groups or {}, colors=colors, face_uvs=face_uvs)
    return ensure_outward(part)


def assemble(object_name: str, parts: list[MeshPart], materials: dict[str, bpy.types.Material], rig=None,
             modifier_name: str = "Armature", color_attribute: str | None = None, preserve_volume: bool = True):
    """Merge parts into one mesh object with per-part vertex groups and skin weights."""
    vertices: list[Vec3] = []
    faces: list[tuple[int, ...]] = []
    loop_uvs: list[UV] = []
    face_material_names: list[str] = []
    weights: list[dict[str, float]] = []
    groups: dict[str, set[int]] = {}
    colors: list[tuple[float, float, float, float]] = []
    any_colors = any(part.colors for part in parts)
    for part in parts:
        offset = len(vertices)
        vertices.extend(part.vertices)
        weights.extend(part.weights)
        if any_colors:
            colors.extend(part.colors or [(1.0, 1.0, 1.0, 1.0)] * len(part.vertices))
        for face_index, face in enumerate(part.faces):
            faces.append(tuple(index + offset for index in face))
            face_material_names.append(part.face_materials[face_index] if part.face_materials else part.material)
            if part.face_uvs:
                loop_uvs.extend(part.face_uvs[face_index])
            else:
                loop_uvs.extend(part.uvs[index] for index in face)
        part_group = groups.setdefault(f"part_{part.name}", set())
        part_group.update(range(offset, offset + len(part.vertices)))
        for group_name, members in part.groups.items():
            groups.setdefault(group_name, set()).update(index + offset for index in members)
    mesh = bpy.data.meshes.new(object_name)
    mesh.from_pydata(vertices, [], faces)
    material_names = sorted({name for name in face_material_names})
    material_index = {}
    for name in material_names:
        material_index[name] = len(mesh.materials)
        mesh.materials.append(materials[name])
    for polygon, name in zip(mesh.polygons, face_material_names):
        polygon.material_index = material_index[name]
        polygon.use_smooth = True
    uv_layer = mesh.uv_layers.new(name="UVMap")
    flat_uv = [channel for uv in loop_uvs for channel in uv]
    if len(flat_uv) != len(uv_layer.data) * 2:
        raise RuntimeError(f"Loop UV count mismatch on {object_name}: {len(flat_uv) // 2} vs {len(uv_layer.data)}")
    uv_layer.data.foreach_set("uv", flat_uv)
    if any_colors and color_attribute:
        attribute = mesh.color_attributes.new(name=color_attribute, type="FLOAT_COLOR", domain="POINT")
        attribute.data.foreach_set("color", [channel for color in colors for channel in color])
        mesh.color_attributes.active_color = attribute
        mesh.color_attributes.render_color_index = 0
    mesh.update()
    obj = bpy.data.objects.new(object_name, mesh)
    bpy.context.collection.objects.link(obj)
    for name, members in groups.items():
        group = obj.vertex_groups.new(name=name)
        if members:
            group.add(sorted(members), 1.0, "REPLACE")
    if rig is not None:
        bone_names = sorted({bone for item in weights for bone in item})
        bone_groups = {name: obj.vertex_groups.new(name=name) for name in bone_names}
        for index, item in enumerate(weights):
            total = sum(item.values())
            if total <= 0:
                raise RuntimeError(f"Vertex {index} on {object_name} has no deform weight")
            for bone, weight in item.items():
                if weight > 0:
                    bone_groups[bone].add([index], weight / total, "REPLACE")
        modifier = obj.modifiers.new(name=modifier_name, type="ARMATURE")
        modifier.object = rig
        modifier.use_deform_preserve_volume = preserve_volume
        obj.parent = rig
    return obj


def smoothstep(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def blend_weights(first: dict[str, float], second: dict[str, float], t: float) -> dict[str, float]:
    out: dict[str, float] = {}
    for name, weight in first.items():
        out[name] = out.get(name, 0.0) + weight * (1.0 - t)
    for name, weight in second.items():
        out[name] = out.get(name, 0.0) + weight * t
    return {name: weight for name, weight in out.items() if weight > 1e-6}
