"""Fresh-process geometry, animation, and GLB parity gate for ocellaris LOD1."""

from __future__ import annotations

import argparse
import itertools
import json
import math
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector
from mathutils.bvhtree import BVHTree


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "art" / "specimens" / "ocellaris"
BLEND_PATH = SOURCE_DIR / "ocellaris.blend"
GLB_PATH = ROOT / "src" / "assets" / "specimens" / "ocellaris" / "v1" / "lod1.glb"
MANIFEST_PATH = SOURCE_DIR / "ocellaris.asset.json"
SOURCE_REPORT_PATH = SOURCE_DIR / "validation-source.json"
RUNTIME_REPORT_PATH = SOURCE_DIR / "validation-runtime.json"
CLIPS = ("idle", "swim", "burst")
AXIAL_BONES = ("Body", "Spine_A", "Spine_B", "Peduncle", "Caudal")
BODY_ZONES = ("zone_head", "zone_anterior", "zone_midbody", "zone_peduncle", "zone_caudal")
FIN_NAMES = ("caudal", "dorsal", "anal", "pectoral_L", "pectoral_R", "pelvic_L", "pelvic_R")
PHASES = (0.0, 0.25, 0.5, 0.75)
LANDMARKS = {
    "nose": ("Body", (0.0415, 0, -0.0019)),
    "eye_L": ("Body", (0.0305, -0.0079, 0.0062)),
    "eye_R": ("Body", (0.0305, 0.0079, 0.0062)),
    "mouth": ("Jaw", (0.0423, 0, -0.0032)),
    "operculum": ("Gill", (0.0205, 0, 0.001)),
    "dorsal_apex": ("Dorsal", (0.0045, 0, 0.0290)),
    "pectoral_root_L": ("Body", (0.019, -0.0085, 0.002)),
    "pectoral_root_R": ("Body", (0.019, 0.0085, 0.002)),
    "caudal_tip_top": ("Caudal", (-0.0368, 0, 0.0138)),
    "caudal_tip_bottom": ("Caudal", (-0.0368, 0, -0.0138)),
}


class GateFailure(RuntimeError):
    pass


def parse_args():
    raw = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", choices=("source", "runtime"), required=True)
    return parser.parse_args(raw)


def angle_degrees(first: Quaternion, second: Quaternion) -> float:
    return math.degrees(first.rotation_difference(second).angle)


def action_for(name: str):
    exact = bpy.data.actions.get(name)
    if exact:
        return exact
    matches = [action for action in bpy.data.actions if action.name.split(".")[0] == name]
    if len(matches) != 1:
        raise GateFailure(f"Expected one action named {name}, found {[action.name for action in matches]}")
    return matches[0]


def set_action(rig, action):
    rig.animation_data_create()
    rig.animation_data.action = action


def group_indices(obj, name: str) -> set[int]:
    group = obj.vertex_groups.get(name)
    if not group:
        raise GateFailure(f"{obj.name} is missing required vertex group {name}")
    return {
        vertex.index
        for vertex in obj.data.vertices
        if any(item.group == group.index and item.weight > 0.5 for item in vertex.groups)
    }


def evaluated_geometry(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)
    if len(mesh.vertices) != len(obj.data.vertices):
        evaluated.to_mesh_clear()
        raise GateFailure(f"Topology-changing modifier found on {obj.name}")
    mesh.calc_loop_triangles()
    matrix = evaluated.matrix_world
    vertices = [matrix @ vertex.co for vertex in mesh.vertices]
    triangles = [tuple(triangle.vertices) for triangle in mesh.loop_triangles]
    evaluated.to_mesh_clear()
    return vertices, triangles


def triangles_in_group(triangles, members: set[int], exclude: set[int] | None = None):
    excluded = exclude or set()
    return [triangle for triangle in triangles if all(index in members for index in triangle) and not any(index in excluded for index in triangle)]


def make_bvh(vertices, triangles, label: str):
    if not triangles:
        raise GateFailure(f"No triangles available for BVH zone {label}")
    return BVHTree.FromPolygons(vertices, triangles, all_triangles=True, epsilon=1e-8)


def signed_volume(vertices, triangles) -> float:
    return sum(vertices[a].dot(vertices[b].cross(vertices[c])) for a, b, c in triangles) / 6.0


def triangle_normal(vertices, triangle):
    a, b, c = (vertices[index] for index in triangle)
    normal = (b - a).cross(c - a)
    return normal.normalized() if normal.length > 1e-12 else Vector((0, 0, 0))


