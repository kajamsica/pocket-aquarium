"""Author and export the first Pocket Aquarium ocellaris specimen.

Run only with the pinned Blender binary recorded in art/toolchain.json.
The model is built from anatomical cross-sections and project-owned materials.
No pixels or geometry are copied from the repository reference PNG.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
from pathlib import Path

import bpy
from mathutils import Vector


SPECIES = "ocellaris"
SCIENTIFIC_NAME = "Amphiprion ocellaris"
VERSION = "1.0.0"
ADULT_LENGTH_METERS = 0.08
ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "art" / "specimens" / SPECIES
GLB_DIR = ROOT / "src" / "assets" / "specimens" / SPECIES / "v1"
BLEND_PATH = SOURCE_DIR / "ocellaris.blend"
GLB_PATH = GLB_DIR / "lod1.glb"
MANIFEST_PATH = SOURCE_DIR / "ocellaris.asset.json"
PREVIEW_PATH = SOURCE_DIR / "renders" / "lod1-author-preview.png"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.armatures, bpy.data.materials, bpy.data.actions):
        for datablock in list(datablocks):
            datablocks.remove(datablock)


def material(name: str, color: tuple[float, float, float, float], roughness: float, coat: float = 0.0):
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    result.diffuse_color = color
    shader = result.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Metallic"].default_value = 0.0
    shader.inputs["Roughness"].default_value = roughness
    if "Coat Weight" in shader.inputs:
        shader.inputs["Coat Weight"].default_value = coat
        shader.inputs["Coat Roughness"].default_value = 0.22
    return result


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
        return result

    bone("Root", (0, 0, 0), (0.004, 0, 0), deform=False)
    bone("Body", (0.037, 0, 0), (0.018, 0, 0), "Root")
    bone("Spine_A", (0.018, 0, 0), (0.005, 0, 0), "Body", True)
    bone("Spine_B", (0.005, 0, 0), (-0.009, 0, 0), "Spine_A", True)
    bone("Peduncle", (-0.009, 0, 0), (-0.024, 0, 0), "Spine_B", True)
    bone("Caudal", (-0.024, 0, 0), (-0.039, 0, 0), "Peduncle", True)
    bone("Pectoral_L", (0.017, -0.005, -0.001), (-0.002, -0.016, -0.011), "Body")
    bone("Pectoral_R", (0.017, 0.005, -0.001), (-0.002, 0.016, -0.011), "Body")
    bone("Dorsal", (0.006, 0, 0.011), (-0.008, 0, 0.024), "Spine_A")
    bone("Pelvic_L", (0.008, -0.003, -0.010), (-0.004, -0.006, -0.022), "Spine_A")
    bone("Pelvic_R", (0.008, 0.003, -0.010), (-0.004, 0.006, -0.022), "Spine_A")
    bone("Jaw", (0.032, 0, -0.002), (0.039, 0, -0.004), "Body")
    bone("Gill", (0.021, 0, 0.001), (0.014, 0, -0.006), "Body")
    bpy.ops.object.mode_set(mode="OBJECT")
    rig["speciesId"] = SPECIES
    rig["presentationOnly"] = True
    return rig


BODY_CONTROLS = (
    (-0.0260, 0.0018, 0.0025),
    (-0.0230, 0.0040, 0.0062),
    (-0.0180, 0.0062, 0.0106),
    (-0.0110, 0.0076, 0.0142),
    (-0.0030, 0.0083, 0.0160),
    (0.0060, 0.0085, 0.0164),
    (0.0140, 0.0081, 0.0155),
    (0.0210, 0.0075, 0.0138),
    (0.0280, 0.0066, 0.0112),
    (0.0340, 0.0050, 0.0078),
    (0.0380, 0.0028, 0.0046),
    (0.0400, 0.0005, 0.0011),
)


def dense_stations():
    xs = sorted(set([point[0] for point in BODY_CONTROLS] + [-0.024 + index * 0.002 for index in range(32)]))
    result = []
    for x in xs:
        if x < BODY_CONTROLS[0][0] or x > BODY_CONTROLS[-1][0]:
            continue
        for left, right in zip(BODY_CONTROLS, BODY_CONTROLS[1:]):
            if left[0] <= x <= right[0]:
                t = (x - left[0]) / (right[0] - left[0])
                result.append((x, left[1] + (right[1] - left[1]) * t, left[2] + (right[2] - left[2]) * t))
                break
    return tuple(result)


STATIONS = dense_stations()


def body_material_index(x: float, angle: float) -> int:
    band_centers = (0.0225 + 0.0010 * math.cos(angle), 0.0005 + 0.0024 * math.cos(angle), -0.0190)
    half_widths = (0.0031, 0.0037, 0.0025)
    for center, half in zip(band_centers, half_widths):
        distance = abs(x - center)
        if distance <= half:
            return 1
        if distance <= half + 0.00135:
            return 2
    return 0


def create_body(rig, materials):
    segments = 28
    vertices: list[tuple[float, float, float]] = []
    uvs: list[tuple[float, float]] = []
    faces: list[tuple[int, int, int, int]] = []
    material_indices: list[int] = []
    tail_x, head_x = STATIONS[0][0], STATIONS[-1][0]
    for x, lateral, vertical in STATIONS:
        for segment in range(segments + 1):
            angle = segment / segments * math.tau
            vertices.append((x, math.sin(angle) * lateral, math.cos(angle) * vertical))
            uvs.append(((x - tail_x) / (head_x - tail_x), segment / segments))
    for ring in range(len(STATIONS) - 1):
        x = (STATIONS[ring][0] + STATIONS[ring + 1][0]) * 0.5
        for segment in range(segments):
            a = ring * (segments + 1) + segment
            b = a + 1
            c = a + segments + 1
            d = c + 1
            faces.append((a, c, d, b))
            material_indices.append(body_material_index(x, (segment + 0.5) / segments * math.tau))
    mesh = bpy.data.meshes.new("PA_ocellaris_Body")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.clear()
    for item in materials:
        mesh.materials.append(item)
    for polygon, index in zip(mesh.polygons, material_indices):
        polygon.material_index = index
        polygon.use_smooth = True
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            uv_layer.data[loop_index].uv = uvs[mesh.loops[loop_index].vertex_index]
    mesh.update()
    body = bpy.data.objects.new("PA_ocellaris_Body", mesh)
    bpy.context.collection.objects.link(body)
    subdivision = body.modifiers.new(name="LOD1 surface refinement", type="SUBSURF")
    subdivision.subdivision_type = "CATMULL_CLARK"
    subdivision.levels = 1
    subdivision.render_levels = 1
    skin_object(body, rig, body_weights(vertices))
    return body


def body_weights(vertices):
    centers = (("Body", 0.029), ("Spine_A", 0.012), ("Spine_B", -0.002), ("Peduncle", -0.016), ("Caudal", -0.027))
    result = []
    for x, _, _ in vertices:
        distances = sorted(((abs(x - center), name) for name, center in centers))[:2]
        if distances[0][0] < 1e-6:
            result.append({distances[0][1]: 1.0})
        else:
            inverse = [1 / max(item[0], 0.001) for item in distances]
            total = sum(inverse)
            result.append({distances[i][1]: inverse[i] / total for i in range(2)})
    return result


def append_prism(vertices, faces, assignments, points, half_thickness, bone_name):
    start = len(vertices)
    for side in (-1, 1):
        for x, y, z in points:
            vertices.append((x, y + side * half_thickness, z))
            assignments.append({bone_name: 1.0})
    count = len(points)
    faces.append(tuple(start + i for i in range(count)))
    faces.append(tuple(start + count + i for i in reversed(range(count))))
    for i in range(count):
        nxt = (i + 1) % count
        faces.append((start + i, start + nxt, start + count + nxt, start + count + i))


def create_fins(rig, fin_material, black_material):
    vertices, faces, assignments = [], [], []
    append_prism(vertices, faces, assignments,
                 [(-0.023, 0, 0.004), (-0.034, 0, 0.014), (-0.040, 0, 0.012), (-0.038, 0, 0), (-0.040, 0, -0.012), (-0.034, 0, -0.014), (-0.023, 0, -0.004)],
                 0.0010, "Caudal")
    append_prism(vertices, faces, assignments,
                 [(-0.017, 0, 0.013), (-0.011, 0, 0.020), (0.002, 0, 0.023), (0.013, 0, 0.021), (0.022, 0, 0.016), (0.024, 0, 0.011)],
                 0.00065, "Dorsal")
    append_prism(vertices, faces, assignments,
                 [(-0.015, 0, -0.012), (-0.008, 0, -0.022), (0.012, 0, -0.020), (0.018, 0, -0.012)],
                 0.0006, "Spine_A")
    for side, pectoral, pelvic in ((-1, "Pectoral_L", "Pelvic_L"), (1, "Pectoral_R", "Pelvic_R")):
        append_prism(vertices, faces, assignments,
                     [(0.018, side * 0.006, 0.000), (0.004, side * 0.020, -0.008), (-0.005, side * 0.017, -0.014), (0.011, side * 0.007, -0.006)],
                     0.00045, pectoral)
        append_prism(vertices, faces, assignments,
                     [(0.009, side * 0.002, -0.011), (0.000, side * 0.007, -0.022), (-0.006, side * 0.005, -0.017)],
                     0.00035, pelvic)
    mesh = bpy.data.meshes.new("PA_ocellaris_Fins")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(fin_material)
    mesh.materials.append(black_material)
    for polygon in mesh.polygons:
        polygon.material_index = 0
        polygon.use_smooth = True
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            x, y, z = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            uv_layer.data[loop_index].uv = ((x + 0.04) / 0.08, (z + 0.03) / 0.06)
    mesh.update()
    fins = bpy.data.objects.new("PA_ocellaris_Fins", mesh)
    bpy.context.collection.objects.link(fins)
    triangulate = fins.modifiers.new(name="Triangulated fin membranes", type="TRIANGULATE")
    triangulate.keep_custom_normals = True
    bpy.context.view_layer.objects.active = fins
    fins.select_set(True)
    bpy.ops.object.modifier_apply(modifier=triangulate.name)
    fins.select_set(False)
    skin_object(fins, rig, assignments)
    return fins


def skin_object(obj, rig, weights):
    names = sorted({name for item in weights for name in item})
    groups = {name: obj.vertex_groups.new(name=name) for name in names}
    for index, item in enumerate(weights):
        for name, weight in item.items():
            groups[name].add([index], weight, "REPLACE")
    modifier = obj.modifiers.new(name="PA_ocellaris_Armature", type="ARMATURE")
    modifier.object = rig
    obj.parent = rig


def create_eyes_and_cues(rig, eye_material, cue_material):
    eyes = []
    for side in (-1, 1):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, location=(0.0295, side * 0.0062, 0.0068))
        eye = bpy.context.object
        eye.name = f"PA_ocellaris_Eye_{'L' if side < 0 else 'R'}"
        eye.scale = (0.00225, 0.00110, 0.00225)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        eye.data.materials.append(eye_material)
        for polygon in eye.data.polygons:
            polygon.use_smooth = True
        eyes.append(eye)
    bpy.ops.object.select_all(action="DESELECT")
    for eye in eyes:
        eye.select_set(True)
    bpy.context.view_layer.objects.active = eyes[0]
    bpy.ops.object.join()
    joined_eyes = bpy.context.object
    joined_eyes.name = "PA_ocellaris_Eyes"
    skin_object(joined_eyes, rig, [{"Body": 1.0} for _ in joined_eyes.data.vertices])
    joined_eyes.select_set(False)

    def cue(name, points, radius, bone_name):
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
        curve.materials.append(cue_material)
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.convert(target="MESH")
        skin_object(obj, rig, [{bone_name: 1.0} for _ in obj.data.vertices])
        obj.select_set(False)

    for side in (-1, 1):
        cue(f"PA_ocellaris_Gill_{side}", [(0.021, side * 0.0074, 0.006), (0.018, side * 0.0078, 0), (0.020, side * 0.0073, -0.006)], 0.00028, "Gill")
    cue("PA_ocellaris_Mouth", [(0.0392, -0.0008, -0.0027), (0.0401, 0, -0.0031), (0.0392, 0.0008, -0.0027)], 0.00022, "Jaw")
    return joined_eyes


def add_animation(rig, name: str, duration: int, amplitude: float, cycles: float, burst: bool = False):
    scene = bpy.context.scene
    action = bpy.data.actions.new(name=name)
    rig.animation_data_create()
    rig.animation_data.action = action
    bones = (("Spine_A", 0.26), ("Spine_B", 0.50), ("Peduncle", 0.76), ("Caudal", 1.0))
    sample_frames = sorted(set([1, duration] + [round(1 + i * (duration - 1) / 8) for i in range(9)]))
    for frame in sample_frames:
        phase = (frame - 1) / max(duration - 1, 1) * math.tau * cycles
        envelope = math.sin(math.pi * (frame - 1) / max(duration - 1, 1)) if burst else 1.0
        for bone_name, strength in bones:
            pose = rig.pose.bones[bone_name]
            pose.rotation_mode = "XYZ"
            pose.rotation_euler[2] = math.sin(phase - strength * 1.35) * amplitude * strength * envelope
            pose.keyframe_insert(data_path="rotation_euler", index=2, frame=frame, group=bone_name)
        for bone_name, side in (("Pectoral_L", -1), ("Pectoral_R", 1)):
            pose = rig.pose.bones[bone_name]
            pose.rotation_mode = "XYZ"
            pose.rotation_euler[0] = side * (0.20 + math.sin(phase * 2 + side) * amplitude * 0.55) * envelope
            pose.keyframe_insert(data_path="rotation_euler", index=0, frame=frame, group=bone_name)
        dorsal = rig.pose.bones["Dorsal"]
        dorsal.rotation_mode = "XYZ"
        dorsal.rotation_euler[0] = math.sin(phase - 0.8) * amplitude * 0.22 * envelope
        dorsal.keyframe_insert(data_path="rotation_euler", index=0, frame=frame, group="Dorsal")
        gill = rig.pose.bones["Gill"]
        gill.rotation_mode = "XYZ"
        gill.rotation_euler[1] = math.sin(phase * 2) * 0.035
        gill.keyframe_insert(data_path="rotation_euler", index=1, frame=frame, group="Gill")
    action.frame_start = 1
    action.frame_end = duration
    action["loop"] = not burst
    scene.frame_end = max(scene.frame_end, duration)
    rig.animation_data.action = None
    return action


def configure_preview(root):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 960
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(PREVIEW_PATH)
    scene.world.color = (0.008, 0.018, 0.028)
    scene.view_settings.exposure = -1.35
    bpy.ops.object.camera_add(location=(0.12, -0.145, 0.075))
    camera = bpy.context.object
    camera.name = "AuthorPreviewCamera"
    scene.camera = camera
    direction = Vector((0, 0, 0)) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    camera.data.lens = 58
    bpy.ops.object.light_add(type="AREA", location=(0.02, -0.08, 0.12))
    bpy.context.object.data.energy = 75
    bpy.context.object.data.shape = "DISK"
    bpy.context.object.data.size = 0.18
    bpy.ops.object.light_add(type="AREA", location=(-0.05, 0.10, 0.04))
    bpy.context.object.data.energy = 42
    bpy.context.object.data.color = (0.2, 0.55, 1.0)
    bpy.context.object.data.size = 0.14
    root.rotation_euler[2] = math.radians(-7)


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
    json_type = 0x4E4F534A
    document = json.loads(chunks[0][1].rstrip(b" \0"))
    document.setdefault("asset", {})["extras"] = {"pocketAquarium": metadata}
    encoded = json.dumps(document, separators=(",", ":"), sort_keys=True).encode("utf-8")
    encoded += b" " * ((4 - len(encoded) % 4) % 4)
    chunks[0] = (json_type, encoded)
    total = 12 + sum(8 + len(payload) for _, payload in chunks)
    output = bytearray(struct.pack("<4sII", b"glTF", 2, total))
    for chunk_type, payload in chunks:
        output.extend(struct.pack("<II", len(payload), chunk_type))
        output.extend(payload)
    path.write_bytes(output)


def runtime_triangle_count(path: Path) -> int:
    data = path.read_bytes()
    json_length, _ = struct.unpack_from("<II", data, 12)
    document = json.loads(data[20:20 + json_length].rstrip(b" \0"))
    return sum(
        document["accessors"][primitive["indices"]]["count"] // 3
        for mesh in document.get("meshes", [])
        for primitive in mesh.get("primitives", [])
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--", dest="separator", action="store_true")
    parser.parse_known_args()
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    GLB_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_PATH.parent.mkdir(parents=True, exist_ok=True)
    clear_scene()

    skin = material("PA_ocellaris_Skin", (0.94, 0.205, 0.025, 1), 0.34, 0.22)
    white = material("PA_ocellaris_White", (0.93, 0.90, 0.77, 1), 0.42, 0.18)
    black = material("PA_ocellaris_Black", (0.012, 0.009, 0.008, 1), 0.39, 0.20)
    fin = material("PA_ocellaris_Fin", (0.74, 0.105, 0.014, 1), 0.43, 0.12)
    eye = material("PA_Eye", (0.004, 0.004, 0.003, 1), 0.14, 0.72)
    cue = material("PA_ocellaris_Cue", (0.016, 0.009, 0.006, 1), 0.52)

    root = bpy.data.objects.new("PA_ocellaris_Root", None)
    bpy.context.collection.objects.link(root)
    root["speciesId"] = SPECIES
    root["referenceAdultLengthMeters"] = ADULT_LENGTH_METERS
    rig = create_rig()
    rig.parent = root
    body = create_body(rig, (skin, white, black))
    fins = create_fins(rig, fin, black)
    create_eyes_and_cues(rig, eye, cue)
    for obj in (body, fins):
        obj["adultLengthMeters"] = ADULT_LENGTH_METERS
        obj["lod"] = 1

    clips = (
        add_animation(rig, "idle", 72, 0.085, 1),
        add_animation(rig, "swim", 36, 0.26, 1),
        add_animation(rig, "burst", 22, 0.46, 1.35, True),
    )
    bpy.context.scene.render.fps = 30
    configure_preview(root)
    bpy.context.scene.frame_set(10)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH), check_existing=False)
    bpy.ops.render.render(write_still=True)

    root.rotation_euler = (0, 0, 0)
    bpy.context.scene.frame_set(1)
    bpy.ops.export_scene.gltf(
        filepath=str(GLB_PATH), export_format="GLB", export_yup=True,
        export_animations=True, export_animation_mode="ACTIONS", export_force_sampling=False,
        export_bake_animation=False,
        export_skins=True, export_all_influences=False, export_influence_nb=4,
        export_texcoords=True, export_normals=True, export_tangents=True,
        export_materials="EXPORT", export_extras=True, export_cameras=False, export_lights=False,
        export_apply=False, export_current_frame=False,
    )
    metadata = {
        "schemaVersion": 1, "speciesId": SPECIES, "scientificName": SCIENTIFIC_NAME,
        "biome": "reef", "waterType": "salt", "assetVersion": VERSION,
        "referenceAdultLengthMeters": ADULT_LENGTH_METERS, "origin": "center_of_mass",
        "forwardAxis": "+X", "upAxis": "+Y", "lod": 1,
        "sourceManifest": "ocellaris.asset.json",
    }
    inject_asset_metadata(GLB_PATH, metadata)
    source_triangles = sum(len(p.vertices) - 2 for p in body.data.polygons) + sum(len(p.vertices) - 2 for p in fins.data.polygons)
    manifest = {
        **metadata,
        "author": "Pocket Aquarium project",
        "contributors": ["Codex FISH3D-P1 asset lane"],
        "rightsStatus": "PROJECT_OWNED",
        "licenseExpression": "NOASSERTION",
        "sourceReferences": [{
            "path": "../../../../assets/animals/ocellaris-clownfish-v2.png",
            "usage": "internal visual reference only; no pixels sampled or copied",
            "sha256": "27b7f593e45c9f3fe3704d0e0ddcd118aaa0f6e1945f578d38f6d82fd30f223a",
            "rightsStatus": "UNRESOLVED_REFERENCE_ONLY",
        }],
        "generatedReferences": [],
        "toolchain": {"blender": "5.2.1 LTS", "exporter": "Blender native glTF 2.0 exporter"},
        "sourceBlendSha256": sha256(BLEND_PATH),
        "exportScriptSha256": sha256(Path(__file__).resolve()),
        "runtimeGlbSha256": {"lod1": sha256(GLB_PATH)},
        "coordinateContract": {"unitMeters": 1, "forwardAxis": "+X", "upAxis": "+Y", "origin": "center_of_mass"},
        "statistics": {
            "triangles": runtime_triangle_count(GLB_PATH), "sourceTriangles": source_triangles, "materials": 6,
            "bones": len(rig.data.bones), "clips": [action.name for action in clips],
            "bodyVertices": len(body.data.vertices), "finVertices": len(fins.data.vertices),
            "runtimeBytes": GLB_PATH.stat().st_size,
        },
        "validator": {"status": "deferred_to_FISH3D-03A", "report": None},
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"blend": str(BLEND_PATH), "glb": str(GLB_PATH), "manifest": str(MANIFEST_PATH), "stats": manifest["statistics"]}, indent=2))


if __name__ == "__main__":
    main()
