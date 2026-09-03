"""Generic source/runtime/determinism gates for visual-catalog candidates (never promotes).

    Blender <candidate>/source.blend --background --python catalog/validate.py -- --asset <id> --candidate-dir <dir> --stage source
    Blender --background --factory-startup --python catalog/validate.py -- --asset <id> --candidate-dir <dir> --stage runtime
    Blender --background --factory-startup --python catalog/validate.py -- --asset <id> --candidate-dir <dir> --stage determinism --rebuild-dir <scratch>
"""

from __future__ import annotations

import argparse
import itertools
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector
from mathutils.bvhtree import BVHTree

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from catalog.lib import digest, glb  # noqa: E402
from catalog.lib.rigging import identity_pose  # noqa: E402

ROOT = SCRIPTS_ROOT.parents[1]  # realistic_light_transport/
PHASES = (0.0, 0.25, 0.5, 0.75)
ACCEPTED_OCELLARIS = "ed4d447b2c7d88e91f45699a76b2ff3768144b57e6acb4199000567bafe37ac0"
ACCEPTED_OCELLARIS_PATH = ROOT / "src" / "assets" / "specimens" / "ocellaris" / "v1" / "lod1.glb"


class GateFailure(RuntimeError):
    pass


# ---------------------------------------------------------------- shared helpers

def group_members(obj, name: str) -> set[int]:
    group = obj.vertex_groups.get(name)
    if group is None:
        raise GateFailure(f"{obj.name} is missing vertex group {name}")
    return {v.index for v in obj.data.vertices if any(g.group == group.index and g.weight > 0.5 for g in v.groups)}


def evaluated(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(depsgraph)
    mesh = ev.to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)
    if len(mesh.vertices) != len(obj.data.vertices):
        ev.to_mesh_clear()
        raise GateFailure(f"Topology-changing modifier on {obj.name}")
    mesh.calc_loop_triangles()
    matrix = ev.matrix_world
    vertices = [matrix @ v.co for v in mesh.vertices]
    triangles = [tuple(t.vertices) for t in mesh.loop_triangles]
    ev.to_mesh_clear()
    return vertices, triangles


def tri_normal(vertices, tri):
    a, b, c = (vertices[i] for i in tri)
    n = (b - a).cross(c - a)
    return n.normalized() if n.length > 1e-14 else Vector((0, 0, 0))


def signed_volume(vertices, triangles):
    return sum(vertices[a].dot(vertices[b].cross(vertices[c])) for a, b, c in triangles) / 6.0


def tris_in(triangles, members: set[int], exclude: set[int] | None = None):
    exclude = exclude or set()
    return [t for t in triangles if all(i in members for i in t) and not any(i in exclude for i in t)]


def bvh(vertices, triangles, label):
    if not triangles:
        raise GateFailure(f"No triangles for clearance group {label}")
    return BVHTree.FromPolygons(vertices, triangles, all_triangles=True, epsilon=1e-9)


def set_frame(value: float):
    whole = math.floor(value)
    bpy.context.scene.frame_set(whole, subframe=value - whole)


def angle_degrees(a: Quaternion, b: Quaternion) -> float:
    return math.degrees(a.rotation_difference(b).angle)


def bounds_of(vertex_lists):
    low = Vector((1e9, 1e9, 1e9))
    high = Vector((-1e9, -1e9, -1e9))
    for vertices in vertex_lists:
        for v in vertices:
            low.x, low.y, low.z = min(low.x, v.x), min(low.y, v.y), min(low.z, v.z)
            high.x, high.y, high.z = max(high.x, v.x), max(high.y, v.y), max(high.z, v.z)
    return low, high


def shape_key_values(meshes):
    values = {}
    for obj in meshes:
        if obj.data.shape_keys:
            for block in obj.data.shape_keys.key_blocks:
                if block.name != "Basis":
                    values[f"{obj.name}/{block.name}"] = round(block.value, 5)
    return values


# ---------------------------------------------------------------- source gate