def deform_landmark(rig, bone_name: str, coordinate) -> tuple[float, float, float]:
    rest = rig.data.bones[bone_name]
    pose = rig.pose.bones[bone_name]
    deform = pose.matrix @ rest.matrix_local.inverted()
    point = rig.matrix_world @ deform @ Vector(coordinate)
    return tuple(point)


def sample_pose(rig):
    bones = {}
    for name in AXIAL_BONES + tuple(sorted({bone for bone, _point in LANDMARKS.values()})):
        if name not in bones:
            quaternion = rig.pose.bones[name].matrix_basis.to_quaternion().normalized()
            bones[name] = tuple(quaternion)
    landmarks = {name: deform_landmark(rig, bone, coordinate) for name, (bone, coordinate) in LANDMARKS.items()}
    return {"bones": bones, "landmarks": landmarks}


def validate_axial_chain(rig, clip_name: str):
    rest = [(rig.data.bones[name].tail_local - rig.data.bones[name].head_local).normalized() for name in AXIAL_BONES]
    posed = [(rig.pose.bones[name].tail - rig.pose.bones[name].head).normalized() for name in AXIAL_BONES]
    for name, rest_direction, posed_direction in zip(AXIAL_BONES, rest, posed):
        if rest_direction.dot(posed_direction) <= 0:
            raise GateFailure(f"{clip_name}: axial reversal at {name}")
    angles = [math.degrees(posed[index].angle(posed[index + 1])) for index in range(len(posed) - 1)]
    limit = 35.0 if clip_name == "burst" else 20.0
    if max(angles) > limit + 1e-4:
        raise GateFailure(f"{clip_name}: joint bend {max(angles):.3f} exceeds {limit:.1f} degrees")
    cumulative = sum(angles)
    if cumulative >= 70.0:
        raise GateFailure(f"{clip_name}: cumulative curvature {cumulative:.3f} exceeds 70 degrees")
    return max(angles), cumulative


def validate_geometry_sample(body, fins, rest_body_normals, rest_volume, clip_name: str):
    body_vertices, body_triangles = evaluated_geometry(body)
    fin_vertices, fin_triangles = evaluated_geometry(fins)
    body_groups = {name: group_indices(body, name) for name in BODY_ZONES}
    body_attach = {name: group_indices(body, f"attach_{name}") for name in FIN_NAMES}
    fin_groups = {name: group_indices(fins, f"fin_{name}") for name in FIN_NAMES}
    fin_attach = {name: group_indices(fins, f"attach_{name}") for name in FIN_NAMES}

    zone_triangles = {name: triangles_in_group(body_triangles, members) for name, members in body_groups.items()}
    non_adjacent = (
        ("zone_head", "zone_midbody"), ("zone_head", "zone_peduncle"), ("zone_head", "zone_caudal"),
        ("zone_anterior", "zone_peduncle"), ("zone_anterior", "zone_caudal"), ("zone_midbody", "zone_caudal"),
    )
    zone_bvhs = {name: make_bvh(body_vertices, triangles, name) for name, triangles in zone_triangles.items()}
    for first, second in non_adjacent:
        if zone_bvhs[first].overlap(zone_bvhs[second]):
            raise GateFailure(f"{clip_name}: non-adjacent body intersection {first}/{second}")

    head_bvh = zone_bvhs["zone_head"]
    tail_members = body_groups["zone_caudal"] | fin_groups["caudal"]
    tail_points = [*(body_vertices[index] for index in body_groups["zone_caudal"]), *(fin_vertices[index] for index in fin_groups["caudal"])]
    clearance = min((head_bvh.find_nearest(point)[3] for point in tail_points), default=1.0)
    if clearance < 0.001:
        raise GateFailure(f"{clip_name}: caudal/head clearance {clearance:.6f} m is below 0.001 m")

    body_all = set(range(len(body.data.vertices)))
    fin_nonattach_triangles = {}
    for name in FIN_NAMES:
        exposed_fin = triangles_in_group(fin_triangles, fin_groups[name], fin_attach[name])
        fin_nonattach_triangles[name] = exposed_fin
        exposed_body = triangles_in_group(body_triangles, body_all, body_attach[name])
        if make_bvh(fin_vertices, exposed_fin, f"fin_{name}").overlap(make_bvh(body_vertices, exposed_body, f"body_without_attach_{name}")):
            raise GateFailure(f"{clip_name}: fin/body penetration outside attach_{name}")

    for first, second in itertools.combinations(FIN_NAMES, 2):
        first_bvh = make_bvh(fin_vertices, fin_nonattach_triangles[first], f"fin_{first}")
        second_bvh = make_bvh(fin_vertices, fin_nonattach_triangles[second], f"fin_{second}")
        if first_bvh.overlap(second_bvh):
            raise GateFailure(f"{clip_name}: non-adjacent fin intersection {first}/{second}")

    for name in ("pectoral_L", "pelvic_L"):
        if any(fin_vertices[index].y >= -1e-5 for index in fin_groups[name] - fin_attach[name]):
            raise GateFailure(f"{clip_name}: {name} crossed the center plane")
    for name in ("pectoral_R", "pelvic_R"):
        if any(fin_vertices[index].y <= 1e-5 for index in fin_groups[name] - fin_attach[name]):
            raise GateFailure(f"{clip_name}: {name} crossed the center plane")

    normals = [triangle_normal(body_vertices, triangle) for triangle in body_triangles]
    if len(normals) != len(rest_body_normals):
        raise GateFailure("Body triangle order changed during evaluation")
    minimum_normal_dot = min(current.dot(rest) for current, rest in zip(normals, rest_body_normals))
    if minimum_normal_dot <= 0:
        raise GateFailure(f"{clip_name}: evaluated body triangle inverted, normal dot {minimum_normal_dot:.6f}")
    volume = signed_volume(body_vertices, body_triangles)
    if volume * rest_volume <= 0 or abs(volume) < abs(rest_volume) * 0.70:
        raise GateFailure(f"{clip_name}: signed body volume inverted or collapsed")
    return clearance, minimum_normal_dot, volume


