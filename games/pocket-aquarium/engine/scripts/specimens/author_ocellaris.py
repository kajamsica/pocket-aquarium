"""Ocellaris-specific Blender backend for the package-driven specimen builder.

The asset is built from project-owned anatomical profiles and procedural texture
masks. Reference images guide proportions only. No source pixels are sampled.
Run only with the pinned Blender binary recorded in art/toolchain.json.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector


SPECIES = "ocellaris"
SCIENTIFIC_NAME = "Amphiprion ocellaris"
VERSION = "1.1.0"
ADULT_LENGTH_METERS = 0.08
ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "art" / "specimens" / SPECIES
TEXTURE_DIR = SOURCE_DIR / "textures"
GLB_DIR = ROOT / "src" / "assets" / "specimens" / SPECIES / "v1"
BLEND_PATH = SOURCE_DIR / "ocellaris.blend"
GLB_PATH = GLB_DIR / "lod1.glb"
MANIFEST_PATH = SOURCE_DIR / "ocellaris.asset.json"
PREVIEW_PATH = SOURCE_DIR / "renders" / "lod1-author-preview.png"
SOURCE_VALIDATION_PATH = SOURCE_DIR / "validation-source.json"
RUNTIME_VALIDATION_PATH = SOURCE_DIR / "validation-runtime.json"
EXPORT_SCRIPT_PATH = Path(__file__).resolve()
VALIDATOR_SCRIPT_PATH = Path(__file__).with_name("validate_ocellaris.py")
SOURCE_MANIFEST_NAME = "ocellaris.asset.json"

MORPHOLOGY = json.loads((SOURCE_DIR / "morphology.profile.json").read_text(encoding="utf-8"))
BODY_STATIONS = tuple(
    (item["x"], item["halfWidth"], item["dorsalHeight"], item["ventralDepth"], item["centerZ"])
    for item in MORPHOLOGY["controlStations"]
)
CROSS_SECTION_EXPONENT = MORPHOLOGY["sampling"]["crossSectionExponent"]
AXIAL_BONES = ("Body", "Spine_A", "Spine_B", "Peduncle", "Caudal")
ANIMATED_BONES = AXIAL_BONES + (
    "Pectoral_L", "Pectoral_R", "Dorsal", "Anal", "Pelvic_L", "Pelvic_R", "Jaw", "Gill"
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.meshes, bpy.data.curves, bpy.data.armatures, bpy.data.materials,
        bpy.data.actions, bpy.data.images, bpy.data.cameras, bpy.data.lights,
    ):
        for datablock in list(datablocks):
            datablocks.remove(datablock)


def interpolate_station(x: float) -> tuple[float, float, float, float]:
    if x <= BODY_STATIONS[0][0]:
        return BODY_STATIONS[0][1:]
    if x >= BODY_STATIONS[-1][0]:
        return BODY_STATIONS[-1][1:]
    for left, right in zip(BODY_STATIONS, BODY_STATIONS[1:]):
        if left[0] <= x <= right[0]:
            t = (x - left[0]) / (right[0] - left[0])
            return tuple(left[index] + (right[index] - left[index]) * t for index in range(1, 5))
    raise ValueError(x)


STATIONS = tuple((x, *interpolate_station(x)) for x in MORPHOLOGY["sampling"]["ringPositions"])


def write_image(name: str, path: Path, width: int, height: int, pixel_fn, non_color: bool = False):
    image = bpy.data.images.new(name, width=width, height=height, alpha=True)
    pixels: list[float] = []
    for row in range(height):
        v = row / max(height - 1, 1)
        for column in range(width):
            u = column / max(width - 1, 1)
            pixels.extend(pixel_fn(u, v))
    image.pixels.foreach_set(pixels)
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    if non_color:
        image.colorspace_settings.name = "Non-Color"
    image.save()
    image.pack()
    return image


def body_albedo(u: float, v: float):
    x = BODY_STATIONS[0][0] + u * (BODY_STATIONS[-1][0] - BODY_STATIONS[0][0])
    theta = v * math.tau
    centers = (
        0.0270 + 0.0016 * math.cos(theta - 0.35),
        0.0040 + 0.0028 * math.cos(theta + 0.22),
        -0.0207 + 0.0012 * math.cos(theta - 0.15),
    )
    half_widths = (0.0034, 0.0045, 0.0032)
    distance = min(abs(x - center) - half for center, half in zip(centers, half_widths))
    scale = 1.0 + 0.035 * math.sin(theta * 5 + u * 17) + 0.018 * math.sin(theta * 13 - u * 9)
    if distance <= 0:
        base = (0.82, 0.82, 0.75)
    elif distance <= 0.00115:
        base = (0.010, 0.008, 0.006)
    else:
        base = (0.82 * scale, 0.205 * scale, 0.018 * scale)
    return (*base, 1.0)


def body_roughness(u: float, v: float):
    value = 0.40 + 0.045 * math.sin(u * 41 + v * 19) * math.sin(v * 31 - u * 11)
    return (value, value, value, 1.0)


def body_normal(u: float, v: float):
    nx = 0.5 + 0.045 * math.sin(u * 83 + v * 29)
    ny = 0.5 + 0.035 * math.sin(v * 97 - u * 17)
    return (nx, ny, 1.0, 1.0)


def fin_albedo(u: float, v: float):
    margin = v > 0.82 or u < 0.025 or u > 0.975
    ray = 0.84 + 0.12 * max(math.sin(u * math.pi * 27), 0) * v
    if margin:
        return (0.008, 0.006, 0.004, 0.96)
    return (0.73 * ray, 0.135 * ray, 0.012 * ray, 0.82)


def make_principled(name: str, color, roughness: float, coat: float = 0.0):
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    result.diffuse_color = color
    result.use_backface_culling = False
    shader = result.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Metallic"].default_value = 0.0
    shader.inputs["Roughness"].default_value = roughness
    if "Coat Weight" in shader.inputs:
        shader.inputs["Coat Weight"].default_value = coat
        shader.inputs["Coat Roughness"].default_value = 0.24
    if "Subsurface Weight" in shader.inputs:
        shader.inputs["Subsurface Weight"].default_value = 0.035
    return result


def make_body_material(images):
    result = make_principled("PA_ocellaris_Skin", (0.82, 0.205, 0.018, 1), 0.40, 0.16)
    nodes = result.node_tree.nodes
    links = result.node_tree.links
    shader = nodes.get("Principled BSDF")
    albedo = nodes.new("ShaderNodeTexImage")
    albedo.name = "Ocellaris continuous band mask"
    albedo.image = images["albedo"]
    links.new(albedo.outputs["Color"], shader.inputs["Base Color"])
    roughness = nodes.new("ShaderNodeTexImage")
    roughness.image = images["roughness"]
    links.new(roughness.outputs["Color"], shader.inputs["Roughness"])
    normal_texture = nodes.new("ShaderNodeTexImage")
    normal_texture.image = images["normal"]
    normal_map = nodes.new("ShaderNodeNormalMap")
    normal_map.inputs["Strength"].default_value = 0.18
    links.new(normal_texture.outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], shader.inputs["Normal"])
    return result


def make_fin_material(image):
    result = make_principled("PA_ocellaris_Fin", (0.73, 0.135, 0.012, 0.82), 0.47, 0.07)
    nodes = result.node_tree.nodes
    links = result.node_tree.links
    shader = nodes.get("Principled BSDF")
    texture = nodes.new("ShaderNodeTexImage")
    texture.name = "Fin rays and dark margin"
    texture.image = image
    links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    links.new(texture.outputs["Alpha"], shader.inputs["Alpha"])
    if hasattr(result, "surface_render_method"):
        result.surface_render_method = "DITHERED"
    return result


def create_materials():
    TEXTURE_DIR.mkdir(parents=True, exist_ok=True)
    images = {
        "albedo": write_image("PA_ocellaris_Albedo", TEXTURE_DIR / "body-albedo.png", 384, 192, body_albedo),
        "roughness": write_image("PA_ocellaris_Roughness", TEXTURE_DIR / "body-roughness.png", 192, 96, body_roughness, True),
        "normal": write_image("PA_ocellaris_Normal", TEXTURE_DIR / "body-normal.png", 192, 96, body_normal, True),
    }
    fin_image = write_image("PA_ocellaris_FinMask", TEXTURE_DIR / "fin-mask.png", 256, 128, fin_albedo)
    return {
        "skin": make_body_material(images),
        "white": make_principled("PA_ocellaris_White", (0.78, 0.79, 0.74, 1), 0.42, 0.12),
        "black": make_principled("PA_ocellaris_Black", (0.006, 0.004, 0.003, 1), 0.37, 0.10),
        "fin": make_fin_material(fin_image),
        "eye": make_principled("PA_Eye", (0.06, 0.018, 0.005, 1), 0.12, 0.58),
        "cue": make_principled("PA_ocellaris_Cue", (0.10, 0.025, 0.009, 1), 0.46, 0.06),
    }


def create_rig():
    data = bpy.data.armatures.new("PA_ocellaris_Rig")
    rig = bpy.data.objects.new("PA_ocellaris_Rig", data)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    def bone(name: str, head, tail, parent: str | None = None, connected: bool = False, deform: bool = True):
        result = data.edit_bones.new(name)
        result.head = head
        result.tail = tail
        result.use_deform = deform
        if parent:
            result.parent = data.edit_bones[parent]
            result.use_connect = connected
        result.align_roll(Vector((0, 0, 1)))
        return result

    bone("Root", (0.045, 0, 0), (0.041, 0, 0), deform=False)
    bone("Body", (0.041, 0, 0), (0.018, 0, 0), "Root")
    bone("Spine_A", (0.018, 0, 0), (0.004, 0, 0), "Body", True)
    bone("Spine_B", (0.004, 0, 0), (-0.010, 0, 0), "Spine_A", True)
    bone("Peduncle", (-0.010, 0, 0), (-0.028, 0, 0), "Spine_B", True)
    bone("Caudal", (-0.028, 0, 0), (-0.039, 0, 0), "Peduncle", True)
    bone("Pectoral_L", (0.020, -0.0082, 0.001), (0.006, -0.015, -0.004), "Body")
    bone("Pectoral_R", (0.020, 0.0082, 0.001), (0.006, 0.015, -0.004), "Body")
    bone("Dorsal", (0.021, 0, 0.015), (-0.014, 0, 0.020), "Spine_A")
    bone("Anal", (0.008, 0, -0.014), (-0.018, 0, -0.018), "Spine_B")
    bone("Pelvic_L", (0.011, -0.004, -0.012), (-0.003, -0.007, -0.019), "Spine_A")
    bone("Pelvic_R", (0.011, 0.004, -0.012), (-0.003, 0.007, -0.019), "Spine_A")
    bone("Jaw", (0.033, 0, -0.003), (0.043, 0, -0.004), "Body")
    bone("Gill", (0.024, 0, 0.004), (0.017, 0, -0.005), "Body")
    bpy.ops.object.mode_set(mode="OBJECT")
    rig["speciesId"] = SPECIES
    rig["presentationOnly"] = True
    rig.show_in_front = True
    return rig


def smoothstep(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def axial_weights(x: float) -> dict[str, float]:
    spans = (
        (0.018, 0.006, "Body", "Spine_A"),
        (0.006, -0.008, "Spine_A", "Spine_B"),
        (-0.008, -0.021, "Spine_B", "Peduncle"),
        (-0.021, -0.030, "Peduncle", "Caudal"),
    )
    if x >= spans[0][0]:
        return {"Body": 1.0}
    if x <= spans[-1][1]:
        return {"Caudal": 1.0}
    for anterior, posterior, first, second in spans:
        if posterior <= x <= anterior:
            t = smoothstep((anterior - x) / (anterior - posterior))
            return {first: 1.0 - t, second: t}
    return {"Body": 1.0}


def add_groups(obj, groups: dict[str, set[int]]) -> None:
    for name, indices in groups.items():
        group = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
        if indices:
            group.add(sorted(indices), 1.0, "REPLACE")


def skin_object(obj, rig, weights, extra_groups: dict[str, set[int]] | None = None):
    names = sorted({name for item in weights for name in item})
    groups = {name: obj.vertex_groups.new(name=name) for name in names}
    for index, item in enumerate(weights):
        total = sum(item.values())
        if total <= 0:
            raise RuntimeError(f"Vertex {index} on {obj.name} has no deform weight")
        for name, weight in item.items():
            groups[name].add([index], weight / total, "REPLACE")
    if extra_groups:
        add_groups(obj, extra_groups)
    modifier = obj.modifiers.new(name="PA_ocellaris_Armature", type="ARMATURE")
    modifier.object = rig
    modifier.use_deform_preserve_volume = True
    obj.parent = rig


def create_body(rig, materials):
    segments = 48
    vertices: list[tuple[float, float, float]] = []
    uvs: list[tuple[float, float]] = []
    faces: list[tuple[int, ...]] = []
    tail_x, head_x = STATIONS[0][0], STATIONS[-1][0]
    for x, lateral, top, bottom, center_z in STATIONS:
        for segment in range(segments):
            angle = segment / segments * math.tau
            side = math.sin(angle)
            vertical = math.cos(angle)
            exponent = CROSS_SECTION_EXPONENT
            y = math.copysign(abs(side) ** (2.0 / exponent), side) * lateral
            radius = top if vertical >= 0 else bottom
            z = center_z + math.copysign(abs(vertical) ** (2.0 / exponent), vertical) * radius
            vertices.append((x, y, z))
            uvs.append(((x - tail_x) / (head_x - tail_x), segment / segments))
    for ring in range(len(STATIONS) - 1):
        for segment in range(segments):
            nxt = (segment + 1) % segments
            a = ring * segments + segment
            b = ring * segments + nxt
            c = (ring + 1) * segments + segment
            d = (ring + 1) * segments + nxt
            faces.append((a, c, d, b))
    tail_center = len(vertices)
    vertices.append((tail_x, 0, STATIONS[0][4]))
    uvs.append((0.0, 0.5))
    head_center = len(vertices)
    vertices.append((head_x, 0, STATIONS[-1][4]))
    uvs.append((1.0, 0.5))
    for segment in range(segments):
        nxt = (segment + 1) % segments
        faces.append((tail_center, nxt, segment))
        head_a = (len(STATIONS) - 1) * segments + segment
        head_b = (len(STATIONS) - 1) * segments + nxt
        faces.append((head_center, head_a, head_b))

    mesh = bpy.data.meshes.new("PA_ocellaris_Body")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(materials["skin"])
    for polygon in mesh.polygons:
        polygon.material_index = 0
        polygon.use_smooth = True
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            uv_layer.data[loop_index].uv = uvs[mesh.loops[loop_index].vertex_index]
    mesh.update()
    body = bpy.data.objects.new("PA_ocellaris_Body", mesh)
    bpy.context.collection.objects.link(body)

    groups: dict[str, set[int]] = {
        "zone_head": set(), "zone_anterior": set(), "zone_midbody": set(),
        "zone_peduncle": set(), "zone_caudal": set(),
        "attach_caudal": set(), "attach_dorsal": set(), "attach_anal": set(),
        "attach_pectoral_L": set(), "attach_pectoral_R": set(),
        "attach_pelvic_L": set(), "attach_pelvic_R": set(),
    }
    for index, (x, y, z) in enumerate(vertices):
        if x >= 0.020:
            groups["zone_head"].add(index)
        elif x >= 0.006:
            groups["zone_anterior"].add(index)
        elif x >= -0.009:
            groups["zone_midbody"].add(index)
        elif x >= -0.025:
            groups["zone_peduncle"].add(index)
        else:
            groups["zone_caudal"].add(index)
        lateral, top, bottom, center_z = interpolate_station(x)
        if x <= -0.0275:
            groups["attach_caudal"].add(index)
        if -0.015 <= x <= 0.024 and z >= center_z + top * 0.80:
            groups["attach_dorsal"].add(index)
        if -0.019 <= x <= 0.010 and z <= center_z - bottom * 0.80:
            groups["attach_anal"].add(index)
        if 0.009 <= x <= 0.023 and y <= -lateral * 0.82:
            groups["attach_pectoral_L"].add(index)
        if 0.009 <= x <= 0.023 and y >= lateral * 0.82:
            groups["attach_pectoral_R"].add(index)
        if -0.003 <= x <= 0.012 and z <= center_z - bottom * 0.76 and y < 0:
            groups["attach_pelvic_L"].add(index)
        if -0.003 <= x <= 0.012 and z <= center_z - bottom * 0.76 and y > 0:
            groups["attach_pelvic_R"].add(index)

    skin_object(body, rig, [axial_weights(vertex[0]) for vertex in vertices], groups)
    body["adultLengthMeters"] = ADULT_LENGTH_METERS
    body["lod"] = 1
    return body


def append_membrane(vertices, faces, uvs, assignments, groups, name, rows, row_weights):
    start = len(vertices)
    row_count = len(rows)
    column_count = len(rows[0])
    if any(len(row) != column_count for row in rows):
        raise RuntimeError(f"Inconsistent membrane grid: {name}")
    membrane_group = groups.setdefault(f"fin_{name}", set())
    attachment_group = groups.setdefault(f"attach_{name}", set())
    for row_index, row in enumerate(rows):
        for column_index, coordinate in enumerate(row):
            index = len(vertices)
            vertices.append(coordinate)
            uvs.append((column_index / max(column_count - 1, 1), row_index / max(row_count - 1, 1)))
            assignments.append(row_weights(row_index / max(row_count - 1, 1), coordinate))
            membrane_group.add(index)
            if row_index <= 1:
                attachment_group.add(index)
    for row in range(row_count - 1):
        for column in range(column_count - 1):
            a = start + row * column_count + column
            b = a + 1
            c = start + (row + 1) * column_count + column
            d = c + 1
            faces.extend(((a, c, d), (a, d, b)))


def create_fins(rig, fin_material):
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int]] = []
    uvs: list[tuple[float, float]] = []
    assignments: list[dict[str, float]] = []
    groups: dict[str, set[int]] = {}

    caudal_rows = []
    for row_index, (x, height) in enumerate(((-0.0290, 0.0042), (-0.0320, 0.0093), (-0.0352, 0.0130), (-0.0380, 0.0138))):
        t = row_index / 3
        row = []
        for column in range(9):
            s = column / 8
            z = (s * 2 - 1) * height
            rounded = abs(s * 2 - 1) ** 1.6
            row.append((x + 0.0012 * rounded * t, 0.00035 * math.sin(math.pi * s) * t, z))
        caudal_rows.append(row)
    append_membrane(vertices, faces, uvs, assignments, groups, "caudal", caudal_rows,
                    lambda t, _co: {"Peduncle": 1.0 - t, "Caudal": t})

    dorsal_rows = []
    for row_index in range(4):
        t = row_index / 3
        row = []
        for column in range(10):
            s = column / 9
            x = -0.015 + s * 0.039 + (0.5 - s) * 0.0015 * t
            _, top, _, center_z = interpolate_station(x)
            height = (0.0020 + 0.0100 * math.sin(math.pi * s) ** 0.72) * t
            row.append((x, 0, center_z + top + 0.00015 + height))
        dorsal_rows.append(row)
    append_membrane(vertices, faces, uvs, assignments, groups, "dorsal", dorsal_rows,
                    lambda t, co: {**{name: weight * (1.0 - t) for name, weight in axial_weights(co[0]).items()}, "Dorsal": t})

    anal_rows = []
    for row_index in range(4):
        t = row_index / 3
        row = []
        for column in range(8):
            s = column / 7
            x = -0.019 + s * 0.029 + (0.5 - s) * 0.0012 * t
            _, _, bottom, center_z = interpolate_station(x)
            height = (0.0015 + 0.0078 * math.sin(math.pi * s) ** 0.72) * t
            row.append((x, 0, center_z - bottom - 0.00015 - height))
        anal_rows.append(row)
    append_membrane(vertices, faces, uvs, assignments, groups, "anal", anal_rows,
                    lambda t, co: {**{name: weight * (1.0 - t) for name, weight in axial_weights(co[0]).items()}, "Anal": t})

    for side, suffix in ((-1, "L"), (1, "R")):
        pectoral_rows = []
        for row_index in range(4):
            t = row_index / 3
            row = []
            for column in range(6):
                s = column / 5
                root_x = 0.022 - s * 0.012
                lateral, _, _, center_z = interpolate_station(root_x)
                extension = 0.28 + 0.72 * math.sin(math.pi * s) ** 0.7
                row.append((
                    root_x - t * (0.010 + 0.006 * s) * extension,
                    side * (lateral + 0.00015 + t * (0.008 + 0.006 * extension)),
                    center_z + 0.003 - s * 0.005 - t * (0.005 + 0.003 * s) * extension,
                ))
            pectoral_rows.append(row)
        append_membrane(vertices, faces, uvs, assignments, groups, f"pectoral_{suffix}", pectoral_rows,
                        lambda t, _co, bone=f"Pectoral_{suffix}": {"Body": 1.0 - t, bone: t})

        pelvic_rows = []
        for row_index in range(4):
            t = row_index / 3
            row = []
            for column in range(5):
                s = column / 4
                root_x = 0.011 - s * 0.013
                lateral, _, bottom, center_z = interpolate_station(root_x)
                extension = 0.32 + 0.68 * math.sin(math.pi * s) ** 0.75
                row.append((
                    root_x - t * 0.005 * extension,
                    side * (lateral * 0.35 + t * 0.0045 * extension),
                    center_z - bottom - 0.0001 - t * (0.0065 + 0.002 * s) * extension,
                ))
            pelvic_rows.append(row)
        append_membrane(vertices, faces, uvs, assignments, groups, f"pelvic_{suffix}", pelvic_rows,
                        lambda t, _co, bone=f"Pelvic_{suffix}": {"Spine_A": 1.0 - t, bone: t})

    mesh = bpy.data.meshes.new("PA_ocellaris_Fins")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(fin_material)
    for polygon in mesh.polygons:
        polygon.material_index = 0
        polygon.use_smooth = True
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            uv_layer.data[loop_index].uv = uvs[mesh.loops[loop_index].vertex_index]
    mesh.update()
    fins = bpy.data.objects.new("PA_ocellaris_Fins", mesh)
    bpy.context.collection.objects.link(fins)
    skin_object(fins, rig, assignments, groups)
    fins["adultLengthMeters"] = ADULT_LENGTH_METERS
    fins["lod"] = 1
    return fins


def join_objects(objects, name: str):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    result = bpy.context.object
    result.name = name
    return result


def ellipsoid(name, location, scale, material, segments=24, rings=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def create_eyes_and_cues(rig, materials):
    eyes, pupils, glints = [], [], []
    for side, suffix in ((-1, "L"), (1, "R")):
        lateral = interpolate_station(0.0305)[0]
        eyes.append(ellipsoid(f"PA_ocellaris_Eye_{suffix}", (0.0305, side * (lateral + 0.00012), 0.0062),
                              (0.00235, 0.00072, 0.00235), materials["eye"]))
        pupils.append(ellipsoid(f"PA_ocellaris_Pupil_{suffix}", (0.0308, side * (lateral + 0.00070), 0.0062),
                                (0.00125, 0.00030, 0.00125), materials["black"], 20, 12))
        glints.append(ellipsoid(f"PA_ocellaris_Glint_{suffix}", (0.0314, side * (lateral + 0.00098), 0.0070),
                                (0.00028, 0.00010, 0.00028), materials["white"], 12, 8))
    for collection, name in ((eyes, "PA_ocellaris_Eyes"), (pupils, "PA_ocellaris_Pupils"), (glints, "PA_ocellaris_EyeGlints")):
        joined = join_objects(collection, name)
        skin_object(joined, rig, [{"Body": 1.0} for _ in joined.data.vertices])
        joined.select_set(False)

    def cue(name, points, radius, bone_name, material):
        curve = bpy.data.curves.new(name, type="CURVE")
        curve.dimensions = "3D"
        curve.bevel_depth = radius
        curve.bevel_resolution = 2
        spline = curve.splines.new("BEZIER")
        spline.bezier_points.add(len(points) - 1)
        for point, coordinate in zip(spline.bezier_points, points):
            point.co = coordinate
            point.handle_left_type = "AUTO"
            point.handle_right_type = "AUTO"
        obj = bpy.data.objects.new(name, curve)
        bpy.context.collection.objects.link(obj)
        curve.materials.append(material)
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.convert(target="MESH")
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        skin_object(obj, rig, [{bone_name: 1.0} for _ in obj.data.vertices])
        obj.select_set(False)

    for side, suffix in ((-1, "L"), (1, "R")):
        lateral = interpolate_station(0.0215)[0]
        cue(f"PA_ocellaris_Gill_{suffix}",
            [(0.0225, side * (lateral + 0.00008), 0.008),
             (0.0195, side * (lateral + 0.00012), 0.001),
             (0.0215, side * (lateral + 0.00008), -0.007)],
            0.00020, "Gill", materials["cue"])
    cue("PA_ocellaris_Mouth",
        [(0.0404, -0.0013, -0.0025), (0.0423, 0, -0.0032), (0.0404, 0.0013, -0.0025)],
        0.00032, "Jaw", materials["cue"])
    cue("PA_ocellaris_LowerLip",
        [(0.0398, -0.0012, -0.0041), (0.0416, 0, -0.0045), (0.0398, 0.0012, -0.0041)],
        0.00025, "Jaw", materials["white"])


def identity_pose(rig):
    for pose in rig.pose.bones:
        pose.rotation_mode = "QUATERNION"
        pose.rotation_quaternion = Quaternion((1, 0, 0, 0))
        pose.location = (0, 0, 0)
        pose.scale = (1, 1, 1)


def add_animation(rig, name: str, duration: int, axial_degrees, fin_degrees: float, loop: bool):
    action = bpy.data.actions.new(name=name)
    action.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = action
    for frame in range(1, duration + 1):
        t = (frame - 1) / max(duration - 1, 1)
        phase = math.tau * t
        identity_pose(rig)
        for bone_name, amplitude in zip(AXIAL_BONES[1:], axial_degrees):
            harmonic = math.sin(phase) - 0.14 * (amplitude / max(axial_degrees)) * math.sin(phase * 2)
            rig.pose.bones[bone_name].rotation_quaternion = Quaternion((0, 0, 1), math.radians(amplitude) * harmonic)
        paired = math.sin(phase * 2)
        for suffix, side in (("L", -1), ("R", 1)):
            rig.pose.bones[f"Pectoral_{suffix}"].rotation_quaternion = Quaternion((1, 0, 0), side * math.radians(fin_degrees) * paired)
            rig.pose.bones[f"Pelvic_{suffix}"].rotation_quaternion = Quaternion((1, 0, 0), side * math.radians(fin_degrees * 0.32) * paired)
        rig.pose.bones["Dorsal"].rotation_quaternion = Quaternion((1, 0, 0), math.radians(fin_degrees * 0.12) * math.sin(phase))
        rig.pose.bones["Anal"].rotation_quaternion = Quaternion((1, 0, 0), -math.radians(fin_degrees * 0.10) * math.sin(phase))
        rig.pose.bones["Gill"].rotation_quaternion = Quaternion((0, 0, 1), math.radians(1.2) * math.sin(phase * 2))
        rig.pose.bones["Jaw"].rotation_quaternion = Quaternion((0, 1, 0), math.radians(0.8) * max(math.sin(phase * 2), 0))
        for bone_name in ANIMATED_BONES:
            rig.pose.bones[bone_name].keyframe_insert(data_path="rotation_quaternion", frame=frame, group=bone_name)
    action.frame_start = 1
    action.frame_end = duration
    action["loop"] = loop
    rig.animation_data.action = None
    return action


def create_animations(rig):
    return (
        add_animation(rig, "idle", 72, (1.2, 2.4, 4.0, 6.0), 5.0, True),
        add_animation(rig, "swim", 36, (2.0, 4.5, 8.0, 13.0), 9.0, True),
        add_animation(rig, "burst", 22, (3.0, 7.0, 13.0, 23.0), 13.0, False),
    )


def configure_preview(rig, action):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 960
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(PREVIEW_PATH)
    scene.world.color = (0.16, 0.17, 0.18)
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -0.85
    bpy.ops.object.camera_add(location=(0.105, -0.185, 0.062))
    camera = bpy.context.object
    camera.name = "AuthorPreviewCamera"
    camera.data.lens = 62
    scene.camera = camera
    camera.rotation_euler = (Vector((0, 0, 0)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    for location, energy, size, color in (
        ((0.06, -0.09, 0.13), 62, 0.16, (1.0, 0.94, 0.86)),
        ((-0.08, 0.10, 0.07), 38, 0.12, (0.55, 0.72, 1.0)),
        ((-0.08, -0.03, -0.02), 20, 0.10, (1.0, 0.48, 0.20)),
    ):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.data.energy = energy
        light.data.shape = "DISK"
        light.data.size = size
        light.data.color = color
    rig.animation_data.action = action
    scene.frame_set(10)
    bpy.ops.render.render(write_still=True)
    rig.animation_data.action = None
    identity_pose(rig)
    scene.frame_set(1)


def inject_asset_metadata(path: Path, metadata: dict) -> None:
    data = path.read_bytes()
    magic, version, _ = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF" or version != 2:
        raise RuntimeError("Exporter did not create a glTF 2.0 GLB")
    offset = 12
    chunks = []
    while offset < len(data):
        length, chunk_type = struct.unpack_from("<II", data, offset)
        payload = data[offset + 8:offset + 8 + length]
        chunks.append((chunk_type, payload))
        offset += 8 + length
    document = json.loads(chunks[0][1].rstrip(b" \0"))
    document.setdefault("asset", {})["extras"] = {"pocketAquarium": metadata}
    encoded = json.dumps(document, separators=(",", ":"), sort_keys=True).encode("utf-8")
    encoded += b" " * ((4 - len(encoded) % 4) % 4)
    chunks[0] = (0x4E4F534A, encoded)
    total = 12 + sum(8 + len(payload) for _, payload in chunks)
    output = bytearray(struct.pack("<4sII", b"glTF", 2, total))
    for chunk_type, payload in chunks:
        output.extend(struct.pack("<II", len(payload), chunk_type))
        output.extend(payload)
    path.write_bytes(output)


def glb_document(path: Path):
    data = path.read_bytes()
    json_length, _ = struct.unpack_from("<II", data, 12)
    return json.loads(data[20:20 + json_length].rstrip(b" \0"))


def runtime_triangle_count(document) -> int:
    return sum(
        document["accessors"][primitive["indices"]]["count"] // 3
        for mesh in document.get("meshes", [])
        for primitive in mesh.get("primitives", [])
        if "indices" in primitive
    )


def metadata():
    return {
        "schemaVersion": 2,
        "speciesId": SPECIES,
        "scientificName": SCIENTIFIC_NAME,
        "biome": "reef",
        "waterType": "salt",
        "assetVersion": VERSION,
        "referenceAdultLengthMeters": ADULT_LENGTH_METERS,
        "origin": "anatomical_midbody",
        "forwardAxis": "+X",
        "upAxis": "+Y",
        "lod": 1,
        "sourceManifest": SOURCE_MANIFEST_NAME,
    }


def author_source():
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    GLB_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_PATH.parent.mkdir(parents=True, exist_ok=True)
    clear_scene()
    materials = create_materials()
    root = bpy.data.objects.new("PA_ocellaris_Root", None)
    bpy.context.collection.objects.link(root)
    root["speciesId"] = SPECIES
    root["referenceAdultLengthMeters"] = ADULT_LENGTH_METERS
    root["sourceForwardAxis"] = "+X"
    root["sourceUpAxis"] = "+Z"
    rig = create_rig()
    rig.parent = root
    body = create_body(rig, materials)
    fins = create_fins(rig, materials["fin"])
    create_eyes_and_cues(rig, materials)
    actions = create_animations(rig)
    bpy.context.scene.render.fps = 30
    configure_preview(rig, next(action for action in actions if action.name == "swim"))
    root.location = (0, 0, 0)
    root.rotation_euler = (0, 0, 0)
    root.scale = (1, 1, 1)
    rig.animation_data.action = None
    identity_pose(rig)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH), check_existing=False)
    print(json.dumps({
        "stage": "author",
        "blend": str(BLEND_PATH),
        "bodyVertices": len(body.data.vertices),
        "finVertices": len(fins.data.vertices),
        "actions": sorted(action.name for action in actions),
    }, indent=2))


def export_runtime():
    rig = bpy.data.objects.get("PA_ocellaris_Rig")
    body = bpy.data.objects.get("PA_ocellaris_Body")
    fins = bpy.data.objects.get("PA_ocellaris_Fins")
    if not rig or not body or not fins:
        raise RuntimeError("Saved source is missing the stable rig/body/fin objects")
    retained = sorted(action.name for action in bpy.data.actions if action.name in {"idle", "swim", "burst"})
    if retained != ["burst", "idle", "swim"]:
        raise RuntimeError(f"Saved source did not retain all actions: {retained}")
    rig.animation_data.action = None
    identity_pose(rig)
    bpy.context.scene.frame_set(1)
    bpy.ops.export_scene.gltf(
        filepath=str(GLB_PATH), export_format="GLB", export_yup=True,
        export_animations=True, export_animation_mode="ACTIONS", export_force_sampling=True,
        export_bake_animation=True, export_frame_step=1, export_skins=True,
        export_all_influences=False, export_influence_nb=4, export_texcoords=True,
        export_normals=True, export_tangents=True, export_materials="EXPORT",
        export_extras=True, export_cameras=False, export_lights=False, export_apply=False,
        export_current_frame=False,
    )
    asset_metadata = metadata()
    inject_asset_metadata(GLB_PATH, asset_metadata)
    document = glb_document(GLB_PATH)
    textures = sorted(TEXTURE_DIR.glob("*.png"))
    source_validation = json.loads(SOURCE_VALIDATION_PATH.read_text()) if SOURCE_VALIDATION_PATH.exists() else None
    manifest = {
        **asset_metadata,
        "author": "Pocket Aquarium project",
        "contributors": ["Codex FISH3D-P1 asset lane", "Codex ocellaris repair lane"],
        "rightsStatus": "PROJECT_OWNED",
        "licenseExpression": "NOASSERTION",
        "sourceReferences": [
            {"path": "../../../../assets/animals/ocellaris-clownfish-v2.png", "usage": "internal visual reference only; no pixels sampled or copied", "sha256": "27b7f593e45c9f3fe3704d0e0ddcd118aaa0f6e1945f578d38f6d82fd30f223a", "rightsStatus": "UNRESOLVED_REFERENCE_ONLY"},
            {"url": "https://www.nausicaa.fr/en/my-visit/animals/clown-anemonefish", "usage": "anatomy reference only"},
            {"url": "https://zoo.hr/riba-klaun-amphiprion-ocellaris/", "usage": "marking reference only"},
            {"url": "https://unsplash.com/photos/a-fish-swimming-in-water-mJwTvRloq-c", "usage": "swimming reference only"},
        ],
        "generatedReferences": [],
        "toolchain": {"blender": "5.2.1 LTS", "exporter": "Blender native glTF 2.0 exporter"},
        "sourceBlendSha256": sha256(BLEND_PATH),
        "exportScriptSha256": sha256(EXPORT_SCRIPT_PATH),
        "validatorScriptSha256": sha256(VALIDATOR_SCRIPT_PATH),
        "runtimeGlbSha256": {"lod1": sha256(GLB_PATH)},
        "coordinateContract": {"unitMeters": 1, "source": {"forwardAxis": "+X", "upAxis": "+Z"}, "runtime": {"forwardAxis": "+X", "upAxis": "+Y"}, "origin": "anatomical_midbody"},
        "proceduralTextures": [{"path": str(path.relative_to(SOURCE_DIR)), "sha256": sha256(path)} for path in textures],
        "statistics": {
            "triangles": runtime_triangle_count(document),
            "sourceTriangles": sum(len(poly.vertices) - 2 for poly in body.data.polygons) + len(fins.data.polygons),
            "materials": len(document.get("materials", [])), "bones": len(rig.data.bones),
            "nodes": len(document.get("nodes", [])), "clips": sorted(animation.get("name") for animation in document.get("animations", [])),
            "bodyVertices": len(body.data.vertices), "finVertices": len(fins.data.vertices),
            "runtimeBytes": GLB_PATH.stat().st_size,
        },
        "validator": {"status": "source_passed_runtime_pending", "sourceReport": str(SOURCE_VALIDATION_PATH.relative_to(ROOT)) if source_validation else None, "runtimeReport": str(RUNTIME_VALIDATION_PATH.relative_to(ROOT))},
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"stage": "export", "glb": str(GLB_PATH), "manifest": str(MANIFEST_PATH), "statistics": manifest["statistics"]}, indent=2))


def parse_mode():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("author", "export"), default="author")
    return parser.parse_args(args)


def main():
    args = parse_mode()
    author_source() if args.mode == "author" else export_runtime()


if __name__ == "__main__":
    main()