def source_gate(contract: dict, candidate_dir: Path):
    rig = bpy.data.objects.get(contract["rig"])
    root = bpy.data.objects.get(contract["root"])
    if rig is None or root is None:
        raise GateFailure("Rig or root object missing from saved source")
    meshes = [bpy.data.objects[name] for name in contract["meshes"]]
    deform = [b for b in rig.data.bones if b.use_deform]
    if len(deform) > contract["maxDeformBones"]:
        raise GateFailure(f"{len(deform)} deform bones exceed {contract['maxDeformBones']}")
    if any(abs(v) > 1e-9 for v in (*root.location, *root.rotation_euler)):
        raise GateFailure("Root is not at the canonical zero transform")
    retained = sorted(a.name for a in bpy.data.actions if a.name in contract["clips"])
    if retained != sorted(contract["clips"]):
        raise GateFailure(f"Saved source retained actions {retained}, expected {sorted(contract['clips'])}")
    for obj in bpy.context.scene.objects:
        if obj.animation_data:
            obj.animation_data.action = None
    for obj in meshes:
        if obj.data.shape_keys:
            if obj.data.shape_keys.animation_data:
                obj.data.shape_keys.animation_data.action = None
            for block in obj.data.shape_keys.key_blocks:
                block.value = 0.0
    identity_pose(rig)
    bpy.context.scene.frame_set(1)

    report = {"schemaVersion": 2, "status": "passed", "binary": bpy.app.version_string, "retainedActions": retained,
              "deformBones": len(deform), "gates": [], "clips": {}}

    # static geometry gates
    rest = {}
    total_triangles = 0
    for obj in meshes:
        vertices, triangles = evaluated(obj)
        if not all(math.isfinite(c) for v in vertices for c in v):
            raise GateFailure(f"{obj.name} has non-finite rest vertices")
        rest[obj.name] = (vertices, triangles)
        total_triangles += len(triangles)
        if obj.modifiers and any(m.type == "ARMATURE" for m in obj.modifiers):
            for v in obj.data.vertices:
                total = sum(g.weight for g in v.groups if obj.vertex_groups[g.group].name in {b.name for b in rig.data.bones})
                if not math.isfinite(total) or total < 0.99:
                    raise GateFailure(f"{obj.name} vertex {v.index} has deform weight {total:.4f}")
    budget = contract["triangleBudget"]
    if not budget[0] <= total_triangles <= budget[1]:
        raise GateFailure(f"Source triangle count {total_triangles} is outside budget {budget}")
    report["sourceTriangles"] = total_triangles
    report["gates"].append("finite_vertices_and_weights")
    report["gates"].append("triangle_budget")

    low, high = bounds_of(rest[name][0] for name in rest)
    axis = contract["size"]["axis"]
    extent = high - low
    measured = {"x": extent.x, "y": extent.y, "z": extent.z, "xy": max(extent.x, extent.y), "max": max(extent.x, extent.y, extent.z)}[axis]
    target = contract["size"]["meters"]
    if abs(measured - target) > target * contract["size"]["tolerance"]:
        raise GateFailure(f"Rest size {measured:.5f} m along {axis} is outside {target} +/- {contract['size']['tolerance'] * 100:.0f}%")
    report["restSizeMeters"] = measured
    report["restBounds"] = {"min": list(low), "max": list(high)}
    report["gates"].append("reference_size")

    closed = []
    for part in contract["closedParts"]:
        obj = bpy.data.objects[part["object"]]
        members = group_members(obj, part["group"])
        vertices, triangles = rest[obj.name]
        part_tris = tris_in(triangles, members)
        if not part_tris:
            raise GateFailure(f"Closed part {part['group']} has no triangles")
        edges: dict[tuple[int, int], int] = {}
        for tri in part_tris:
            area = (vertices[tri[1]] - vertices[tri[0]]).cross(vertices[tri[2]] - vertices[tri[0]]).length / 2
            if area < 1e-13:
                raise GateFailure(f"Zero-area face in {obj.name}/{part['group']}")
            for a, b in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
                edges[(min(a, b), max(a, b))] = edges.get((min(a, b), max(a, b)), 0) + 1
        # polygons are triangulated, so quad diagonals count twice; boundary edges count once
        boundary = [edge for edge, count in edges.items() if count == 1]
        if boundary:
            raise GateFailure(f"{obj.name}/{part['group']} is not watertight: {len(boundary)} boundary edges")
        over = [edge for edge, count in edges.items() if count > 2 and part.get("allowShared", False) is False]
        if over:
            # shared edges between adjacent lofted parts are impossible inside one closed part
            raise GateFailure(f"{obj.name}/{part['group']} has {len(over)} non-manifold edges")
        normals = [tri_normal(vertices, t) for t in part_tris]
        volume = signed_volume(vertices, part_tris)
        if volume <= 0:
            raise GateFailure(f"{obj.name}/{part['group']} has non-positive volume (inverted winding)")
        closed.append((obj, part, part_tris, normals, volume))
    report["gates"].append("closed_parts_watertight_manifold")

    for check in contract.get("symmetry", []):
        obj = bpy.data.objects[check["object"]]
        vertices, _ = rest[obj.name]
        left = [vertices[i] for i in sorted(group_members(obj, check["left"]))]
        right = [vertices[i] for i in sorted(group_members(obj, check["right"]))]
        if len(left) != len(right):
            raise GateFailure(f"Symmetry vertex count mismatch {check['left']}/{check['right']}")
        error = max((Vector((a.x - b.x, a.y + b.y, a.z - b.z)).length for a, b in zip(left, right)), default=0.0)
        if error > check["tolerance"]:
            raise GateFailure(f"Symmetry error {error:.6f} m between {check['left']} and {check['right']}")
    if contract.get("symmetry"):
        report["gates"].append("bilateral_symmetry")

    # resolve clearance groups once
    clearance_specs = []
    for item in contract["clearance"]:
        def resolve(entry):
            obj = bpy.data.objects[entry[0]]
            members = group_members(obj, entry[1])
            exclude = group_members(obj, entry[2]) if len(entry) > 2 and entry[2] else set()
            return obj, members, exclude
        clearance_specs.append((resolve(item["a"]), resolve(item["b"]), item.get("minDistance"), item.get("label", f"{item['a'][1]}/{item['b'][1]}")))
    plane_specs = []
    for item in contract["centerPlane"]:
        obj = bpy.data.objects[item["object"]]
        plane_specs.append((obj, group_members(obj, item["group"]) - (group_members(obj, item["exclude"]) if item.get("exclude") else set()), item["side"]))

    axial = contract.get("axialChain")

    def check_axial(clip_name, loop):
        names = axial["bones"]
        rest_dirs = [(rig.data.bones[n].tail_local - rig.data.bones[n].head_local).normalized() for n in names]
        posed = [(rig.pose.bones[n].tail - rig.pose.bones[n].head).normalized() for n in names]
        for n, r, p in zip(names, rest_dirs, posed):
            if r.dot(p) <= 0:
                raise GateFailure(f"{clip_name}: axial reversal at {n}")
        angles = [math.degrees(posed[i].angle(posed[i + 1])) for i in range(len(posed) - 1)]
        limit = axial["maxJointDegrees"] if loop else axial["maxJointDegreesResponse"]
        if max(angles) > limit + 1e-4:
            raise GateFailure(f"{clip_name}: joint bend {max(angles):.3f} exceeds {limit}")
        if sum(angles) >= axial["maxCumulativeDegrees"]:
            raise GateFailure(f"{clip_name}: cumulative curvature {sum(angles):.3f} exceeds {axial['maxCumulativeDegrees']}")
        return max(angles), sum(angles)

    def sample_geometry(clip_name):
        current = {}
        for obj in meshes:
            vertices, triangles = evaluated(obj)
            if not all(math.isfinite(c) for v in vertices for c in v):
                raise GateFailure(f"{clip_name}: {obj.name} produced non-finite vertices")
            current[obj.name] = (vertices, triangles)
        for obj, part, part_tris, rest_normals, rest_volume in closed:
            vertices = current[obj.name][0]
            worst = min(tri_normal(vertices, t).dot(n) for t, n in zip(part_tris, rest_normals))
            if worst <= 0:
                raise GateFailure(f"{clip_name}: inverted triangle in {obj.name}/{part['group']} (dot {worst:.4f})")
            volume = signed_volume(vertices, part_tris)
            if volume < rest_volume * part.get("volumeFloor", 0.6):
                raise GateFailure(f"{clip_name}: {obj.name}/{part['group']} volume collapsed to {volume / rest_volume:.3f}")
        trees = {}

        def tree(obj, members, exclude):
            key = (obj.name, id(members), id(exclude))
            if key not in trees:
                vertices, triangles = current[obj.name]
                trees[key] = bvh(vertices, tris_in(triangles, members, exclude), f"{obj.name}")
            return trees[key]
        clearance_min = 1.0
        for (oa, ma, xa), (ob, mb, xb), min_distance, label in clearance_specs:
            ta = tree(oa, ma, xa)
            tb = tree(ob, mb, xb)
            if ta.overlap(tb):
                raise GateFailure(f"{clip_name}: intersection {label}")
            if min_distance:
                points = [current[ob.name][0][i] for i in mb - xb]
                nearest = min((ta.find_nearest(p)[3] for p in points), default=1.0)
                clearance_min = min(clearance_min, nearest)
                if nearest < min_distance:
                    raise GateFailure(f"{clip_name}: clearance {label} {nearest:.6f} m is below {min_distance:.6f} m")
        for obj, members, side in plane_specs:
            vertices = current[obj.name][0]
            if side < 0 and any(vertices[i].y >= -1e-5 for i in members):
                raise GateFailure(f"{clip_name}: left appendage crossed the centre plane on {obj.name}")
            if side > 0 and any(vertices[i].y <= 1e-5 for i in members):
                raise GateFailure(f"{clip_name}: right appendage crossed the centre plane on {obj.name}")
        return current, clearance_min

    def pose_snapshot(clip_info):
        bones = {}
        for name in clip_info["bones"]:
            pb = rig.pose.bones[name]
            bones[name] = {"rotation": [round(c, 6) for c in pb.matrix_basis.to_quaternion().normalized()],
                           "location": [round(c, 6) for c in pb.location], "scale": [round(c, 6) for c in pb.scale]}
        return bones

    stride = int(contract.get("sampleStride", 2))
    for clip_name, clip_info in contract["clips"].items():
        action = bpy.data.actions.get(clip_name)
        if action is None:
            raise GateFailure(f"Clip {clip_name} is missing")
        rig.animation_data_create()
        rig.animation_data.action = action
        for obj in meshes:
            if obj.data.shape_keys and any(k.startswith(f"shapekey:{obj.name}/") for k in clip_info.get("shapeKeys", [])):
                obj.data.shape_keys.animation_data_create()
                obj.data.shape_keys.animation_data.action = action
        start, end = action.frame_range
        if end <= start:
            raise GateFailure(f"Clip {clip_name} has no duration")
        metrics = {"samples": 0, "maxJointDegrees": 0.0, "maxCumulativeDegrees": 0.0, "minClearanceMeters": 1.0}
        phases = {}
        motion = {name: 0.0 for name in clip_info["bones"]}
        key_motion = {name: 0.0 for name in clip_info.get("shapeKeys", [])}
        if not clip_info["loop"]:
            set_frame(start)
            for name in clip_info["bones"]:
                pb = rig.pose.bones[name]
                if angle_degrees(Quaternion((1, 0, 0, 0)), pb.matrix_basis.to_quaternion()) > 0.5 or pb.location.length > 1e-5 or (pb.scale - Vector((1, 1, 1))).length > 1e-4:
                    raise GateFailure(f"{clip_name}: response clip does not start at the neutral pose ({name})")
        bounds_low, bounds_high = None, None
        samples = list(range(int(start), int(end) + 1, stride))
        if int(end) not in samples:
            samples.append(int(end))
        for frame in samples:
            set_frame(frame)
            if axial:
                joint, cumulative = check_axial(clip_name, clip_info["loop"])
                metrics["maxJointDegrees"] = max(metrics["maxJointDegrees"], joint)
                metrics["maxCumulativeDegrees"] = max(metrics["maxCumulativeDegrees"], cumulative)
            current, clearance_min = sample_geometry(clip_name)
            metrics["minClearanceMeters"] = min(metrics["minClearanceMeters"], clearance_min)
            metrics["samples"] += 1
            for name in clip_info["bones"]:
                pb = rig.pose.bones[name]
                motion[name] = max(motion[name], angle_degrees(Quaternion((1, 0, 0, 0)), pb.matrix_basis.to_quaternion()),
                                   pb.location.length * 1000.0, (pb.scale - Vector((1, 1, 1))).length * 100.0)
            for key in clip_info.get("shapeKeys", []):
                obj_name, block_name = key[len("shapekey:"):].split("/", 1)
                key_motion[key] = max(key_motion[key], bpy.data.objects[obj_name].data.shape_keys.key_blocks[block_name].value)
            low_f, high_f = bounds_of(current[name][0] for name in current)
            bounds_low = low_f if bounds_low is None else Vector((min(bounds_low.x, low_f.x), min(bounds_low.y, low_f.y), min(bounds_low.z, low_f.z)))
            bounds_high = high_f if bounds_high is None else Vector((max(bounds_high.x, high_f.x), max(bounds_high.y, high_f.y), max(bounds_high.z, high_f.z)))
        still = [name for name, value in motion.items() if value < 0.05]
        if still:
            raise GateFailure(f"{clip_name}: declared animated bones never move: {still}")
        still_keys = [name for name, value in key_motion.items() if value < 0.02]
        if still_keys:
            raise GateFailure(f"{clip_name}: declared shape keys never move: {still_keys}")
        for phase in PHASES:
            set_frame(start + (end - start) * phase)
            phases[f"{phase:.2f}"] = {"bones": pose_snapshot(clip_info), "shapeKeys": shape_key_values(meshes)}
        report["clips"][clip_name] = {"frameRange": [start, end], "loop": clip_info["loop"], "metrics": metrics, "phases": phases,
                                      "animatedBounds": {"min": list(bounds_low), "max": list(bounds_high)}}
        rig.animation_data.action = None
        for obj in meshes:
            if obj.data.shape_keys and obj.data.shape_keys.animation_data:
                obj.data.shape_keys.animation_data.action = None
                for block in obj.data.shape_keys.key_blocks:
                    block.value = 0.0
    identity_pose(rig)
    report["gates"] += ["animated_clearance_bvh", "closed_part_orientation_and_volume", "clip_targets_move"]
    if axial:
        report["gates"].append("axial_curvature")
    if plane_specs:
        report["gates"].append("center_plane")
    roles = contract["clipRoles"]
    for role in ("idle", "locomotion", "response"):
        if roles[role] not in report["clips"]:
            raise GateFailure(f"Clip role {role} -> {roles[role]} did not validate")
    report["gates"].append("clip_roles_resolve")
    digest.write_json(candidate_dir / "validation-source.json", report)
    print(json.dumps({"stage": "source", "status": "passed", "sourceTriangles": total_triangles,
                      "clips": {n: c["metrics"] for n, c in report["clips"].items()}}, indent=2))