def phase_frame(action, phase: float):
    start, end = action.frame_range
    return start + (end - start) * phase


def frame_samples(action):
    start, end = action.frame_range
    for frame in range(math.floor(start), math.ceil(end)):
        for subframe in range(8):
            value = frame + subframe / 8
            if start <= value <= end:
                yield value
    yield end


def set_frame(value: float):
    integer = math.floor(value)
    bpy.context.scene.frame_set(integer, subframe=value - integer)


def validate_static(body, fins):
    body_vertices, _ = evaluated_geometry(body)
    fin_vertices, _ = evaluated_geometry(fins)
    xs = [vertex.x for vertex in body_vertices + fin_vertices]
    length = max(xs) - min(xs)
    if abs(length - 0.08) > 0.002:
        raise GateFailure(f"Rest length {length:.6f} m is outside 0.080 +/- 0.002 m")
    pairs = (("pectoral_L", "pectoral_R"), ("pelvic_L", "pelvic_R"))
    for left, right in pairs:
        left_points = [fin_vertices[index] for index in sorted(group_indices(fins, f"fin_{left}"))]
        right_points = [fin_vertices[index] for index in sorted(group_indices(fins, f"fin_{right}"))]
        if len(left_points) != len(right_points):
            raise GateFailure(f"Paired fin vertex mismatch {left}/{right}")
        error = max((Vector((a.x - b.x, a.y + b.y, a.z - b.z)).length for a, b in zip(left_points, right_points)), default=0)
        if error > 0.0004:
            raise GateFailure(f"Paired fin symmetry error {error:.6f} m exceeds 0.0004 m")
    return length


