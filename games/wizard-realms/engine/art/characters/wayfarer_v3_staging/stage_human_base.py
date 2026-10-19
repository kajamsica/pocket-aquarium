"""Stage Blender Studio's CC0 stylized male anatomy base for artist sculpting.

The source bundle remains outside this repository. This scene is an editable
starting point, not a Wizard Realms character candidate or game export.
"""

import hashlib
import json
import math
from pathlib import Path

import bpy
from mathutils import Matrix


OUT = Path(__file__).resolve().parent
SOURCE = Path("/private/tmp/wizard-human-base.8z4fI1/human-base-meshes-bundle-v1.4.1/human_base_meshes_bundle.blend")
CONCEPT = OUT.parent.parent / "concepts" / "wayfarer-male-concept-v4.png"
TARGET_HEIGHT = 2.257
EXPECTED_SOURCE_SHA256 = "3c121505651140ceb4d69fd1d8923f7788ffadd81672f5be14845a5f2c75c137"


def file_hash(path):
    sha = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(block)
    return sha.hexdigest()


def bounds(objects):
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    for ob in objects:
        if ob.type != "MESH":
            continue
        world = ob.matrix_world
        for vertex in ob.data.vertices:
            point = world @ vertex.co
            for axis in range(3):
                lo[axis] = min(lo[axis], point[axis])
                hi[axis] = max(hi[axis], point[axis])
    if not all(math.isfinite(x) for x in lo + hi):
        raise RuntimeError("Source collection has no finite mesh bounds")
    return lo, hi


def mesh_report(objects):
    report = []
    for ob in objects:
        if ob.type != "MESH":
            continue
        data = ob.data
        faces = len(data.polygons)
        quads = sum(len(poly.vertices) == 4 for poly in data.polygons)
        triangles = sum(len(poly.vertices) - 2 for poly in data.polygons)
        report.append({
            "object": ob.name,
            "mesh": data.name,
            "vertices": len(data.vertices),
            "faces": faces,
            "quads": quads,
            "quadFraction": round(quads / faces, 4) if faces else 0,
            "trianglesAtBaseLevel": triangles,
            "uvMaps": [uv.name for uv in data.uv_layers],
            "modifiers": [mod.type for mod in ob.modifiers],
            "shapeKeys": list(data.shape_keys.key_blocks.keys()) if data.shape_keys else [],
        })
    return report