# ---------------------------------------------------------------- runtime gate

def runtime_gate(contract: dict, candidate_dir: Path, asset_id: str):
    source = digest.read_json(candidate_dir / "validation-source.json")
    if source.get("status") != "passed":
        raise GateFailure("Source gate did not pass")
    manifest = digest.read_json(candidate_dir / "candidate.manifest.json")
    glb_path = candidate_dir / "lod1.glb"
    if not glb_path.exists() or glb_path.stat().st_size == 0:
        raise GateFailure("Runtime GLB is missing or empty")
    document, binary = glb.read_glb(glb_path)
    extras = document.get("asset", {}).get("extras", {}).get("pocketAquarium")
    if not extras or extras.get("speciesId") != asset_id or not extras.get("candidate"):
        raise GateFailure("GLB asset extras do not identify this candidate")
    report = {"schemaVersion": 2, "status": "passed", "binary": bpy.app.version_string, "gates": [], "clips": {}}

    # accessor integrity
    for index, accessor in enumerate(document.get("accessors", [])):
        values = glb.accessor_values(document, binary, index)
        if len(values) != accessor["count"]:
            raise GateFailure(f"Accessor {index} count mismatch")
        if accessor["componentType"] == 5126 and not glb.all_finite(values):
            raise GateFailure(f"Accessor {index} holds non-finite floats")
    report["gates"].append("accessors_in_bounds_and_finite")
    weight_vertices = 0
    for mesh in document.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            attributes = primitive["attributes"]
            if "WEIGHTS_0" in attributes:
                weights = glb.accessor_values(document, binary, attributes["WEIGHTS_0"])
                for w in weights:
                    total = sum(w)
                    if not (0.98 <= total <= 1.02):
                        raise GateFailure(f"Skin weights sum to {total:.4f} on mesh {mesh.get('name')}")
                weight_vertices += len(weights)
            for target in primitive.get("targets", []):
                if "POSITION" in target and not glb.all_finite(glb.accessor_values(document, binary, target["POSITION"])):
                    raise GateFailure("Morph target holds non-finite positions")
    if weight_vertices == 0:
        raise GateFailure("GLB has no skinned vertices")
    report["gates"].append("skin_weights_normalised")

    stats = manifest["statistics"]
    triangles = glb.triangle_count(document)
    if triangles != stats["triangles"]:
        raise GateFailure(f"Triangle count {triangles} differs from manifest {stats['triangles']}")
    budget = contract["triangleBudget"]
    if not budget[0] <= triangles <= budget[1]:
        raise GateFailure(f"Runtime triangle count {triangles} is outside budget {budget}")
    if len(document.get("materials", [])) != stats["materials"] or len(document.get("nodes", [])) != stats["nodes"]:
        raise GateFailure("Material or node inventory differs from the manifest")
    if len(document.get("skins", [])) != 1:
        raise GateFailure(f"Expected exactly one skin, found {len(document.get('skins', []))}")
    node_names = [node.get("name") for node in document.get("nodes", [])]
    for bone in contract.get("axialChain", {}).get("bones", []) if contract.get("axialChain") else []:
        if bone not in node_names:
            raise GateFailure(f"Axial bone {bone} is missing from the GLB node tree")
    images = document.get("images", [])
    if not images:
        raise GateFailure("GLB embeds no textures")
    for image in images:
        if "bufferView" not in image or image.get("mimeType") != "image/png":
            raise GateFailure("Texture is not an embedded PNG")
    mesh_names = [mesh.get("name") for mesh in document.get("meshes", [])]
    if len(mesh_names) != len(set(mesh_names)):
        raise GateFailure(f"Duplicate mesh names in GLB: {mesh_names}")
    report["inventory"] = {"triangles": triangles, "materials": len(document["materials"]), "nodes": len(document["nodes"]),
                           "skinJoints": len(document["skins"][0]["joints"]), "images": len(images), "meshes": mesh_names}
    report["gates"] += ["inventory_matches_manifest", "single_skin", "embedded_png_textures"]

    # clips
    names = glb.clip_names(document)
    if names != sorted(contract["clips"]):
        raise GateFailure(f"GLB clips {names} differ from contract {sorted(contract['clips'])}")
    durations = glb.clip_durations(document, binary)
    for animation in document["animations"]:
        clip_name = animation["name"]
        info = contract["clips"][clip_name]
        targeted_nodes = set()
        weights_targets = set()
        moving = False
        for channel in animation["channels"]:
            target = channel["target"]
            node = document["nodes"][target["node"]]
            sampler = animation["samplers"][channel["sampler"]]
            times = glb.accessor_values(document, binary, sampler["input"])
            if any(b[0] <= a[0] for a, b in zip(times, times[1:])):
                raise GateFailure(f"{clip_name}: sampler times are not strictly increasing")
            outputs = glb.accessor_values(document, binary, sampler["output"])
            spread = max(max(abs(o[k] - outputs[0][k]) for o in outputs) for k in range(len(outputs[0])))
            if target["path"] == "weights":
                weights_targets.add(node.get("name"))
            else:
                targeted_nodes.add(node.get("name"))
            if spread > 1e-4:
                moving = True
        if not moving:
            raise GateFailure(f"{clip_name}: no channel changes over time")
        expected_bones = set(info["bones"])
        missing = expected_bones - targeted_nodes
        if missing:
            raise GateFailure(f"{clip_name}: bones {sorted(missing)} have no animation channel in the GLB")
        if info.get("shapeKeys") and not weights_targets:
            raise GateFailure(f"{clip_name}: declared shape keys but the GLB has no weights channel")
        if durations[clip_name] <= 0:
            raise GateFailure(f"{clip_name}: zero duration")
        report["clips"][clip_name] = {"durationSeconds": durations[clip_name], "targetedBones": sorted(targeted_nodes & expected_bones),
                                      "morphTargets": sorted(weights_targets), "loop": info["loop"]}
    roles = contract["clipRoles"]
    for role in ("idle", "locomotion", "response"):
        if roles[role] not in report["clips"]:
            raise GateFailure(f"Clip role {role} -> {roles[role]} is missing from the GLB")
    report["gates"] += ["clip_inventory", "clip_roles_resolve", "clip_channels_animate_declared_targets"]

    # import parity in a fresh scene
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    armatures = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    if len(armatures) != 1:
        raise GateFailure(f"Imported runtime has {len(armatures)} armatures")
    rig = armatures[0]
    # the importer may add helper objects (bone display icospheres); only the authored meshes count
    imported_meshes = [o for o in bpy.context.scene.objects if o.type == "MESH" and o.name in contract["meshes"]]
    if sorted(o.name for o in imported_meshes) != sorted(contract["meshes"]):
        raise GateFailure(f"Imported meshes {[o.name for o in imported_meshes]} differ from contract {contract['meshes']}")
    parity = {}
    for clip_name, info in contract["clips"].items():
        action = bpy.data.actions.get(clip_name) or next((a for a in bpy.data.actions if a.name.split(".")[0] == clip_name), None)
        if action is None:
            raise GateFailure(f"Imported runtime lacks action {clip_name}")
        rig.animation_data_create()
        rig.animation_data.action = action
        for obj in imported_meshes:
            if obj.data.shape_keys:
                obj.data.shape_keys.animation_data_create()
                obj.data.shape_keys.animation_data.action = action
        start, end = action.frame_range
        max_error = 0.0
        for phase in PHASES:
            key = f"{phase:.2f}"
            set_frame(start + (end - start) * phase)
            expected = source["clips"][clip_name]["phases"][key]["bones"]
            for bone_name, values in expected.items():
                pb = rig.pose.bones.get(bone_name)
                if pb is None:
                    raise GateFailure(f"Imported rig lacks bone {bone_name}")
                error = angle_degrees(Quaternion(values["rotation"]), pb.matrix_basis.to_quaternion())
                max_error = max(max_error, error)
                if error > 0.75:
                    raise GateFailure(f"Parity {clip_name} {key} {bone_name}: {error:.4f} degrees")
        seam = None
        if info["loop"]:
            set_frame(start)
            first = {n: rig.pose.bones[n].matrix_basis.to_quaternion() for n in info["bones"]}
            set_frame(end)
            seam = max(angle_degrees(first[n], rig.pose.bones[n].matrix_basis.to_quaternion()) for n in info["bones"]) if info["bones"] else 0.0
            if seam > 0.75:
                raise GateFailure(f"Loop seam on {clip_name}: {seam:.4f} degrees")
        parity[clip_name] = {"maxBoneRotationErrorDegrees": max_error, "loopSeamDegrees": seam}
        rig.animation_data.action = None
        for obj in imported_meshes:
            if obj.data.shape_keys and obj.data.shape_keys.animation_data:
                obj.data.shape_keys.animation_data.action = None
    identity_pose(rig)
    bpy.context.scene.frame_set(1)
    low, high = bounds_of(evaluated(o)[0] for o in imported_meshes)
    # the importer converts Y-up back to Z-up, so compare in source space
    source_bounds = source["restBounds"]
    deviation = max((Vector(source_bounds["max"]) - high).length, (Vector(source_bounds["min"]) - low).length)
    if deviation > max(0.0015, contract["size"]["meters"] * 0.01):
        raise GateFailure(f"Imported rest bounds deviate by {deviation:.5f} m from the source")
    report["parity"] = parity
    report["importedRestBounds"] = {"min": list(low), "max": list(high), "deviationMeters": deviation}
    report["gates"] += ["blender_import_parity", "loop_seam", "rest_bounds_parity"]
    digest.write_json(candidate_dir / "validation-runtime.json", report)
    manifest["validator"] = {"status": "passed", "sourceReport": "validation-source.json", "runtimeReport": "validation-runtime.json",
                             "gates": source["gates"] + report["gates"]}
    digest.write_json(candidate_dir / "candidate.manifest.json", manifest)
    print(json.dumps({"stage": "runtime", "status": "passed", "inventory": report["inventory"], "parity": parity}, indent=2))