def source_gate():
    rig = bpy.data.objects.get("PA_ocellaris_Rig")
    body = bpy.data.objects.get("PA_ocellaris_Body")
    fins = bpy.data.objects.get("PA_ocellaris_Fins")
    if not rig or not body or not fins:
        raise GateFailure("Stable source objects are missing")
    retained = sorted(action.name for action in bpy.data.actions if action.name in CLIPS)
    if retained != ["burst", "idle", "swim"]:
        raise GateFailure(f"Fresh source did not retain exact actions: {retained}")
    if any(abs(value) > 1e-9 for value in (*bpy.data.objects["PA_ocellaris_Root"].location, *bpy.data.objects["PA_ocellaris_Root"].rotation_euler)):
        raise GateFailure("Source root is not at canonical zero transform")
    for name in BODY_ZONES:
        group_indices(body, name)
    for name in FIN_NAMES:
        group_indices(body, f"attach_{name}")
        group_indices(fins, f"attach_{name}")
        group_indices(fins, f"fin_{name}")

    rig.animation_data.action = None
    for pose in rig.pose.bones:
        pose.rotation_mode = "QUATERNION"
        pose.rotation_quaternion = Quaternion((1, 0, 0, 0))
    bpy.context.scene.frame_set(1)
    body_rest_vertices, body_rest_triangles = evaluated_geometry(body)
    rest_body_normals = [triangle_normal(body_rest_vertices, triangle) for triangle in body_rest_triangles]
    rest_volume = signed_volume(body_rest_vertices, body_rest_triangles)
    rest_length = validate_static(body, fins)

    report = {
        "schemaVersion": 1,
        "status": "passed",
        "binary": bpy.app.version_string,
        "retainedActions": retained,
        "samplesPerFrame": 8,
        "restLengthMeters": rest_length,
        "restSignedVolume": rest_volume,
        "clips": {},
    }
    for clip_name in CLIPS:
        action = action_for(clip_name)
        set_action(rig, action)
        metrics = {"sampleCount": 0, "minimumHeadClearanceMeters": 1.0, "minimumNormalDot": 1.0, "maximumJointBendDegrees": 0.0, "maximumCumulativeCurvatureDegrees": 0.0}
        phase_data = {}
        for phase in PHASES:
            set_frame(phase_frame(action, phase))
            phase_data[f"{phase:.2f}"] = sample_pose(rig)
        set_frame(action.frame_range[0])
        for bone_name in AXIAL_BONES:
            neutral = rig.pose.bones[bone_name].matrix_basis.to_quaternion()
            if angle_degrees(Quaternion((1, 0, 0, 0)), neutral) > 0.1:
                raise GateFailure(f"{clip_name}: neutral rotation on {bone_name} exceeds 0.1 degree")
        for value in frame_samples(action):
            set_frame(value)
            joint, cumulative = validate_axial_chain(rig, clip_name)
            clearance, normal_dot, _volume = validate_geometry_sample(body, fins, rest_body_normals, rest_volume, clip_name)
            metrics["sampleCount"] += 1
            metrics["minimumHeadClearanceMeters"] = min(metrics["minimumHeadClearanceMeters"], clearance)
            metrics["minimumNormalDot"] = min(metrics["minimumNormalDot"], normal_dot)
            metrics["maximumJointBendDegrees"] = max(metrics["maximumJointBendDegrees"], joint)
            metrics["maximumCumulativeCurvatureDegrees"] = max(metrics["maximumCumulativeCurvatureDegrees"], cumulative)
        report["clips"][clip_name] = {"frameRange": list(action.frame_range), "loop": bool(action.get("loop", False)), "metrics": metrics, "phases": phase_data}
    rig.animation_data.action = None
    SOURCE_REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"stage": "source", "status": "passed", "report": str(SOURCE_REPORT_PATH), "clips": {name: data["metrics"] for name, data in report["clips"].items()}}, indent=2))


def read_glb():
    data = GLB_PATH.read_bytes()
    magic, version, _length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF" or version != 2:
        raise GateFailure("Runtime is not glTF 2.0 GLB")
    offset = 12
    chunks = {}
    while offset < len(data):
        length, kind = struct.unpack_from("<II", data, offset)
        chunks[kind] = data[offset + 8:offset + 8 + length]
        offset += 8 + length
    return json.loads(chunks[0x4E4F534A].rstrip(b" \0")), chunks[0x004E4942]


def accessor_values(document, binary, accessor_index):
    accessor = document["accessors"][accessor_index]
    view = document["bufferViews"][accessor["bufferView"]]
    component = {5126: "f", 5125: "I", 5123: "H", 5121: "B"}[accessor["componentType"]]
    width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[accessor["type"]]
    component_size = struct.calcsize("<" + component)
    stride = view.get("byteStride", component_size * width)
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    return [struct.unpack_from("<" + component * width, binary, start + index * stride) for index in range(accessor["count"])]


def glb_neutral_offsets(document, binary):
    nodes = document.get("nodes", [])
    node_by_name = {node.get("name"): index for index, node in enumerate(nodes)}
    offsets = {}
    for animation in document.get("animations", []):
        clip = animation.get("name")
        offsets[clip] = {}
        channels_by_node = {channel["target"]["node"]: channel for channel in animation.get("channels", []) if channel["target"].get("path") == "rotation"}
        for bone_name in AXIAL_BONES:
            node_index = node_by_name.get(bone_name)
            if node_index is None or node_index not in channels_by_node:
                raise GateFailure(f"GLB {clip} missing rotation channel for {bone_name}")
            channel = channels_by_node[node_index]
            sampler = animation["samplers"][channel["sampler"]]
            first = accessor_values(document, binary, sampler["output"])[0]
            base = nodes[node_index].get("rotation", [0, 0, 0, 1])
            first_q = Quaternion((first[3], first[0], first[1], first[2])).normalized()
            base_q = Quaternion((base[3], base[0], base[1], base[2])).normalized()
            offset = angle_degrees(base_q, first_q)
            offsets[clip][bone_name] = offset
            if offset > 0.1:
                raise GateFailure(f"GLB {clip} neutral offset on {bone_name} is {offset:.6f} degrees")
    return offsets