def main():
    if not SOURCE.is_file() or not CONCEPT.is_file():
        raise RuntimeError("Required source bundle or approved concept is absent")
    source_hash = file_hash(SOURCE)
    if source_hash != EXPECTED_SOURCE_SHA256:
        raise RuntimeError("Source bundle SHA-256 differs from validated v1.4.1 file")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1.0

    with bpy.data.libraries.load(str(SOURCE), link=False) as (available, loaded):
        collection_names = list(available.collections)
        exact = "Body Male - Stylized"
        candidates = [name for name in collection_names
                      if "body" in name.lower() and "male" in name.lower()
                      and "stylized" in name.lower() and "female" not in name.lower()]
        chosen = exact if exact in collection_names else (candidates[0] if len(candidates) == 1 else None)
        if not chosen:
            raise RuntimeError("Body Male - Stylized collection not uniquely found: " + repr(candidates))
        loaded.collections = [chosen]

    anatomy = loaded.collections[0]
    if anatomy is None:
        raise RuntimeError("Blender did not append the selected source collection")
    anatomy.name = "ANATOMY | Blender Studio CC0 male stylized"
    bpy.context.scene.collection.children.link(anatomy)
    source_objects = list(anatomy.all_objects)
    meshes = [ob for ob in source_objects if ob.type == "MESH"]
    if not meshes:
        raise RuntimeError("Selected collection has no mesh objects")
    bpy.context.view_layer.update()
    raw_min, raw_max = bounds(meshes)
    raw_height = raw_max[2] - raw_min[2]
    if raw_height <= 0:
        raise RuntimeError("Source body has non-positive height")
    base_topology = mesh_report(meshes)

    # Keep source geometry and modifiers editable. A single parent transform
    # aligns the floor, center, height, and engine forward axis without baking.
    rig_frame = bpy.data.objects.new("WAYFARER STAGING FRAME | +Z up, +Y forward", None)
    bpy.context.scene.collection.objects.link(rig_frame)
    rig_frame.empty_display_type = "ARROWS"
    rig_frame.empty_display_size = .3
    original_world = {ob: ob.matrix_world.copy() for ob in source_objects}
    for ob in source_objects:
        if ob.parent not in source_objects:
            ob.parent = rig_frame
            ob.matrix_world = original_world[ob]
    center_x = (raw_min[0] + raw_max[0]) / 2
    center_y = (raw_min[1] + raw_max[1]) / 2
    factor = TARGET_HEIGHT / raw_height
    rig_frame.matrix_world = (
        Matrix.Scale(factor, 4)
        @ Matrix.Rotation(math.pi, 4, "Z")
        @ Matrix.Translation((-center_x, -center_y, -raw_min[2]))
    )
    rig_frame["role"] = "staging_transform_only"
    rig_frame["targetUp"] = "+Z"
    rig_frame["targetForward"] = "+Y"
    rig_frame["targetHeightMeters"] = TARGET_HEIGHT
    bpy.context.view_layer.update()
    staged_min, staged_max = bounds(meshes)

    reference_collection = bpy.data.collections.new("REFERENCE | approved male concept, never export")
    bpy.context.scene.collection.children.link(reference_collection)
    approved_image = bpy.data.images.load(str(CONCEPT), check_existing=True)
    approved_image.filepath = "//../../concepts/wayfarer-male-concept-v4.png"
    reference = bpy.data.objects.new("Approved male sheet | visual guide only", None)
    reference_collection.objects.link(reference)
    reference.empty_display_type = "IMAGE"
    reference.data = approved_image
    reference.empty_display_size = 2.4
    reference.location = (-2.65, -.30, 1.20)
    reference.rotation_euler = (-math.pi / 2, 0, 0)
    reference["role"] = "visual_reference_only"
    reference["sourcePixelsUsedAs3DTexture"] = False

    # Make the artist's first open land on the body rather than the old source
    # asset browser layout. Nothing is applied or destructively modified.
    for ob in bpy.context.selected_objects:
        ob.select_set(False)
    for ob in meshes:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                area.spaces.active.region_3d.view_distance = 4.2
                area.spaces.active.region_3d.view_location = (0, 0, 1.15)

    bpy.context.preferences.filepaths.save_version = 0
    staged_file = OUT / "wayfarer_v3_artist_staging.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(staged_file))

    total_faces = sum(item["faces"] for item in base_topology)
    total_quads = sum(item["quads"] for item in base_topology)
    manifest = {
        "status": "artist_staging_only_not_game_asset",
        "source": {
            "publisher": "Blender Studio and community contributions",
            "title": "Human Base Meshes",
            "version": "1.4.1",
            "license": "CC0",
            "licenseEvidence": "https://www.blender.org/download/demo-files/#asset-bundles",
            "download": "https://www.blender.org/download/demo/asset-bundles/human-base-meshes/human-base-meshes-bundle-v1.4.1.zip/",
            "localBundleOutsideRepo": str(SOURCE),
            "localBundleSHA256": source_hash,
            "localBundleBytes": SOURCE.stat().st_size,
            "selectedCollection": chosen,
        },
        "approvedReference": "../../concepts/wayfarer-male-concept-v4.png",
        "stagingBlend": staged_file.name,
        "coordinateContract": {
            "up": "+Z",
            "forward": "+Y",
            "origin": "floor between feet",
            "targetHeightMeters": TARGET_HEIGHT,
            "sourceAssumedForward": "-Y, Blender front view; artist must verify landmarks before rigging",
            "stageRotationDegreesZ": 180,
            "uniformScale": factor,
            "sourceBoundsMeters": {"min": raw_min, "max": raw_max},
            "stagedBoundsMeters": {"min": staged_min, "max": staged_max},
        },
        "topology": {
            "meshObjects": len(meshes),
            "verticesAtBaseLevel": sum(item["vertices"] for item in base_topology),
            "facesAtBaseLevel": total_faces,
            "quadFraction": round(total_quads / total_faces, 4) if total_faces else 0,
            "trianglesAtBaseLevel": sum(item["trianglesAtBaseLevel"] for item in base_topology),
            "allMeshesHaveUV": all(item["uvMaps"] for item in base_topology),
            "perMesh": base_topology,
        },
        "validation": {
            "heightWithin1mm": abs((staged_max[2] - staged_min[2]) - TARGET_HEIGHT) < .001,
            "floorWithin1mm": abs(staged_min[2]) < .001,
            "centerXWithin1mm": abs((staged_min[0] + staged_max[0]) / 2) < .001,
            "centerYWithin1mm": abs((staged_min[1] + staged_max[1]) / 2) < .001,
            "sourceHashMatchesExpected": source_hash == EXPECTED_SOURCE_SHA256,
        },
        "sourceWarnings": ["Six invalid legacy mask_legs/mask_arms driver warnings on body and eyes; appended objects have no active modifiers. Artist should inspect drivers before rigging."],
    }
    (OUT / "STAGING_MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print("SOURCE_COLLECTIONS", collection_names, flush=True)
    print("STAGING_REPORT", json.dumps({"selected": chosen,
                                        "meshObjects": len(meshes),
                                        "vertices": manifest["topology"]["verticesAtBaseLevel"],
                                        "faces": total_faces,
                                        "quadFraction": manifest["topology"]["quadFraction"],
                                        "sourceBounds": [raw_min, raw_max],
                                        "stagedBounds": [staged_min, staged_max],
                                        "validation": manifest["validation"]}), flush=True)


if __name__ == "__main__":
    main()