def determinism_gate(candidate_dir: Path, rebuild_dir: Path):
    first = digest.read_json(candidate_dir / "geometry-digest.json")
    second = digest.read_json(rebuild_dir / "geometry-digest.json")
    textures_first = {p.name: digest.sha256_file(p) for p in sorted((candidate_dir / "textures").glob("*.png"))}
    textures_second = {p.name: digest.sha256_file(p) for p in sorted((rebuild_dir / "textures").glob("*.png"))}
    result = {"schemaVersion": 1, "geometryDigestMatch": first["geometryDigest"] == second["geometryDigest"],
              "geometryDigest": first["geometryDigest"], "rebuildGeometryDigest": second["geometryDigest"],
              "textureHashMatch": textures_first == textures_second, "textures": textures_first,
              "rigDigestMatch": first["rig"] == second["rig"]}
    result["status"] = "passed" if result["geometryDigestMatch"] and result["textureHashMatch"] and result["rigDigestMatch"] else "failed"
    digest.write_json(candidate_dir / "determinism.json", result)
    if result["status"] != "passed":
        raise GateFailure("Rebuild from the same source produced a different geometry digest or textures")
    print(json.dumps({"stage": "determinism", **result}, indent=2))


def write_receipt(contract: dict, candidate_dir: Path, asset_id: str, variant: str | None):
    manifest = digest.read_json(candidate_dir / "candidate.manifest.json")
    geometry = digest.read_json(candidate_dir / "geometry-digest.json")
    determinism = digest.read_json(candidate_dir / "determinism.json") if (candidate_dir / "determinism.json").exists() else None
    accepted_hash = digest.sha256_file(ACCEPTED_OCELLARIS_PATH)
    if accepted_hash != ACCEPTED_OCELLARIS:
        raise GateFailure("Accepted Ocellaris GLB changed during candidate validation")
    identity = {
        "sourceSha256": manifest["sourceSha256"], "sourceReferencesSha256": manifest["sourceReferencesSha256"],
        "candidateGlbHash": manifest["runtimeGlbSha256"]["lod1"], "geometryDigest": geometry["geometryDigest"],
        "builder": manifest["builder"], "blenderVersion": bpy.app.version_string, "acceptedOcellarisHash": accepted_hash,
    }
    receipt = {
        "schemaVersion": "pocket-aquarium.specimen-validation/v2",
        "speciesId": asset_id, "variantId": variant, "status": "passed", "state": "awaiting_user_acceptance",
        "candidateHash": digest.sha256_json(identity), **identity,
        "stages": {
            "source": {"status": digest.read_json(candidate_dir / "validation-source.json")["status"], "sha256": digest.sha256_file(candidate_dir / "validation-source.json")},
            "runtime": {"status": digest.read_json(candidate_dir / "validation-runtime.json")["status"], "sha256": digest.sha256_file(candidate_dir / "validation-runtime.json")},
            "determinism": {"status": determinism["status"] if determinism else "not_run"},
        },
        "acceptance": {"performed": False, "requiredAction": "explicit_accept_candidate"},
    }
    digest.write_json(candidate_dir / "validation-receipt.json", receipt)
    manifest["candidate"] = {**manifest.get("candidate", {}), "state": "awaiting_user_acceptance", "candidateHash": receipt["candidateHash"],
                             "validationReceipt": "validation-receipt.json", "determinism": receipt["stages"]["determinism"]["status"]}
    digest.write_json(candidate_dir / "candidate.manifest.json", manifest)
    print(json.dumps({"stage": "receipt", "candidateHash": receipt["candidateHash"], "state": receipt["state"]}, indent=2))