def runtime_gate():
    source = json.loads(SOURCE_REPORT_PATH.read_text(encoding="utf-8"))
    document, binary = read_glb()
    clip_names = sorted(animation.get("name") for animation in document.get("animations", []))
    if clip_names != ["burst", "idle", "swim"]:
        raise GateFailure(f"GLB clip contract failed: {clip_names}")
    neutral_offsets = glb_neutral_offsets(document, binary)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    bpy.ops.import_scene.gltf(filepath=str(GLB_PATH))
    rig = bpy.data.objects.get("PA_ocellaris_Rig")
    if not rig:
        armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
        if len(armatures) != 1:
            raise GateFailure(f"Imported runtime has {len(armatures)} armatures")
        rig = armatures[0]
    report = {"schemaVersion": 1, "status": "passed", "binary": bpy.app.version_string, "neutralOffsetsDegrees": neutral_offsets, "clips": {}}
    for clip_name in CLIPS:
        action = action_for(clip_name)
        set_action(rig, action)
        clip_report = {"maxBoneRotationErrorDegrees": 0.0, "maxLandmarkErrorMeters": 0.0, "phases": {}}
        source_clip = source["clips"][clip_name]
        for phase in PHASES:
            key = f"{phase:.2f}"
            set_frame(phase_frame(action, phase))
            current = sample_pose(rig)
            expected = source_clip["phases"][key]
            phase_bone_error = 0.0
            for bone_name, values in expected["bones"].items():
                error = angle_degrees(Quaternion(values), Quaternion(current["bones"][bone_name]))
                phase_bone_error = max(phase_bone_error, error)
                if error > 0.5:
                    raise GateFailure(f"GLB parity {clip_name} phase {key} bone {bone_name}: {error:.6f} degrees")
            phase_landmark_error = 0.0
            for name, values in expected["landmarks"].items():
                error = (Vector(values) - Vector(current["landmarks"][name])).length
                phase_landmark_error = max(phase_landmark_error, error)
                if error > 0.00025:
                    raise GateFailure(f"GLB parity {clip_name} phase {key} landmark {name}: {error:.7f} m")
            clip_report["maxBoneRotationErrorDegrees"] = max(clip_report["maxBoneRotationErrorDegrees"], phase_bone_error)
            clip_report["maxLandmarkErrorMeters"] = max(clip_report["maxLandmarkErrorMeters"], phase_landmark_error)
            clip_report["phases"][key] = {"maxBoneRotationErrorDegrees": phase_bone_error, "maxLandmarkErrorMeters": phase_landmark_error}
        if source_clip["loop"]:
            start, end = action.frame_range
            set_frame(start)
            first = sample_pose(rig)
            set_frame(end)
            last = sample_pose(rig)
            seam_rotation = max(angle_degrees(Quaternion(first["bones"][name]), Quaternion(last["bones"][name])) for name in AXIAL_BONES)
            seam_landmark = max((Vector(first["landmarks"][name]) - Vector(last["landmarks"][name])).length for name in LANDMARKS)
            if seam_rotation > 0.5 or seam_landmark > 0.00025:
                raise GateFailure(f"GLB loop seam failed for {clip_name}: {seam_rotation:.6f} degrees, {seam_landmark:.7f} m")
            clip_report["loopSeam"] = {"rotationDegrees": seam_rotation, "landmarkMeters": seam_landmark}
        report["clips"][clip_name] = clip_report
    RUNTIME_REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    manifest["validator"] = {
        "status": "passed",
        "sourceReport": str(SOURCE_REPORT_PATH.relative_to(ROOT)),
        "runtimeReport": str(RUNTIME_REPORT_PATH.relative_to(ROOT)),
        "samplesPerFrame": 8,
        "gates": ["triangle_bvh_zones", "fin_attachment_exclusion", "center_plane", "axial_curvature", "normal_orientation", "retained_actions", "neutral_offsets", "blender_glb_parity"],
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"stage": "runtime", "status": "passed", "report": str(RUNTIME_REPORT_PATH), "clips": report["clips"]}, indent=2))


def main():
    args = parse_args()
    try:
        source_gate() if args.stage == "source" else runtime_gate()
    except Exception as error:
        report_path = SOURCE_REPORT_PATH if args.stage == "source" else RUNTIME_REPORT_PATH
        report_path.write_text(json.dumps({"schemaVersion": 1, "status": "failed", "stage": args.stage, "error": str(error)}, indent=2) + "\n", encoding="utf-8")
        raise


if __name__ == "__main__":
    main()