def parse_args():
    raw = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset", required=True)
    parser.add_argument("--candidate-dir", required=True)
    parser.add_argument("--stage", choices=("source", "runtime", "determinism", "receipt"), required=True)
    parser.add_argument("--rebuild-dir", default=None)
    parser.add_argument("--variant", default=None)
    return parser.parse_args(raw)


def main():
    args = parse_args()
    candidate_dir = Path(args.candidate_dir)
    candidate_dir = candidate_dir.resolve() if candidate_dir.is_absolute() else (ROOT / candidate_dir).resolve()
    contract = digest.read_json(candidate_dir / "validation.contract.json")
    if contract["speciesId"] != args.asset:
        raise GateFailure("Contract species does not match the requested asset")
    report_path = candidate_dir / ("validation-source.json" if args.stage == "source" else "validation-runtime.json")
    try:
        if args.stage == "source":
            source_gate(contract, candidate_dir)
        elif args.stage == "runtime":
            runtime_gate(contract, candidate_dir, args.asset)
        elif args.stage == "determinism":
            determinism_gate(candidate_dir, Path(args.rebuild_dir).resolve())
        else:
            write_receipt(contract, candidate_dir, args.asset, args.variant)
    except Exception as error:
        if args.stage in ("source", "runtime"):
            digest.write_json(report_path, {"schemaVersion": 2, "status": "failed", "stage": args.stage, "error": str(error)})
        raise


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001
        import traceback
        traceback.print_exc()
        print(f"Catalog validation failed: {error}", file=sys.stderr)
        sys.exit(1)
